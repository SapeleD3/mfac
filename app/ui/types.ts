export type State =
  | "Inbox" | "Triage" | "Ignored" | "ReplyDrafted" | "Replied" | "Queued"
  | "Researching" | "ResearchCheck" | "ResearchGate" | "Planning" | "RequirementsReview" | "PlanGate"
  | "Building" | "Reviewing" | "Confirming" | "PRGate" | "NeedsYou" | "Parked" | "Done" | "Dropped";
export type Gate = "ResearchGate" | "PlanGate" | "PRGate" | "NeedsYou";
export type Tag = "learn" | "urgent" | "ui" | "sensitive" | "harden";
export const TAGS: Tag[] = ["learn", "urgent", "ui", "sensitive", "harden"];
export const CAP = 3;

export interface Machine {
  state: State;
  parkedFrom: State;
  tries: Record<Gate, number>;
  loops: { check: number; requirements: number; review: number; confirm: number };
  chart: boolean;
  proved: boolean;
  covered: boolean;
  findings: boolean;
  confirmed: boolean;
  approved: ("research" | "plan" | "pr")[];
}

export interface Task {
  id: string;
  title: string;
  body: string;
  source: "slack" | "jira" | "notion" | "manual" | "factory";
  sourceRef?: string;
  sourceUrl?: string;
  repo?: string;
  recipe: string;
  tags: Tag[];
  priority: number;
  machine: Machine;
  branch?: string;
  worktree?: string;
  prUrl?: string;
  notionJobId?: string;
  notionReviewId?: string;
  tokens: number;
  takenOver: boolean;
  createdAt: string;
  updatedAt: string;
  column: "Inbox" | "Queued" | "Running" | "Needs you" | "Parked" | "PR ready" | "Done";
  rounds?: string;
  allowed: string[];
}

export interface TaskEvent {
  id: number;
  taskId: string;
  at: string;
  kind: string;
  from?: State;
  to?: State;
  actor: string;
  data: Record<string, unknown>;
}

export interface Stage {
  id: string;
  taskId: string;
  role: string;
  round: number;
  model: string;
  sessionId: string;
  status: "running" | "done" | "failed" | "stopped";
  output?: string;
  startedAt: string;
  endedAt?: string;
}

export interface Prompt {
  id: string;
  taskId?: string;
  stageId?: string;
  kind: "permission" | "question";
  payload: { tool?: string; input?: unknown; question?: string; options?: string[]; role?: string; title?: string };
  status: string;
  createdAt: string;
}

export interface Connection {
  name: string;
  label: string;
  neededFor: string;
  required: boolean;
  status: "connected" | "expired" | "missing" | "error";
  detail?: string;
  via?: string;
  checkedAt?: string;
  lastOkAt?: string;
  snoozedUntil?: string;
  fix: { url?: string; steps: string[] };
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  everySeconds: number;
  workingHours: boolean;
  enabled: boolean;
  builtin: boolean;
  command?: string;
  lastRunAt?: string;
  lastResult?: "ok" | "failed" | "skipped" | "running";
  lastDetail?: string;
  nextRunAt?: string;
  failures: number;
}

export interface IntakeItem {
  id: string;
  source: string;
  sourceId: string;
  author?: string;
  channel?: string;
  text: string;
  url?: string;
  receivedAt: string;
  triage?: "ignore" | "reply" | "task" | "urgent";
  reason?: string;
  tags: Tag[];
  draft?: string;
  status: State;
  taskId?: string;
  overridden: boolean;
}

export interface TriageRule {
  id: string;
  description: string;
  action: string;
  status: "proposed" | "active" | "rejected";
  hits: number;
}

export interface Settings {
  slots: number;
  models: Record<string, string>;
  workingHours: { start: number; end: number; weekends: boolean };
  pollMinutes: number;
  usageCeiling: number;
  ui: { mode: "widget" | "app" | "headless"; sound: boolean };
}

export interface Status {
  paused: boolean;
  guard: { blocked?: boolean; reason?: string; share?: number; weekly?: number };
  slots: number;
  busy: number;
}

export interface Alert {
  level: "info" | "warn" | "error";
  message: string;
  taskId?: string;
  connection?: string;
  sticky?: boolean;
  clear?: boolean;
}
