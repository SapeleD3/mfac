import { EventEmitter } from "node:events";
import { type Event, type Machine, type State, allowed, column, isGateState, step } from "./statechart.js";
import { type Actor, type Recipe, type Source, type Store, TAGS, type Tag, type Task, now } from "./store.js";

export interface Settings {
  slots: number;
  models: Record<string, string>;
  efforts: Record<string, string>;
  workingHours: { start: number; end: number; weekends: boolean };
  pollMinutes: number;
  usageCeiling: number;
  notion: { rootPageId?: string; jobsDb?: string; ticketsDb?: string; reviewsDb?: string; intakeBoard?: string; intakeStatus?: string };
  ui: { mode: "widget" | "app" | "headless"; sound: boolean };
  defaultRepo?: string;
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export const DEFAULT_SETTINGS: Settings = {
  slots: 3,
  models: {
    coordinator: "opus",
    researcher: "sonnet",
    planner: "opus",
    requirements_review: "opus",
    builder: "sonnet",
    code_review: "sonnet",
    security_review: "sonnet",
    confirm: "sonnet",
    triage: "haiku",
    reply: "sonnet",
    memory: "haiku",
  },
  efforts: {},
  workingHours: { start: 8, end: 19, weekends: false },
  pollMinutes: 30,
  usageCeiling: 0.85,
  notion: {},
  ui: { mode: "widget", sound: true },
};

export interface TaskView extends Task {
  column: string;
  rounds?: string;
  allowed: string[];
}

export interface ContextResult {
  task: TaskView;
  how: "brief" | "coordinator" | "followup";
  followUp?: TaskView;
}

export type MoveResult = { ok: true; task: TaskView; action: string } | { ok: false; reason: string; task?: TaskView };

export interface Decision {
  task: TaskView;
  verdict: "approve" | "send_back" | "drop";
  to?: State;
  note: string;
}

export class Engine extends EventEmitter {
  readonly beforeWake: ((d: Decision) => Promise<void>)[] = [];

  constructor(readonly store: Store) {
    super();
    this.setMaxListeners(100);
  }

  settings(): Settings {
    const saved = this.store.setting<Partial<Settings>>("settings", {});
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      models: { ...DEFAULT_SETTINGS.models, ...(saved.models ?? {}) },
      efforts: { ...DEFAULT_SETTINGS.efforts, ...(saved.efforts ?? {}) },
      notion: { ...DEFAULT_SETTINGS.notion, ...(saved.notion ?? {}) },
      ui: { ...DEFAULT_SETTINGS.ui, ...(saved.ui ?? {}) },
    };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    if (!Number.isInteger(next.slots) || next.slots < 1 || next.slots > 8) throw new Error("slots must be a whole number from 1 to 8");
    if (!(next.usageCeiling > 0 && next.usageCeiling <= 1)) throw new Error("the usage ceiling is a share between 0 and 1, like 0.85");
    if (!Number.isInteger(next.pollMinutes) || next.pollMinutes < 1) throw new Error("poll minutes must be a whole number of at least 1");
    if (!["widget", "app", "headless"].includes(next.ui.mode)) throw new Error("ui mode is widget, app or headless");
    for (const [role, e] of Object.entries(next.efforts)) if (e && !EFFORTS.includes(e)) throw new Error(`effort for ${role} is one of ${EFFORTS.join(", ")} (or empty for the model's default)`);
    next.efforts = Object.fromEntries(Object.entries(next.efforts).filter(([, e]) => e));
    this.store.setSetting("settings", next);
    this.emit("change", { kind: "settings", settings: next });
    return next;
  }

  view(t: Task): TaskView {
    const m = t.machine;
    const s = m.state;
    const rounds =
      s === "ResearchGate"
        ? undefined
        : isGateState(s)
          ? `${m.tries[s]}/3`
          : s === "Researching" || s === "ResearchCheck"
            ? `${m.loops.check}/3`
            : s === "Planning" || s === "RequirementsReview"
              ? `${m.loops.requirements}/3`
              : s === "Building" || s === "Reviewing"
                ? `${m.loops.review}/3`
                : s === "Confirming"
                  ? `${m.loops.confirm}/3`
                  : undefined;
    const moves = allowed(m).map((e) => (e.type === "send_back" ? `send_back:${e.to}` : e.type === "triage" ? `triage:${e.as}` : e.type));
    return { ...t, column: column(s), rounds, allowed: [...new Set(moves)] };
  }

