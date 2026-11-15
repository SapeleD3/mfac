import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUT, ROLES, type Role, claudeCommand } from "./agent.js";
import type { Decision, Engine, TaskView } from "./engine.js";
import type { PluginFactory } from "./factoryd.js";
import { baseBranch, diffStat, ensureWorktree, openPullRequest, rebaseOnBase, removeWorktree } from "./git.js";
import { paths } from "./paths.js";
import { type CheckResult, type Tlc, checkResearch, realTlc } from "./research-check.js";
import { RUNNING, type State } from "./statechart.js";
import { type Row, type Store, now, opt, parseJson } from "./store.js";
import * as realTmux from "./tmux.js";

/*
 * The runner: starts and supervises every Claude Code session. Each task gets one Opus coordinator
 * session that decides what happens next, and each stage runs as its own session in the task's
 * worktree. Sessions talk back through hooks and `factory coord` over the socket; the engine checks
 * every step against the statechart before it happens.
 *
 * Deciding what runs next across tasks is plain code here (queue order, free slots, usage), so an
 * idle factory spends no tokens.
 *
 * Design principles: one managed environment (the engine owns sessions, worktrees and the queue);
 * files hold the state (every stage reads and writes files, so any session can be restarted);
 * crash-only (on start, the runner resumes whatever the database says was running).
 */

export interface Stage {
  id: string;
  taskId: string;
  role: Role;
  round: number;
  model: string;
  sessionId: string;
  status: "running" | "done" | "failed" | "stopped";
  output?: string;
  startedAt: string;
  endedAt?: string;
  nudges: number;
}

export interface Prompt {
  id: string;
  taskId?: string;
  stageId?: string;
  kind: "permission" | "question";
  payload: { tool?: string; input?: unknown; question?: string; options?: string[]; role?: string; title?: string };
  status: "pending" | "allow" | "deny" | "answered" | "expired";
  answer?: string;
  createdAt: string;
}

type TmuxLike = Pick<typeof realTmux, "start" | "isAlive" | "paste" | "keys" | "stop" | "capture" | "live" | "idleSeconds">;

export interface RunnerOptions {
  tmux?: TmuxLike;
  tlc?: Tlc;
  /** Seconds between scheduler ticks. */
  tickSeconds?: number;
  /** How long a permission request waits for a click before falling back to the session's own prompt. */
  permissionTimeoutMs?: number;
}

const promptsDir = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
const REVIEWERS = (t: TaskView): Role[] => ["code_review", "security_review", ...(t.tags.includes("ui") ? (["ui_review"] as Role[]) : [])];
/** Which stage roles may run in each state. */
const ROLE_STATE: Partial<Record<Role, State>> = {
  researcher: "Researching",
  planner: "Planning",
  builder: "Building",
  code_review: "Reviewing",
  security_review: "Reviewing",
  ui_review: "Reviewing",
  confirm: "Confirming",
};

function toStage(r: Row): Stage {
  const detail = parseJson<{ nudges?: number }>(r.detail, {});
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    role: r.role as Role,
    round: Number(r.round),
    model: String(r.model),
    sessionId: String(r.session_id),
    status: r.status as Stage["status"],
    output: opt(r.output),
    startedAt: String(r.started_at),
    endedAt: opt(r.ended_at),
    nudges: detail.nudges ?? 0,
  };
}

function toPrompt(r: Row): Prompt {
  return {
    id: String(r.id),
    taskId: opt(r.task_id),
    stageId: opt(r.stage_id),
    kind: r.kind as Prompt["kind"],
    payload: parseJson(r.payload, {}),
    status: r.status as Prompt["status"],
    answer: opt(r.answer),
    createdAt: String(r.created_at),
  };
}

export class Runner {
  readonly tmux: TmuxLike;
  private tlc: Tlc;
  private timer?: NodeJS.Timeout;
  private waiters = new Map<string, (p: Prompt) => void>();
  /** Messages for a coordinator that a person has taken over; delivered when they hand it back. */
  private held = new Map<string, string[]>();
  private ticking = false;

  constructor(
    readonly engine: Engine,
    readonly store: Store,
    readonly opts: RunnerOptions = {},
  ) {
    this.tmux = opts.tmux ?? realTmux;
    this.tlc = opts.tlc ?? realTlc;
  }

  // ---------- stages table ----------

  stages(taskId?: string): Stage[] {
    const rows = taskId
      ? (this.store.db.prepare("SELECT * FROM stages WHERE task_id = ? ORDER BY started_at").all(taskId) as Row[])
      : (this.store.db.prepare("SELECT * FROM stages ORDER BY started_at").all() as Row[]);
    return rows.map(toStage);
  }

