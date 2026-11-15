import type { Engine, TaskView } from "../workflow/engine.js";
import type { Connections } from "../connectors/connections.js";
import * as notion from "../connectors/notion.js";
import type { State } from "../workflow/statechart.js";
import type { Store } from "../workflow/store.js";

export type Milestone = "working" | "review" | "done" | "dropped";

export const MILESTONES: Milestone[] = ["working", "review", "done", "dropped"];

const MEANING: Record<Milestone, string> = {
  working: "in progress: being worked on",
  review: "in review: waiting for the owner to review",
  done: "done",
  dropped: "dropped, cancelled or won't do",
};

const JIRA_COLUMN: Record<Milestone, string> = { working: "In Progress", review: "In Review", done: "Done", dropped: "Won't Do (or Cancelled)" };

export function milestone(s: State): Milestone | undefined {
  if (["Researching", "ResearchCheck", "Planning", "RequirementsReview", "Building", "Reviewing", "Confirming"].includes(s)) return "working";
  if (["ResearchGate", "PlanGate", "PRGate", "NeedsYou"].includes(s)) return "review";
  if (s === "Done") return "done";
  if (s === "Dropped") return "dropped";
  return undefined;
}

/**
 * Keeps a card on your own Notion board in step with its task, one move per milestone rather than per
 * state. A team Jira ticket is never moved: you get the suggested move instead, since others plan by it.
 */
export class CardMoves {
  constructor(
    private store: Store,
    private engine: Engine,
    private connections: Connections,
  ) {}

  private last(): Record<string, Milestone> {
    return this.store.setting<Record<string, Milestone>>("card_moves", {});
  }

  onChange(t: TaskView) {
    const m = milestone(t.machine.state);
    if (!m || (t.source !== "notion" && t.source !== "jira") || !t.sourceRef) return;
    const last = this.last();
    if (last[t.id] === m || (t.source === "jira" && m === "review" && t.machine.state !== "PRGate")) return;
    this.store.setSetting("card_moves", { ...last, [t.id]: m });
    if (t.source === "jira") return this.suggest(t, m);
    void this.move(t, m).catch((e) => this.engine.emit("alert", { level: "warn", taskId: t.id, message: `Couldn't move ${t.id}'s card on your Notion board: ${e instanceof Error ? e.message : e}` }));
  }

  private suggest(t: TaskView, m: Milestone) {
    const key = t.sourceRef!.split("@")[0]!;
    const message = `${t.id} is ${m === "working" ? "being worked on" : m === "review" ? "ready for review" : m}. Move ${key} to ${JIRA_COLUMN[m]} in Jira; the factory leaves team tickets for you to move.`;
    this.store.addEvent(t.id, "jira_move_suggested", "engine", { key, to: JIRA_COLUMN[m] });
    this.engine.emit("alert", { level: "info", taskId: t.id, message });
  }

  private async move(t: TaskView, m: Milestone) {
    if (!this.connections.ok("notion")) return;
    const s = this.engine.settings().notion;
    const known = s.columns?.[m];
    const r = await notion.moveCard(this.store, t.sourceRef!, known ? { exact: known } : { meaning: MEANING[m] }, s.intakeServer);
    this.store.addEvent(t.id, "card_moved", "engine", { to: r.status || null, milestone: m });
    const fresh = this.engine.settings().notion;
    if (r.status && !known) this.engine.updateSettings({ notion: { ...fresh, columns: { ...fresh.columns, [m]: r.status } } });
  }
}