  add(input: {
    title: string;
    body?: string;
    repo?: string;
    recipe?: Recipe;
    tags?: Tag[];
    priority?: number;
    source?: Source;
    sourceRef?: string;
    sourceUrl?: string;
    backlog?: boolean;
    parent?: string;
    chat?: string;
  }): TaskView {
    if (!input.title?.trim()) throw new Error("a task needs a title");
    const tags = (input.tags ?? []).filter((t) => (TAGS as readonly string[]).includes(t));
    const { backlog, ...rest } = input;
    const task = this.store.createTask({
      ...rest,
      title: input.title.trim(),
      source: input.source ?? "manual",
      tags,
      priority: input.priority ?? (tags.includes("urgent") ? 10 : 0),
      state: backlog ? "Backlog" : "Queued",
    });
    const v = this.view(task);
    this.emit("change", { kind: "task", task: v });
    return v;
  }

  get(id: string): TaskView | undefined {
    const t = this.store.task(id);
    return t ? this.view(t) : undefined;
  }

  list(opts: { all?: boolean } = {}): TaskView[] {
    return this.store.tasks({ includeFinished: !!opts.all }).map((t) => this.view(t));
  }

  move(id: string, event: Event, actor: Actor, data: Record<string, unknown> = {}): MoveResult {
    const result = this.store.tx((): MoveResult => {
      const t = this.store.task(id);
      if (!t) return { ok: false, reason: `no task ${id}` };
      const r = step(t.machine, event);
      if (!r.ok) {
        this.store.addEvent(t.id, "refused", actor, { event, reason: r.reason, ...data }, t.machine.state);
        return { ok: false, reason: r.reason, task: this.view(t) };
      }
      this.store.saveMachine(t.id, r.machine);
      this.store.addEvent(t.id, r.action, actor, { event, ...data }, t.machine.state, r.machine.state);
      return { ok: true, task: this.view({ ...t, machine: r.machine }), action: r.action };
    });
    if (result.ok) this.emit("change", { kind: "task", task: result.task, action: result.action, actor });
    else if (result.task) this.emit("refused", { task: result.task, reason: result.reason, actor });
    return result;
  }

  decide(id: string, verdict: "approve" | "send_back" | "drop", opts: { to?: State; note?: string } = {}): MoveResult {
    const t = this.store.task(id);
    if (!t) return { ok: false, reason: `no task ${id}` };
    let event: Event;
    if (verdict === "approve") event = { type: "approve" };
    else if (verdict === "drop") event = { type: "drop" };
    else {
      const to = opts.to ?? defaultSendBack(t.machine);
      if (!to) return { ok: false, reason: `nowhere to send ${id} back to from ${t.machine.state}` };
      event = { type: "send_back", to };
    }
    const r = this.move(id, event, "human", { verdict, note: opts.note ?? "" });
    if (r.ok) this.emit("decision", { task: r.task, verdict, to: opts.to, note: opts.note ?? "" } satisfies Decision);
    return r;
  }