  stage(id: string): Stage | undefined {
    const r = this.store.db.prepare("SELECT * FROM stages WHERE id = ?").get(id) as Row | undefined;
    return r ? toStage(r) : undefined;
  }

  stageBySession(sessionId: string): Stage | undefined {
    const r = this.store.db.prepare("SELECT * FROM stages WHERE session_id = ? ORDER BY started_at DESC LIMIT 1").get(sessionId) as Row | undefined;
    return r ? toStage(r) : undefined;
  }

  running(taskId?: string): Stage[] {
    return this.stages(taskId).filter((s) => s.status === "running" && s.role !== "coordinator");
  }

  private setStage(id: string, patch: Partial<Pick<Stage, "status" | "output" | "nudges">>) {
    const s = this.stage(id);
    if (!s) return;
    const status = patch.status ?? s.status;
    const ended = status !== "running" ? (s.endedAt ?? now()) : null;
    this.store.db
      .prepare("UPDATE stages SET status = ?, output = ?, ended_at = ?, detail = ? WHERE id = ?")
      .run(status, patch.output ?? s.output ?? null, ended, JSON.stringify({ nudges: patch.nudges ?? s.nudges }), id);
    this.engine.emit("session", { stage: this.stage(id) });
  }

  // ---------- job files ----------

