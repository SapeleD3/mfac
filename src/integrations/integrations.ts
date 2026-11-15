import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deleteTranscript } from "../claude/print.js";
import { type ConnectionName, Connections, type Tester, realTester } from "../connectors/connections.js";
import type { Decision, TaskView } from "../workflow/engine.js";
import type { PluginFactory } from "../daemon/host.js";
import { Intake, type TriageAction } from "./intake.js";
import * as jira from "../connectors/jira.js";
import * as notion from "../connectors/notion.js";
import { NotionSync } from "../board/notion-sync.js";
import { Repos } from "../repo/registry.js";
import { paths } from "../shared/paths.js";
import { machineRoutines } from "./machine-routines.js";
import { type Builtin, Routines } from "./routines.js";
import * as slack from "../connectors/slack.js";
import type { Tag } from "../workflow/store.js";
import { type Ticket, Tickets } from "../board/tickets.js";

export interface IntegrationOptions {
  tester?: Tester;
  extraRoutines?: (ctx: { routines: Routines }) => Builtin[];
}

export const shared: { routines?: Routines; connections?: Connections; notion?: NotionSync; intake?: Intake } = {};

export const integrationsPart =
  (opts: IntegrationOptions = {}): PluginFactory =>
  ({ engine, store }) => {
    const connections = new Connections(store, engine, opts.tester ?? realTester(engine));
    const intake = new Intake(store, engine, connections);
    const tickets = new Tickets(store, engine);
    const sync = new NotionSync(store, engine, tickets, connections);
    const routines = new Routines(store, engine);
    const repos = new Repos(store, engine);
    Object.assign(shared, { routines, connections, notion: sync, intake });

    const builtins: Builtin[] = [
      {
        id: "health-check",
        name: "Health check",
        description: "Checks Claude Code's connectors and the claude and gh commands (no model calls); raises a sticky alert when one breaks",
        everySeconds: 300,
        run: async () => {
          const all = await connections.testAll();
          const bad = all.filter((c) => c.status !== "connected" && c.used);
          return bad.length ? `warn: ${bad.map((c) => `${c.label} ${c.status}`).join(", ")}` : "all connections working";
        },
      },
      {
        id: "intake-slack",
        name: "Slack intake",
        description: "A small Haiku call reads DMs and @-mentions since the last run through your Slack connector, then triage",
        everySeconds: engine.settings().pollMinutes * 60,
        workingHours: true,
        run: async () => {
          const r = await intake.poll("slack");
          if (r.skipped) return `skip: ${r.skipped}`;
          const t = r.added ? await intake.triage() : { triaged: 0 };
          return r.added ? `${r.added} new, ${t.triaged} triaged` : "nothing new";
        },
      },
      {
        id: "intake-jira",
        name: "Jira intake",
        description: "A small Haiku call reads tickets assigned to you that changed since the last run, through your Atlassian connector, then triage",
        everySeconds: engine.settings().pollMinutes * 60,
        workingHours: true,
        run: async () => {
          if (!connections.used("jira")) return "skip: Jira isn't turned on (optional; factory connect jira turns it on)";
          const r = await intake.poll("jira");
          if (r.skipped) return `skip: ${r.skipped}`;
          const t = r.added ? await intake.triage() : { triaged: 0 };
          return r.added ? `${r.added} new, ${t.triaged} triaged` : "nothing new";
        },
      },
      {
        id: "intake-notion",
        name: "Notion board intake",
        description: 'Cards you move to "Ready for agent" on your own Notion board go straight to the queue; one filtered query through your Notion connector, and one read per new card',
        everySeconds: 900,
        run: async () => {
          const r = await intake.poll("notion");
          if (r.skipped) return `skip: ${r.skipped}`;
          const status = engine.settings().notion.intakeStatus || "Ready for agent";
          if (!r.found) return `no cards in "${status}"`;
          return r.added ? `${r.added} card${r.added === 1 ? "" : "s"} queued` : `${r.found} card${r.found === 1 ? "" : "s"} in "${status}", all already queued`;
        },
      },
      {
        id: "triage",
        name: "Triage",
        description: "Sorts anything still in the inbox (rules first, then one batched Haiku call)",
        everySeconds: 600,
        run: async () => {
          const r = await intake.triage();
          return r.triaged ? `${r.triaged} sorted${r.tokensUsed ? "" : " by rules"}` : "inbox empty";
        },
      },
      {
        id: "notion-sync",
        name: "Notion sync",
        description: "Sends queued board changes in one batched call; makes no call when nothing changed",
        everySeconds: 600,
        run: async () => {
          if (!sync.ready()) return "skip: the Notion board isn't set up (factory notion setup <page link>)";
          if (!connections.ok("notion")) return "skip: Notion isn't connected; changes wait";
          if (!sync.pendingCount()) return "nothing to send";
          return `${await sync.flush()} board changes sent`;
        },
      },
      {
        id: "notion-pull",
        name: "Notion tickets",
        description: "Picks up tickets you added or edited on the Notion board",
        everySeconds: 7200,
        workingHours: true,
        run: async () => {
          if (!sync.ready()) return "skip: the Notion board isn't set up";
          if (!connections.ok("notion")) return "skip: Notion isn't connected";
          return `${await sync.pullTickets()} tickets picked up from Notion`;
        },
      },
      {
        id: "cleanup",
        name: "Cleanup",
        description: "A week after a task finishes: removes its saved screens and its sessions' Claude transcripts, so no orphaned sessions pile up",
        everySeconds: 86_400,
        run: async () => {
          let removed = 0;
          let transcripts = 0;
          const old = Date.now() - 7 * 86_400_000;
          for (const t of engine.list({ all: true }).filter((x) => ["Done", "Dropped"].includes(x.machine.state) && Date.parse(x.updatedAt) < old)) {
            const screens = join(paths.job(t.id), ".factory", "screens");
            if (existsSync(screens)) {
              rmSync(screens, { recursive: true, force: true });
              removed++;
            }
            for (const r of store.db.prepare("SELECT session_id FROM stages WHERE task_id = ?").all(t.id) as { session_id: string }[]) if (deleteTranscript(String(r.session_id))) transcripts++;
          }
          const wt = paths.worktrees();
          const stale = existsSync(wt) ? readdirSync(wt).length : 0;
          return `${removed} finished tasks tidied, ${transcripts} old session transcripts removed; ${stale} repos with worktrees`;
        },
      },
      {
        id: "post-merge-watch",
        name: "Post-merge watch",
        description: "Phase 2: watches errors and metrics for a day after each merge; a regression opens a task",
        everySeconds: 3600,
        enabled: false,
        run: async () => "skip: needs a Sentry connection (phase 2)",
      },
      ...(opts.extraRoutines?.({ routines }) ?? []),
    ];

    const writeBack = async (t: TaskView, text: string) => {
      const cfg = store.setting<{ slack?: boolean; jira?: boolean; notion?: boolean }>("write_back", { slack: true, jira: true, notion: true });
      const item = t.sourceRef ? intake.items({ limit: 500 }).find((i) => i.sourceId === t.sourceRef && i.source === t.source) : undefined;
      if (t.source === "jira" && cfg.jira !== false && connections.ok("jira")) await jira.comment(store, item?.meta.key ?? t.sourceRef!.split("@")[0]!, text);
      if (t.source === "notion" && t.sourceRef && cfg.notion !== false && connections.ok("notion")) await notion.commentOn(store, t.sourceRef, text);
      if (t.source === "slack" && cfg.slack !== false && connections.ok("slack") && item?.meta.channelId) await slack.reply(store, item.meta.channelId, item.meta.threadTs!, text);
    };

    const onChange = (c: { kind: string; task?: TaskView; action?: string }) => {
      const t = c.task;
      if (c.kind !== "task" || !t) return;
      sync.later("job", t.id);
      if (t.machine.state === "ResearchGate" || t.machine.state === "PlanGate") sync.later("review", t.id, () => sync.publishReview(t));
    };
    const onTicket = (d: { ticket: Ticket }) => sync.later("ticket", d.ticket.id);
    const onDecision = (d: Decision) => {
      sync.recordVerdict(d.task, d.verdict);
      const t = d.task;
      const where = t.prUrl ? ` ${t.prUrl}` : "";
      const text =
        t.machine.state === "Done"
          ? `Done: the change is approved.${where}`
          : t.machine.state === "Dropped"
            ? `Dropped this one${d.note ? `: ${d.note}` : "."}`
            : d.verdict === "approve" && t.machine.state === "Planning" && t.tags.includes("learn") && t.notionReviewId
              ? `Research write-up (statechart and formal check included): ${notion.pageUrl(t.notionReviewId)}`
              : "";
      if (text) void writeBack(t, text).catch((e) => engine.emit("alert", { level: "warn", taskId: t.id, message: `Couldn't write back to ${t.source}: ${e instanceof Error ? e.message : e}` }));
    };
    engine.beforeWake.push(async (d) => {
      if (d.verdict === "send_back" && sync.ready() && connections.ok("notion")) await sync.collectComments(d.task, d.note);
    });

    return {
      name: "integrations",
      start: () => {
        for (const b of builtins) routines.register(b);
        engine.on("change", onChange);
        engine.on("ticket", onTicket);
        engine.on("decision", onDecision);
        routines.start();
      },
      stop: () => routines.stop(),
      api: {
        "connections.list": () => connections.list(),
        "connections.test": async (p: { name?: ConnectionName }) => (p.name ? [await connections.test(p.name)] : connections.testAll()),
        "connections.connect": (p: { name: ConnectionName; server?: string }) => connections.connect(p.name, p.server),
        "connections.disconnect": (p: { name: ConnectionName }) => connections.disconnect(p.name),
        "connections.snooze": (p: { name: ConnectionName; hours?: number }) => connections.snooze(p.name, p.hours ?? 4),
        "connections.alerts": () => connections.alerts(),
        "intake.list": (p: { status?: string[]; limit?: number }) => intake.items({ status: p.status as never, limit: p.limit }),
        "notion.intake": async (p: { board: string; status?: string; wait?: boolean }) => {
          if (!p.board?.trim()) throw new Error("paste a link to your Notion board (the database view you move cards on)");
          const next = { ...engine.settings().notion, intakeBoard: p.board.trim(), intakeStatus: p.status?.trim() || "Ready for agent" };
          engine.updateSettings({ notion: next });
          routines.update("intake-notion", { workingHours: false });
          const check = routines.run("intake-notion", { manual: true });
          return { board: next.intakeBoard, status: next.intakeStatus, routine: p.wait ? await check : routines.get("intake-notion") };
        },
        "intake.poll": async (p: { source: "slack" | "jira" | "notion" }) => {
          const r = await intake.poll(p.source);
          return { ...r, ...(r.added ? await intake.triage() : {}) };
        },
        "intake.triage": () => intake.triage(),
        "intake.override": (p: { id: string; action: TriageAction; tags?: Tag[]; title?: string }) => intake.override(p.id, p.action, p),
        "intake.send": (p: { id: string; text?: string }) => intake.send(p.id, p.text),
        "rules.list": () => intake.rules(),
        "rules.set": (p: { id: string; status: "active" | "rejected" | "proposed" }) => intake.setRule(p.id, p.status),
        "notion.setup": (p: { page: string }) => sync.setup(p.page),
        "notion.status": () => ({
          ...sync.ids(),
          ready: sync.ready(),
          pending: sync.pendingCount(),
          intakeBoard: engine.settings().notion.intakeBoard,
          intakeStatus: engine.settings().notion.intakeStatus || "Ready for agent",
        }),
        "notion.publish": async (p: { id: string }) => sync.publishReview(engine.get(p.id)!),
        "review.summary": (p: { id: string }) => sync.summary(p.id),
        "routines.list": () => routines.list(),
        "routines.run": (p: { id: string }) => routines.run(p.id, { manual: true }),
        "routines.update": (p: { id: string; enabled?: boolean; every?: string; workingHours?: boolean }) => routines.update(p.id, p),
        "routines.add": (p: { name: string; every: string; command: string; workingHours?: boolean }) => routines.add(p),
        "routines.remove": (p: { id: string }) => routines.remove(p.id),
        "routines.history": (p: { id: string; limit?: number }) => routines.history(p.id, p.limit),
        "routines.machine": () => machineRoutines(),
        "repo.add": (p: { path: string; name?: string; setup?: string; base?: string; about?: string }) => repos.add(p),
        "repo.update": (p: { name: string; about?: string; setup?: string; base?: string; isDefault?: boolean }) => repos.update(p.name, p),
        "repo.remove": (p: { name: string }) => repos.remove(p.name),
        "repo.list": () => repos.list(),
      },
    };
  };
