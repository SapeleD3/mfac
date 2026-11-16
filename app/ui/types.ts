export type State =
  | "Inbox"
  | "Triage"
  | "Ignored"
  | "ReplyDrafted"
  | "Replied"
  | "Queued"
  | "Backlog"
  | "Researching"
  | "ResearchCheck"
  | "ResearchGate"
  | "Planning"
  | "RequirementsReview"
  | "PlanGate"
  | "Building"
  | "Reviewing"
  | "Confirming"
  | "PRGate"
  | "NeedsYou"
  | "Parked"
  | "Done"
  | "Dropped";
export type Gate = "ResearchGate" | "PlanGate" | "PRGate" | "NeedsYou";
export type Tag = "learn" | "urgent" | "ui" | "sensitive" | "harden";
export const TAGS: Tag[] = ["learn", "urgent", "ui", "sensitive", "harden"];
export const CAP = 3;

export interface Machine {
  state: State;
  parkedFrom: State;
  kind?: "change" | "research";
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
  ended?: { from: string; by: string; at: string };
  id: string;
  title: string;
  body: string;
  source: "slack" | "jira" | "notion" | "manual" | "factory" | "chat";
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
  parent?: string;
  chat?: string;
  tokens: number;
  takenOver: boolean;
  createdAt: string;
  updatedAt: string;
  column: "Inbox" | "Backlog" | "Queued" | "Running" | "Needs you" | "PR ready" | "Done" | "Bin";
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
  payload: {
    tool?: string;
    input?: unknown;
    question?: string;
    options?: string[];
    questions?: { header?: string; question: string; options: string[] }[];
    menu?: boolean;
    role?: string;
    title?: string;
  };
  status: string;
  createdAt: string;
}

export interface Connection {
  name: string;
  label: string;
  neededFor: string;
  required: boolean;
  used: boolean;
  status: "connected" | "expired" | "missing" | "error";
  detail?: string;
  via?: string;
  checkedAt?: string;
  lastOkAt?: string;
  snoozedUntil?: string;
  fix: { url?: string; steps: string[] };
  through?: { name: string; kind: "claude.ai" | "plugin" | "local"; target?: string; state: string };
  tools?: string[];
  lastCall?: { at: string; ok: boolean; server: string; error?: string; lastOkAt?: string };
  workspace?: string;
}

export interface ServerChoice {
  name: string;
  kind: "claude.ai" | "plugin" | "local";
  status: "connected" | "needs-auth" | "failed";
  detail: string;
  workspace?: string;
  pinned: boolean;
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
  lastResult?: "ok" | "warn" | "failed" | "skipped" | "running";
  defaultEverySeconds?: number;
  lastDetail?: string;
  nextRunAt?: string;
  failures: number;
}

export interface MachineRoutine {
  id: string;
  kind: "launchd" | "cron" | "claude";
  name: string;
  schedule: string;
  command?: string;
  state: "running" | "loaded" | "failing" | "not loaded" | "disabled" | "scheduled";
  detail?: string;
  file?: string;
  factory: boolean;
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
  triage?: "ignore" | "reply" | "task" | "urgent" | "backlog";
  reason?: string;
  tags: Tag[];
  draft?: string;
  status: State;
  taskId?: string;
  overridden: boolean;
  meta: Record<string, string>;
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
  efforts: Record<string, string>;
  workingHours: { start: number; end: number; weekends: boolean };
  pollMinutes: number;
  usageCeiling: number;
  notion?: { boards?: { url: string }[]; intakeBoard?: string };
  ui: { mode: "widget" | "app" | "headless"; sound: boolean };
}

export interface Status {
  paused: boolean;
  guard: { blocked?: boolean; reason?: string; share?: number; weekly?: number; basis?: "claude" | "unknown"; asOf?: string; windowEndsAt?: string };
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

export interface Repo {
  name: string;
  path: string;
  base: string;
  setup: string;
  about: string;
  isDefault: boolean;
}

export interface ProjectSummary {
  name: string;
  path: string;
  about: string;
  isDefault: boolean;
  registered: boolean;
  counts: { active: number; waiting: number; queued: number; done: number; dropped: number; total: number };
  lastActivity?: string;
}

export interface TimelineItem {
  id: string;
  title: string;
  state: State;
  column: string;
  kind: "change" | "research";
  recipe: string;
  source: string;
  sourceUrl?: string;
  prUrl?: string;
  branch?: string;
  parent?: string;
  children: string[];
  area?: string;
  summary?: string;
  files: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  areas: { name: string; count: number }[];
  tasks: TimelineItem[];
}