  jobDir(taskId: string): string {
    const dir = paths.job(taskId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private writeBrief(t: TaskView) {
    const lines = [
      `# ${t.id}: ${t.title}`,
      "",
      `- Recipe: ${t.recipe}`,
      `- Tags: ${t.tags.join(", ") || "none"}`,
      `- Source: ${t.source}${t.sourceUrl ? ` (${t.sourceUrl})` : ""}`,
      `- Repo: ${t.repo ?? "none (research only)"}`,
      t.branch ? `- Branch: ${t.branch}` : "",
      "",
      "## The ask",
      "",
      t.body || t.title,
      "",
    ];
    writeFileSync(join(this.jobDir(t.id), "brief.md"), lines.filter((l) => l !== undefined).join("\n"));
  }

  private render(template: string, t: TaskView, role: Role, round: number): string {
    const vars: Record<string, string> = {
      taskId: t.id,
      title: t.title,
      role,
      round: String(round),
      jobDir: this.jobDir(t.id),
      cwd: t.worktree ?? this.jobDir(t.id),
      tags: t.tags.join(", ") || "none",
      output: OUTPUT[role],
      base: t.repo ? baseBranch(t.repo) : "main",
      learnNote: t.tags.includes("learn")
        ? "\nThis task is tagged learn: also write explainer.md, a plain-language walkthrough of the statechart, the model and what TLC proved. It ships with the result."
        : "",
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  }

  private systemPrompt(t: TaskView, role: Role, round: number): string {
    const read = (f: string) => readFileSync(join(promptsDir(), f), "utf8");
    const file = join(this.jobDir(t.id), ".factory", `${role}.prompt.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, this.render(`${read("_common.md")}\n\n${read(`${role}.md`)}`, t, role, round));
    return file;
  }

  // ---------- launching sessions ----------

  private launch(t: TaskView, role: Role, opts: { prompt: string; resume?: Stage }): Stage {
    const round = opts.resume ? opts.resume.round : this.stages(t.id).filter((s) => s.role === role).length + 1;
    const id = opts.resume?.id ?? `${t.id}-${role}-${round}`;
    const sessionId = opts.resume?.sessionId ?? randomUUID();
    const model = this.engine.settings().models[role] ?? "sonnet";
    const cwd = t.worktree && existsSync(t.worktree) ? t.worktree : this.jobDir(t.id);
    const command = claudeCommand({
      sessionId,
      resume: !!opts.resume,
      model,
      name: `${t.id} ${role.replace("_", " ")}${round > 1 ? ` r${round}` : ""}`,
      role,
      jobDir: this.jobDir(t.id),
      systemPromptFile: this.systemPrompt(t, role, round),
      prompt: opts.prompt,
    });
    if (!opts.resume) {
      this.store.db
        .prepare("INSERT INTO stages (id, task_id, role, round, model, session_id, status, started_at, detail) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '{}')")
        .run(id, t.id, role, round, model, sessionId, now());
    } else {
      this.store.db.prepare("UPDATE stages SET status = 'running', ended_at = NULL WHERE id = ?").run(id);
    }
    this.tmux.stop(id);
    this.tmux.start(id, cwd, command, {
      FACTORY_TASK: t.id,
      FACTORY_STAGE: id,
      FACTORY_ROLE: role,
      FACTORY_JOB_DIR: this.jobDir(t.id),
      FACTORY_SOCKET: paths.socket(),
    });
    this.store.addEvent(t.id, opts.resume ? "session_resumed" : "session_started", "engine", { stage: id, role, model, round });
    const s = this.stage(id)!;
    this.engine.emit("session", { stage: s });
    return s;
  }

  coordinator(taskId: string): Stage | undefined {
    return this.stages(taskId).filter((s) => s.role === "coordinator").pop();
  }

  /** Get a message to the task's coordinator: paste it into the live session, or resume the session with it. */
  wake(taskId: string, message: string) {
    const t = this.engine.get(taskId);
    if (!t) return;
    if (t.takenOver) {
      this.held.set(taskId, [...(this.held.get(taskId) ?? []), message]);
      return;
    }
    const c = this.coordinator(taskId);
    const text = `[factory] ${message}`;
    if (c && this.tmux.isAlive(c.id)) {
      this.tmux.paste(c.id, text);
      if (c.status !== "running") this.setStage(c.id, { status: "running" });
    } else if (c) this.launch(t, "coordinator", { prompt: text, resume: c });
    else this.launch(t, "coordinator", { prompt: text });
    this.store.addEvent(taskId, "coordinator_woken", "engine", { message: message.slice(0, 500) });
  }

  /** Start a stage the coordinator asked for, if the statechart's current state allows that role. */
  runStage(taskId: string, role: Role, note = ""): Stage {
    const t = this.engine.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    if (role === "coordinator") throw new Error("the coordinator is already running");
    const need = ROLE_STATE[role];
    if (need !== t.machine.state) throw new Error(`${role} runs in ${need}, but the task is ${t.machine.state}`);
    if (["builder", "confirm"].includes(role) && !t.worktree) throw new Error(`${role} needs a repo; this task has none (set one with factory set-repo)`);
    // Reviews run side by side; every other stage runs alone.
    const busy = this.running(taskId).filter((s) => t.machine.state !== "Reviewing" || s.role === role);
    if (busy.length) throw new Error(`${busy.map((s) => s.id).join(", ")} is still running; wait for it to finish`);
    const out = join(this.jobDir(taskId), OUTPUT[role]);
    if (existsSync(out)) writeFileSync(`${out}.round-${Date.now()}`, readFileSync(out)); // Keep earlier rounds.
    const prompt = `Start your ${role.replace("_", " ")} work for ${t.id}.${note ? ` Note from the coordinator: ${note}` : ""}`;
    return this.launch(t, role, { prompt });
  }

  // ---------- the scheduler ----------

  /** Start queued tasks while slots are free and the usage guard allows. Plain code: no tokens. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = this.engine.settings();
      if (this.store.setting("paused", false)) return;
      const active = this.engine.list().filter((t) => RUNNING.includes(t.machine.state) || t.machine.state === "ResearchCheck");
      let free = settings.slots - active.length;
      const queued = this.engine.list().filter((t) => t.machine.state === "Queued");
      const guard = this.store.setting<{ blocked?: boolean; reason?: string }>("usage_guard", {});
      if (guard.blocked) return;
      for (const t of queued) {
        if (free <= 0) break;
        this.startTask(t.id);
        free--;
      }
    } finally {
      this.ticking = false;
    }
  }

  startTask(taskId: string) {
    let t = this.engine.get(taskId)!;
    if (t.repo && !t.worktree) {
      try {
        const wt = ensureWorktree(t.repo, t.id, t.title);
        t = this.engine.update(t.id, { worktree: wt.path, branch: wt.branch });
        if (wt.created) this.repoSetup(t);
      } catch (e) {
        this.store.addEvent(t.id, "worktree_failed", "engine", { error: String(e) });
        this.engine.emit("alert", { taskId: t.id, level: "error", message: `Couldn't create a worktree for ${t.id}: ${e instanceof Error ? e.message : e}` });
        return;
      }
    }
    const r = this.engine.move(t.id, { type: "start" }, "engine");
    if (!r.ok) return;
    this.writeBrief(r.task);
    this.launch(r.task, "coordinator", { prompt: `Task ${t.id} is starting in Researching. Read ${this.jobDir(t.id)}/brief.md and begin.` });
  }

  /** The repo's per-worktree setup (copy env files, install dependencies), from `factory repo add --setup`. */
  private repoSetup(t: TaskView) {
    const row = this.store.db.prepare("SELECT setup FROM repos WHERE path = ?").get(t.repo!) as Row | undefined;
    const setup = row?.setup ? String(row.setup) : "";
    if (!setup || !t.worktree) return;
    this.tmux.start(`${t.id}-setup`, t.worktree, ["/bin/sh", "-c", `${setup}; echo; echo "setup exited $?"; sleep 5`], { FACTORY_REPO: t.repo! });
    this.store.addEvent(t.id, "repo_setup", "engine", { setup });
  }

  // ---------- coordinator commands ----------

  async coord(taskId: string, command: string, args: Record<string, unknown>): Promise<string> {
    const t = this.engine.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    const job = this.jobDir(taskId);
    const refuse = (r: { ok: boolean; reason?: string }) => {
      if (!r.ok) throw new Error(`refused by the engine: ${r.reason}`);
    };
    const idle = (role?: Role) => {
      const busy = this.running(taskId).filter((s) => !role || s.role === role);
      if (busy.length) throw new Error(`${busy.map((s) => s.id).join(", ")} is still running; wait for the factory's message that it finished`);
    };
    switch (command) {
      case "status":
        return this.statusText(t);
      case "run": {
        const role = String(args.role) as Role;
        if (!(ROLES as readonly string[]).includes(role)) throw new Error(`unknown role ${role}; roles are ${ROLES.filter((r) => r !== "coordinator").join(", ")}`);
        const s = this.runStage(taskId, role, String(args.note ?? ""));
        return `Started ${s.id} (${s.model}). Stop now; the factory will message you when it finishes.`;
      }
      case "submit-research": {
        idle("researcher");
        if (t.machine.state !== "Researching") throw new Error(`research can only be submitted while Researching (the task is ${t.machine.state})`);
        const check: CheckResult = await checkResearch(job, this.tlc);
        refuse(this.engine.move(taskId, { type: "research_done", chart: check.chart, proved: check.proved }, "engine", { detail: check.detail }));
        const r = this.engine.move(taskId, { type: "check" }, "engine", { detail: check.detail });
        refuse(r);
        if (!r.ok) return "";
        if (r.task.machine.state === "ResearchGate") {
          this.gateOpened(r.task);
          return `${check.detail} The research gate is open; the person reviews it in Notion. Stop and wait.`;
        }
        if (r.task.machine.state === "Researching") return `The research check failed (round ${r.task.machine.loops.check}/3):\n${check.detail}\nRun the researcher again with this as the note.`;
        this.gateOpened(r.task);
        return `The research check failed three times, so the task went to Needs you:\n${check.detail}`;
      }
      case "submit-plan": {
        idle("planner");
        if (!existsSync(join(job, "plan.md"))) throw new Error("plan.md isn't written yet");
        const r = this.engine.move(taskId, { type: "plan_done" }, "coordinator");
        refuse(r);
        if (r.ok) this.gateOpened(r.task);
        return "The plan gate is open. Stop and wait for the person's verdict.";
      }
      case "submit-build": {
        idle("builder");
        const r = this.engine.move(taskId, { type: "build_done" }, "coordinator");
        refuse(r);
        if (!r.ok) return "";
        const started = REVIEWERS(r.task).map((role) => this.launch(r.task, role, { prompt: `Start your ${role.replace("_", " ")} of ${t.id}'s branch.` }).id);
        return `Reviews started in parallel: ${started.join(", ")}. Stop now; you'll get one message when all of them finish.`;
      }
      case "findings": {
        idle();
        const n = Number(args.blocking);
        if (!Number.isInteger(n) || n < 0) throw new Error("--blocking must be a whole number");
        const file = String(args.file ?? "review-compiled.md");
        if (n > 0 && !existsSync(join(job, file))) throw new Error(`write the compiled findings to ${file} first`);
        const r = this.engine.move(taskId, { type: "reviews_done", findings: n > 0 }, "coordinator", { blocking: n });
        refuse(r);
        if (!r.ok) return "";
        if (r.task.machine.state === "Building") return `Findings go back to the builder (round ${r.task.machine.loops.review}/3). Run the builder with a note pointing at ${file}.`;
        if (r.task.machine.state === "Confirming") return "Reviews are clean. Run the confirm stage.";
        this.gateOpened(r.task);
        return "Findings remain after three rounds, so the task went to Needs you.";
      }
      case "confirm": {
        idle("confirm");
        const solved = !!args.solved;
        const confirmFile = join(job, "confirm.md");
        if (solved && !/VERDICT:\s*solved/i.test(existsSync(confirmFile) ? readFileSync(confirmFile, "utf8") : ""))
          throw new Error('confirm.md must end with "VERDICT: solved" before you can say it\'s solved');
        if (solved) {
          const pr = this.preparePullRequest(t);
          const r = this.engine.move(taskId, { type: "confirm_done", confirmed: true }, "coordinator", { note: String(args.note ?? ""), ...pr });
          refuse(r);
          if (r.ok) this.gateOpened(r.task);
          return pr.prUrl ? `PR opened: ${pr.prUrl}. Stop and wait for the person's verdict.` : `The PR gate is open, but the PR couldn't be opened: ${pr.prError}. Stop and wait.`;
        }
        const r = this.engine.move(taskId, { type: "confirm_done", confirmed: false }, "coordinator", { note: String(args.note ?? "") });
        refuse(r);
        if (!r.ok) return "";
        if (r.task.machine.state === "Building") return `Not solved: back to the builder (round ${r.task.machine.loops.confirm}/3). Run the builder with a note pointing at confirm.md.`;
        this.gateOpened(r.task);
        return "Still not solved after three rounds, so the task went to Needs you.";
      }
      case "needs-you": {
        for (const s of this.running(taskId)) this.finishStage(s, "stopped");
        const r = this.engine.move(taskId, { type: "interrupt" }, "coordinator", { note: String(args.note ?? "") });
        refuse(r);
        if (r.ok) this.gateOpened(r.task);
        return "Escalated to the person. Stop and wait.";
      }
      case "harden": {
        const title = String(args.title ?? "").trim();
        if (!title) throw new Error('give the hardening task a title: factory coord harden "Lint rule: no floating promises"');
        const h = this.engine.add({ title, body: `${String(args.note ?? "")}\n\nRaised by ${t.id} after a send-back: turn the correction into a check (lint rule, type or test) and clean up old cases.`, repo: t.repo, recipe: "harden", tags: ["harden"], source: "factory", sourceRef: `${t.id}:${title}` });
        return `Queued ${h.id}: ${h.title}`;
      }
      default:
        throw new Error(`unknown coordinator command ${command}`);
    }
  }

  statusText(t: TaskView): string {
    const job = this.jobDir(t.id);
    const files = Object.values(OUTPUT).concat(["brief.md", "statechart.md", "tlc-result.md", "review-compiled.md"]).filter((f) => existsSync(join(job, f)));
    const stages = this.stages(t.id).filter((s) => s.role !== "coordinator");
    return [
      `${t.id} "${t.title}" is ${t.machine.state}${t.rounds ? ` (rounds ${t.rounds})` : ""}.`,
      `Approved so far: ${t.machine.approved.join(", ") || "nothing"}. Tags: ${t.tags.join(", ") || "none"}.`,
      `Moves the engine allows now: ${t.allowed.join(", ") || "none"}.`,
      `Job folder ${job}: ${files.join(", ") || "empty"}.`,
      `Stages: ${stages.map((s) => `${s.id} ${s.status}`).join("; ") || "none yet"}.`,
    ].join("\n");
  }

  /** Before the PR gate: rebase onto the latest base, push, and open the PR with its evidence. */
  private preparePullRequest(t: TaskView): { prUrl?: string; prError?: string } {
    if (!t.repo || !t.worktree || !t.branch) return { prError: "no repo" };
    const base = baseBranch(t.repo);
    const rebased = rebaseOnBase(t.worktree, base);
    const job = this.jobDir(t.id);
    const section = (title: string, file: string, max = 4000) => (existsSync(join(job, file)) ? `## ${title}\n\n${readFileSync(join(job, file), "utf8").slice(0, max)}\n` : "");
    const body = [
      `Factory task ${t.id}${t.sourceUrl ? ` from ${t.sourceUrl}` : ""}.`,
      "",
      section("Confirmed", "confirm.md"),
      section("Statechart", "statechart.md"),
      section("Formal check", "tlc-result.md", 1500),
      section("Review", "review-compiled.md", 3000),
      `## Diff\n\n\`\`\`\n${diffStat(t.worktree, base)}\n\`\`\`\n`,
      rebased.ok ? "" : `> The branch couldn't be rebased onto ${base} cleanly; it's based on an older ${base}.\n`,
    ].join("\n");
    const bodyFile = join(job, "pr-body.md");
    writeFileSync(bodyFile, body);
    const pr = openPullRequest(t.worktree, { branch: t.branch, base, title: t.title, bodyFile });
    if (pr.url) this.engine.update(t.id, { prUrl: pr.url });
    return { prUrl: pr.url, prError: pr.error };
  }

  /** A gate or Needs you opened: free the coordinator's session (it resumes on your decision) and tell the person. */
  gateOpened(t: TaskView) {
    const c = this.coordinator(t.id);
    if (c && c.status === "running") this.finishStage(c, "done");
    const what: Partial<Record<State, string>> = {
      ResearchGate: "Research is ready for your review",
      PlanGate: "The plan is ready for your review",
      PRGate: "A pull request is ready for your review",
      NeedsYou: "A task needs you",
    };
    this.engine.emit("alert", { taskId: t.id, level: t.machine.state === "NeedsYou" ? "warn" : "info", gate: t.machine.state, message: `${what[t.machine.state] ?? t.machine.state}: ${t.id} ${t.title}` });
  }

  private finishStage(s: Stage, status: Stage["status"]) {
    this.tmux.stop(s.id, join(this.jobDir(s.taskId), ".factory", "screens", `${s.id}.ans`));
    this.setStage(s.id, { status });
  }

  // ---------- hooks ----------

  /** Stop hook: a session finished a turn. */
  onStop(sessionId: string) {
    const s = this.stageBySession(sessionId);
    if (!s || s.status !== "running") return { ok: true };
    const t = this.engine.get(s.taskId);
    if (!t) return { ok: true };
    if (s.role === "coordinator") {
      // Waiting is normal while a stage runs or a gate is open. Idle with nothing running is a stall.
      if (!RUNNING.includes(t.machine.state) || this.running(t.id).length || t.takenOver) return { ok: true };
      if (s.nudges >= 2) {
        this.engine.move(t.id, { type: "interrupt" }, "engine", { note: "The coordinator stopped twice with nothing running." });
        const after = this.engine.get(t.id);
        if (after) this.gateOpened(after);
        return { ok: true };
      }
      this.setStage(s.id, { nudges: s.nudges + 1 });
      this.tmux.paste(s.id, `[factory] Nothing is running for ${t.id} and it is ${t.machine.state}. Decide the next step with factory coord (run factory coord status if unsure).`);
      return { ok: true };
    }
    const out = join(this.jobDir(s.taskId), OUTPUT[s.role]);
    const written = existsSync(out) && statSync(out).mtimeMs >= Date.parse(s.startedAt) - 1000;
    if (!written) {
      if (s.nudges < 2 && !t.takenOver) {
        this.setStage(s.id, { nudges: s.nudges + 1 });
        this.tmux.paste(s.id, `[factory] You stopped without writing ${OUTPUT[s.role]} in ${this.jobDir(s.taskId)}. Write it now (start it with BLOCKED: if you're stuck), then stop.`);
        return { ok: true };
      }
      this.finishStage(s, "failed");
      this.wake(t.id, `${s.id} stopped without writing ${OUTPUT[s.role]}. Decide whether to rerun it or escalate with factory coord needs-you.`);
      return { ok: true };
    }
    this.finishStage(s, "done");
    const head = readFileSync(out, "utf8").slice(0, 600);
    if (["code_review", "security_review", "ui_review"].includes(s.role)) {
      const pending = this.running(t.id).filter((x) => x.role.endsWith("_review"));
      if (pending.length) return { ok: true };
      const files = REVIEWERS(t).map((r) => OUTPUT[r]).join(", ");
      this.wake(t.id, `All reviews finished (${files}). Compile their findings into review-compiled.md (deduplicated, blocking first) and run factory coord findings --blocking <n>.`);
      return { ok: true };
    }
    const blocked = /^\s*BLOCKED:/i.test(head);
    this.wake(t.id, `${s.id} finished and wrote ${OUTPUT[s.role]}${blocked ? " (it says it is BLOCKED)" : ""}. Read it and decide the next step.\n\n${head}${head.length >= 600 ? "…" : ""}`);
    return { ok: true };
  }

  /** PermissionRequest hook: ask the person in the panel and wait for a click. */
  async onPermission(sessionId: string, tool: string, input: unknown): Promise<{ behavior: "allow" | "deny" | "ask"; message?: string }> {
    const s = this.stageBySession(sessionId);
    const p = this.addPrompt({ taskId: s?.taskId, stageId: s?.id, kind: "permission", payload: { tool, input, role: s?.role, title: s ? this.engine.get(s.taskId)?.title : undefined } });
    const timeout = this.opts.permissionTimeoutMs ?? 14 * 60_000;
    const decided = await new Promise<Prompt | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(p.id);
        resolve(undefined);
      }, timeout);
      timer.unref?.();
      this.waiters.set(p.id, (x) => {
        clearTimeout(timer);
        resolve(x);
      });
    });
    if (!decided) {
      this.store.db.prepare("UPDATE prompts SET status = 'expired', decided_at = ? WHERE id = ?").run(now(), p.id);
      this.engine.emit("prompt", { prompt: this.prompt(p.id) });
      return { behavior: "ask" }; // Falls back to Claude's own prompt in the session.
    }
    return decided.status === "allow" ? { behavior: "allow" } : { behavior: "deny", message: decided.answer || "Denied from the factory panel." };
  }

  /** PreToolUse(AskUserQuestion) hook: show the question in the panel; the answer is typed into the pane. */
  onQuestion(sessionId: string, input: { questions?: { question?: string; options?: { label?: string }[] }[] }) {
    const s = this.stageBySession(sessionId);
    const q = input.questions?.[0];
    if (!q) return { ok: true };
    this.addPrompt({ taskId: s?.taskId, stageId: s?.id, kind: "question", payload: { question: q.question, options: (q.options ?? []).map((o) => o.label ?? ""), role: s?.role } });
    return { ok: true };
  }

  private addPrompt(p: Omit<Prompt, "id" | "status" | "createdAt">): Prompt {
    const id = randomUUID().slice(0, 8);
    this.store.db.prepare("INSERT INTO prompts (id, task_id, stage_id, kind, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(id, p.taskId ?? null, p.stageId ?? null, p.kind, JSON.stringify(p.payload), now());
    const saved = this.prompt(id)!;
    this.engine.emit("prompt", { prompt: saved });
    return saved;
  }

  prompt(id: string): Prompt | undefined {
    const r = this.store.db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as Row | undefined;
    return r ? toPrompt(r) : undefined;
  }

  prompts(status = "pending"): Prompt[] {
    return (this.store.db.prepare("SELECT * FROM prompts WHERE status = ? ORDER BY created_at").all(status) as Row[]).map(toPrompt);
  }

  /** Your answer from the panel: allow or deny a permission, or pick a question's option. */
  answer(id: string, answer: { allow?: boolean; option?: number; message?: string }): Prompt {
    const p = this.prompt(id);
    if (!p) throw new Error(`no prompt ${id}`);
    if (p.status !== "pending") throw new Error(`that prompt is already ${p.status}`);
    if (p.kind === "permission") {
      this.store.db.prepare("UPDATE prompts SET status = ?, answer = ?, decided_at = ? WHERE id = ?").run(answer.allow ? "allow" : "deny", answer.message ?? null, now(), id);
    } else {
      const option = answer.option ?? 1;
      if (p.stageId && this.tmux.isAlive(p.stageId)) this.tmux.keys(p.stageId, String(option), "Enter");
      this.store.db.prepare("UPDATE prompts SET status = 'answered', answer = ?, decided_at = ? WHERE id = ?").run(String(option), now(), id);
    }
    const saved = this.prompt(id)!;
    this.waiters.get(id)?.(saved);
    this.waiters.delete(id);
    this.engine.emit("prompt", { prompt: saved });
    return saved;
  }

  // ---------- take over ----------

  takeOver(taskId: string, on: boolean) {
    const t = this.engine.update(taskId, { takenOver: on });
    this.store.addEvent(taskId, on ? "taken_over" : "handed_back", "human");
    if (!on) {
      const held = this.held.get(taskId) ?? [];
      this.held.delete(taskId);
      if (held.length) this.wake(taskId, held.join("\n\n"));
    }
    return t;
  }

  // ---------- reacting to people ----------

  /** A person decided at a gate: tell the coordinator, which resumes the task. */
  async onDecision(d: Decision) {
    for (const hook of this.engine.beforeWake) {
      await Promise.race([hook(d).catch(() => {}), new Promise((r) => setTimeout(r, 60_000).unref?.())]);
    }
    const t = this.engine.get(d.task.id) ?? d.task;
    const s = t.machine.state;
    if (s === "Done") return this.finishTask(t, "done");
    if (s === "Dropped") return this.finishTask(t, "dropped");
    const note = d.note ? ` Their note: "${d.note}".` : "";
    const comments = existsSync(join(this.jobDir(t.id), "review-comments.md")) ? ` Every open comment, with the words it's anchored to, is in review-comments.md.` : "";
    const verdict = d.verdict === "approve" ? `approved, so the task is now ${s}` : `sent the work back to ${s} (gate round ${t.rounds ?? ""})`;
    this.wake(t.id, `The person ${verdict}.${note}${comments} Run the next stage.${d.verdict === "send_back" ? " Also ask whether a lint rule, type or test could have caught this; if so, queue a harden task." : ""}`);
  }

  private finishTask(t: TaskView, how: "done" | "dropped") {
    for (const s of this.stages(t.id).filter((x) => x.status === "running")) this.finishStage(s, "stopped");
    if (t.repo && t.worktree && how === "done") removeWorktree(t.repo, t.worktree);
    this.engine.emit("finished", { task: t, how });
  }

  /** After a restart: any task whose sessions died gets its coordinator back with a note. */
  recover() {
    const live = this.tmux.live();
    for (const s of this.stages().filter((x) => x.status === "running" && !live.has(x.id))) {
      const t = this.engine.get(s.taskId);
      this.setStage(s.id, { status: "stopped" });
      if (t && RUNNING.includes(t.machine.state) && s.role !== "coordinator") this.wake(t.id, `${s.id} ended while the factory was down (a restart or crash). Check its output file and rerun it if needed.`);
    }
    for (const t of this.engine.list().filter((x) => RUNNING.includes(x.machine.state))) {
      const c = this.coordinator(t.id);
      if (!c || !live.has(c.id)) {
        if (!this.running(t.id).length) this.wake(t.id, `The factory restarted. ${this.statusText(t)}\nDecide the next step.`);
      }
    }
  }

  start() {
    this.recover();
    this.engine.on("decision", (d: Decision) => void this.onDecision(d));
    this.engine.on("change", (c: { kind: string; task?: TaskView; action?: string }) => {
      if (c.task?.machine.state === "NeedsYou" && c.action === "Interrupt") {
        for (const s of this.running(c.task.id)) this.finishStage(s, "stopped");
      }
      if (c.kind === "task") setImmediate(() => void this.tick());
    });
    const every = (this.opts.tickSeconds ?? 5) * 1000;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const w of this.waiters.values()) w({ status: "expired" } as Prompt);
  }
}

