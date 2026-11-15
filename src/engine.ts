import { EventEmitter } from "node:events";
import { type Event, type Machine, type State, allowed, column, isGateState, step } from "./statechart.js";
import { type Actor, type Recipe, type Source, Store, TAGS, type Tag, type Task } from "./store.js";

/*
 * The engine: the only code that changes a task's state. Every caller (the coordinator over the
 * socket, the app, the CLI, intake) goes through `move`, which checks the statechart, writes the
 * new state and an audit event in one transaction, and tells subscribers.
 *
 * Design principle: the coordinator decides, the engine enforces. Plain code picks what runs next;
 * Claude only runs where judgement is needed.
 */

export interface Settings {
  /** How many tasks may run a Claude session at once. */
  slots: number;
  /** Model per role. Opus coordinates and writes the spec; Sonnet builds and reviews; Haiku triages. */
  models: Record<string, string>;
  /** Intake polls only inside these hours (local), Monday to Friday. */
  workingHours: { start: number; end: number; weekends: boolean };
  /** Minutes between intake polls. */
  pollMinutes: number;
  /** Pause starting new work above this share of the plan's usage window (0..1). */
  usageCeiling: number;
  /** Where the factory files Notion pages (filled in on first run). */
  notion: { rootPageId?: string; jobsDb?: string; ticketsDb?: string; reviewsDb?: string };
}

export const DEFAULT_SETTINGS: Settings = {
  slots: 3,
  models: { coordinator: "opus", researcher: "sonnet", planner: "opus", builder: "sonnet", code_review: "sonnet", security_review: "sonnet", confirm: "sonnet", triage: "haiku", reply: "sonnet" },
  workingHours: { start: 8, end: 19, weekends: false },
  pollMinutes: 10,
  usageCeiling: 0.85,
  notion: {},
};

export interface TaskView extends Task {
  column: string;
  /** Rounds used at the current gate or loop, e.g. "2/3". */
  rounds?: string;
  allowed: string[];
}

export type MoveResult = { ok: true; task: TaskView; action: string } | { ok: false; reason: string; task?: TaskView };

export class Engine extends EventEmitter {
  constructor(readonly store: Store) {
    super();
    this.setMaxListeners(100);
  }

  settings(): Settings {
    const saved = this.store.setting<Partial<Settings>>("settings", {});
    return { ...DEFAULT_SETTINGS, ...saved, models: { ...DEFAULT_SETTINGS.models, ...(saved.models ?? {}) }, notion: { ...DEFAULT_SETTINGS.notion, ...(saved.notion ?? {}) } };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    if (!Number.isInteger(next.slots) || next.slots < 1 || next.slots > 8) throw new Error("slots must be a whole number from 1 to 8");
    this.store.setSetting("settings", next);
    this.emit("change", { kind: "settings", settings: next });
    return next;
  }

  view(t: Task): TaskView {
    const m = t.machine;
    const s = m.state;
    const rounds = isGateState(s)
      ? `${m.tries[s]}/3`
      : s === "Researching" || s === "ResearchCheck"
        ? `${m.loops.check}/3`
        : s === "Building" || s === "Reviewing"
          ? `${m.loops.review}/3`
          : s === "Confirming"
            ? `${m.loops.confirm}/3`
            : undefined;
    const moves = allowed(m).map((e) => (e.type === "send_back" ? `send_back:${e.to}` : e.type === "triage" ? `triage:${e.as}` : e.type));
    return { ...t, column: column(s), rounds, allowed: [...new Set(moves)] };
  }

  add(input: { title: string; body?: string; repo?: string; recipe?: Recipe; tags?: Tag[]; priority?: number; source?: Source; sourceRef?: string; sourceUrl?: string }): TaskView {
    if (!input.title?.trim()) throw new Error("a task needs a title");
    const tags = (input.tags ?? []).filter((t) => (TAGS as readonly string[]).includes(t));
    const task = this.store.createTask({ ...input, title: input.title.trim(), source: input.source ?? "manual", tags, priority: input.priority ?? (tags.includes("urgent") ? 10 : 0) });
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

  /** The one door for state changes. */
  move(id: string, event: Event, actor: Actor, data: Record<string, unknown> = {}): MoveResult {
    const result = this.store.tx((): MoveResult => {
      const t = this.store.task(id);
      if (!t) return { ok: false, reason: `no task ${id}` };
      const r = step(t.machine, event);
      if (!r.ok) {
        // Refusals are recorded too: the retro counts them, and "the engine refused" is the
        // signal that a coordinator is trying to skip a rule.
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

  /** A person's verdict at a gate: approve, send back (to a stage), or drop, with an optional note. */
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
    if (r.ok) this.emit("decision", { task: r.task, verdict, to: opts.to, note: opts.note ?? "" });
    return r;
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

  /** Patch non-state fields (repo, branch, PR link...) and tell subscribers. */
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

  /** Machine-readable rules for a task, for the coordinator's prompt and the UI. */
  rules(id: string) {
    const t = this.store.task(id);
    if (!t) throw new Error(`no task ${id}`);
    return { state: t.machine.state, machine: t.machine, allowed: this.view(t).allowed };
  }
}

/** The usual target of a plain "send back" at each gate: the stage that produced the work. */
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