  /**
   * More input for a task that already exists. Work that hasn't started takes it into its brief; running
   * work gets it at its coordinator's next step (the runner listens for "context"); finished work gets a
   * follow-up task that starts from the old one's files.
   */
  addContext(id: string, c: { text: string; from: string; url?: string; source?: Source; sourceRef?: string; actor?: Actor }): ContextResult {
    const t = this.store.task(id);
    if (!t) throw new Error(`no task ${id}`);
    if (!c.text?.trim()) throw new Error("the new context is empty");
    const text = c.text.trim();
    const s = t.machine.state === "Parked" ? t.machine.parkedFrom : t.machine.state;
    this.store.addEvent(id, "context_added", c.actor ?? "human", { from: c.from, url: c.url, text: text.slice(0, 2000) });
    if (s === "Done" || s === "Dropped") {
      const followUp = this.add({
        title: t.title.startsWith("Follow-up: ") ? t.title : `Follow-up: ${t.title}`,
        body: `${text}${c.url ? `\n\nSource: ${c.url}` : ""}\n\nThis continues ${t.id} (${t.machine.state === "Done" ? "finished" : "dropped"}), from ${c.from}.`,
        repo: t.repo,
        recipe: t.recipe,
        tags: t.tags,
        source: c.source ?? t.source,
        sourceRef: c.sourceRef,
        sourceUrl: c.url ?? t.sourceUrl,
        parent: t.id,
        chat: t.chat,
      });
      this.store.addEvent(id, "followed_up", c.actor ?? "human", { as: followUp.id });
      return { task: this.view(t), how: "followup", followUp };
    }
    if (s === "Queued" || s === "Backlog") {
      this.store.updateTask(id, { body: `${t.body}\n\n## More context, from ${c.from} (${now()})\n\n${text}${c.url ? `\n\nSource: ${c.url}` : ""}`.trim() });
      const v = this.get(id)!;
      this.emit("change", { kind: "task", task: v });
      return { task: v, how: "brief" };
    }
    this.emit("context", { task: this.view(t), text, from: c.from, url: c.url });
    return { task: this.view(t), how: "coordinator" };
  }

  restore(id: string): TaskView {
    const t = this.store.task(id);
    if (!t) throw new Error(`no task ${id}`);
    if (t.machine.state === "Parked") {
      const r = this.move(id, { type: "unpark" }, "human");
      if (!r.ok) throw new Error(r.reason);
      return r.task!;
    }
    if (t.machine.state !== "Dropped") throw new Error(`${id} isn't in the bin`);
    const copy = this.add({
      title: t.title,
      body: `${t.body}\n\nRestored from ${t.id}, which was dropped.`.trim(),
      repo: t.repo,
      recipe: t.recipe,
      tags: t.tags,
      priority: t.priority,
      source: t.source,
      sourceUrl: t.sourceUrl,
      backlog: true,
    });
    this.store.addEvent(t.id, "restored", "human", { as: copy.id });
    return copy;
  }

  tag(id: string, add: string[] = [], remove: string[] = []): TaskView {
    const t = this.store.task(id);
    if (!t) throw new Error(`no task ${id}`);
    const bad = [...add, ...remove].filter((x) => !(TAGS as readonly string[]).includes(x));
    if (bad.length) throw new Error(`unknown tag ${bad.join(", ")}; tags are ${TAGS.join(", ")}`);
    const tags = [...new Set([...t.tags.filter((x) => !remove.includes(x)), ...(add as Tag[])])];
    this.store.updateTask(id, { tags, priority: tags.includes("urgent") ? Math.max(t.priority, 10) : t.priority });
    this.store.addEvent(id, "tagged", "human", { add, remove });
    const v = this.get(id)!;
    this.emit("change", { kind: "task", task: v });
    return v;
  }

  update(id: string, patch: Parameters<Store["updateTask"]>[1]): TaskView {
    this.store.updateTask(id, patch);
    const v = this.get(id);
    if (!v) throw new Error(`no task ${id}`);
    this.emit("change", { kind: "task", task: v });
    return v;
  }

  events(id: string) {
    return this.store.events(id);
  }

  rules(id: string) {
    const t = this.store.task(id);
    if (!t) throw new Error(`no task ${id}`);
    return { state: t.machine.state, machine: t.machine, allowed: this.view(t).allowed };
  }
}

export function defaultSendBack(m: Machine): State | undefined {
  switch (m.state) {
    case "ResearchGate":
      return "Researching";
    case "PlanGate":
      return "Planning";
    case "PRGate":
      return "Building";
    case "NeedsYou":
      return m.approved.includes("research") && m.approved.includes("plan") ? "Building" : "Researching";
    default:
      return undefined;
  }
}