export const runnerPart =
  (opts: RunnerOptions = {}): PluginFactory =>
  ({ engine, store }) => {
    const runner = new Runner(engine, store, opts);
    return {
      name: "runner",
      start: () => runner.start(),
      stop: () => runner.stop(),
      api: {
        "coord.do": (p: { task: string; command: string; args?: Record<string, unknown> }) => runner.coord(p.task, p.command, p.args ?? {}),
        "stage.run": (p: { task: string; role: Role; note?: string }) => runner.runStage(p.task, p.role, p.note),
        "stage.list": (p: { task?: string }) => runner.stages(p.task),
        "session.capture": (p: { stage: string; lines?: number; escapes?: boolean }) => {
          const s = runner.stage(p.stage);
          if (!s) throw new Error(`no stage ${p.stage}`);
          if (runner.tmux.isAlive(s.id)) return { live: true, screen: runner.tmux.capture(s.id, p.lines ?? 200, !!p.escapes) };
          const saved = join(runner.jobDir(s.taskId), ".factory", "screens", `${s.id}.ans`);
          return { live: false, screen: existsSync(saved) ? readFileSync(saved, "utf8").split("\n").slice(-(p.lines ?? 200)).join("\n") : "" };
        },
        "session.send": (p: { stage: string; text: string }) => {
          const s = runner.stage(p.stage);
          if (!s || !runner.tmux.isAlive(s.id)) throw new Error("that session isn't running");
          const t = engine.get(s.taskId);
          if (!t?.takenOver) throw new Error("take the session over first; the coordinator owns it until you do");
          runner.tmux.paste(s.id, p.text);
          return { sent: true };
        },
        "session.takeover": (p: { task: string; on: boolean }) => runner.takeOver(p.task, p.on),
        "hook.stop": (p: { session_id: string }) => runner.onStop(p.session_id),
        "hook.permission": (p: { session_id: string; tool_name: string; tool_input: unknown }) => runner.onPermission(p.session_id, p.tool_name, p.tool_input),
        "hook.question": (p: { session_id: string; tool_input: { questions?: { question?: string; options?: { label?: string }[] }[] } }) => runner.onQuestion(p.session_id, p.tool_input ?? {}),
        "prompt.list": (p: { status?: string }) => runner.prompts(p.status),
        "prompt.answer": (p: { id: string; allow?: boolean; option?: number; message?: string }) => runner.answer(p.id, p),
        "factory.pause": (p: { paused: boolean }) => {
          store.setSetting("paused", !!p.paused);
          engine.emit("alert", { level: "info", message: p.paused ? "The factory is paused: no new tasks start." : "The factory is running again." });
          return { paused: !!p.paused };
        },
        "factory.tick": () => runner.tick(),
        /** What the pill and the sidebar show: slots in use, and why nothing new is starting, if so. */
        "factory.status": () => {
          const guard = store.setting<{ blocked?: boolean; reason?: string; share?: number; weekly?: number }>("usage_guard", {});
          const busy = engine.list().filter((t) => t.column === "Running").length;
          return { paused: store.setting("paused", false), guard, slots: engine.settings().slots, busy };
        },
      },
    };
  };
