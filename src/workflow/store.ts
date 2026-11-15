import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Machine, type State, initial } from "./statechart.js";

export const TAGS = ["learn", "urgent", "ui", "sensitive", "harden"] as const;
export type Tag = (typeof TAGS)[number];
export const RECIPES = ["feature", "bugfix", "research", "review", "harden"] as const;
export type Recipe = (typeof RECIPES)[number];
export type Source = "slack" | "jira" | "notion" | "manual" | "factory";

export interface Task {
  id: string;
  title: string;
  body: string;
  source: Source;
  sourceRef?: string;
  sourceUrl?: string;
  repo?: string;
  recipe: Recipe;
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
}

export interface TaskEvent {
  id: number;
  taskId: string;
  at: string;
  kind: string;
  from?: State;
  to?: State;
  actor: Actor;
  data: Record<string, unknown>;
}

export type Actor = "engine" | "coordinator" | "human" | "stage" | "triage" | "routine";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_ref TEXT,
  source_url TEXT,
  repo TEXT,
  recipe TEXT NOT NULL DEFAULT 'feature',
  tags TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  machine TEXT NOT NULL,
  branch TEXT, worktree TEXT, pr_url TEXT, notion_job_id TEXT, notion_review_id TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  taken_over INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source ON tasks(source, source_ref) WHERE source_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_state TEXT, to_state TEXT,
  actor TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id);
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,
  round INTEGER NOT NULL,
  model TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS stages_task ON stages(task_id);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  stage_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  answer TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS intake (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  author TEXT, channel TEXT, text TEXT NOT NULL, url TEXT,
  received_at TEXT NOT NULL,
  triage TEXT, reason TEXT, tags TEXT NOT NULL DEFAULT '[]',
  draft TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  task_id TEXT,
  overridden INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source, source_id)
);
CREATE TABLE IF NOT EXISTS cursors (source TEXT PRIMARY KEY, cursor TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  via TEXT,
  checked_at TEXT,
  last_ok_at TEXT,
  snoozed_until TEXT
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  every_s INTEGER NOT NULL,
  working_hours INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 1,
  command TEXT,
  last_run_at TEXT, last_result TEXT, last_detail TEXT,
  next_run_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS routine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT,
  result TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  picked_up_by TEXT,
  status TEXT NOT NULL DEFAULT 'Backlog',
  tags TEXT NOT NULL DEFAULT '[]',
  check_text TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '{}',
  notion_page_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repos (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT 'main',
  setup TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  readiness TEXT NOT NULL DEFAULT '{}',
  escalate TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS triage_rules (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  match TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retros (task_id TEXT PRIMARY KEY, at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const now = () => new Date().toISOString();
const j = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
const opt = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

type Row = Record<string, unknown>;

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    title: String(r.title),
    body: String(r.body ?? ""),
    source: r.source as Source,
    sourceRef: opt(r.source_ref),
    sourceUrl: opt(r.source_url),
    repo: opt(r.repo),
    recipe: r.recipe as Recipe,
    tags: j(r.tags, []),
    priority: Number(r.priority),
    machine: loadMachine(j<Partial<Machine>>(r.machine, {})),
    branch: opt(r.branch),
    worktree: opt(r.worktree),
    prUrl: opt(r.pr_url),
    notionJobId: opt(r.notion_job_id),
    notionReviewId: opt(r.notion_review_id),
    tokens: Number(r.tokens ?? 0),
    takenOver: Number(r.taken_over ?? 0) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.addMissingColumns();
  }

  private addMissingColumns() {
    const has = (table: string, col: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some((c) => c.name === col);
    if (!has("repos", "about")) this.db.exec("ALTER TABLE repos ADD COLUMN about TEXT NOT NULL DEFAULT ''");
  }

  close() {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private nextTaskId(): string {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'task_seq'").get() as Row | undefined;
    const n = Number(row?.value ?? 0) + 1;
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('task_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
    return `F-${String(n).padStart(3, "0")}`;
  }

  createTask(input: { title: string; body?: string; source: Source; sourceRef?: string; sourceUrl?: string; repo?: string; recipe?: Recipe; tags?: Tag[]; priority?: number; state?: State }): Task {
    return this.tx(() => {
      const id = this.nextTaskId();
      const m = initial(input.state ?? "Queued");
      const t = now();
      this.db
        .prepare(
          `INSERT INTO tasks (id, title, body, source, source_ref, source_url, repo, recipe, tags, priority, state, machine, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.title,
          input.body ?? "",
          input.source,
          input.sourceRef ?? null,
          input.sourceUrl ?? null,
          input.repo ?? null,
          input.recipe ?? "feature",
          JSON.stringify(input.tags ?? []),
          input.priority ?? 0,
          m.state,
          JSON.stringify(m),
          t,
          t,
        );
      this.addEvent(id, "created", "human", { source: input.source }, undefined, m.state);
      return this.task(id)!;
    });
  }

  task(id: string): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ? COLLATE NOCASE").get(id) as Row | undefined;
    return r ? toTask(r) : undefined;
  }

  taskBySource(source: Source, ref: string): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE source = ? AND source_ref = ?").get(source, ref) as Row | undefined;
    return r ? toTask(r) : undefined;
  }

  tasks(filter: { states?: State[]; includeFinished?: boolean } = {}): Task[] {
    const rows = this.db.prepare("SELECT * FROM tasks ORDER BY priority DESC, created_at ASC").all() as Row[];
    return rows
      .map(toTask)
      .filter((t) => (filter.states ? filter.states.includes(t.machine.state) : true))
      .filter((t) => filter.includeFinished !== false || !["Done", "Dropped", "Ignored", "Replied"].includes(t.machine.state));
  }

  saveMachine(id: string, m: Machine) {
    this.db.prepare("UPDATE tasks SET state = ?, machine = ?, updated_at = ? WHERE id = ?").run(m.state, JSON.stringify(m), now(), id);
  }

  updateTask(id: string, patch: Partial<Pick<Task, "title" | "body" | "repo" | "recipe" | "tags" | "priority" | "branch" | "worktree" | "prUrl" | "notionJobId" | "notionReviewId" | "takenOver">>) {
    const cols: Record<string, string> = {
      title: "title",
      body: "body",
      repo: "repo",
      recipe: "recipe",
      tags: "tags",
      priority: "priority",
      branch: "branch",
      worktree: "worktree",
      prUrl: "pr_url",
      notionJobId: "notion_job_id",
      notionReviewId: "notion_review_id",
      takenOver: "taken_over",
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      values.push(Array.isArray(v) ? JSON.stringify(v) : typeof v === "boolean" ? (v ? 1 : 0) : ((v as string | number | undefined) ?? null));
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }

  addTokens(id: string, tokens: number) {
    this.db.prepare("UPDATE tasks SET tokens = tokens + ? WHERE id = ?").run(tokens, id);
  }

  addEvent(taskId: string, kind: string, actor: Actor, data: Record<string, unknown> = {}, from?: State, to?: State): number {
    const r = this.db
      .prepare("INSERT INTO events (task_id, at, kind, from_state, to_state, actor, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(taskId, now(), kind, from ?? null, to ?? null, actor, JSON.stringify(data));
    return Number(r.lastInsertRowid);
  }

  events(taskId: string): TaskEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY id").all(taskId) as Row[]).map((r) => ({
      id: Number(r.id),
      taskId: String(r.task_id),
      at: String(r.at),
      kind: String(r.kind),
      from: opt(r.from_state) as State | undefined,
      to: opt(r.to_state) as State | undefined,
      actor: r.actor as Actor,
      data: j(r.data, {}),
    }));
  }

  setting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return r ? j<T>(r.value, fallback) : fallback;
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  allSettings(): Record<string, unknown> {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Row[];
    return Object.fromEntries(rows.map((r) => [String(r.key), j(r.value, null)]));
  }
}

export { now, j as parseJson, opt };
export type { Row };

const PAST_PLANNING: readonly State[] = ["PlanGate", "Building", "Reviewing", "Confirming", "PRGate", "Done"];

function loadMachine(saved: Partial<Machine>): Machine {
  const fresh = initial();
  const m = { ...fresh, ...saved, tries: { ...fresh.tries, ...saved.tries }, loops: { ...fresh.loops, ...saved.loops } };
  // Tasks saved before the requirements review existed were never reviewed; don't strand them.
  if (saved.covered === undefined) m.covered = PAST_PLANNING.includes(m.state === "Parked" ? m.parkedFrom : m.state);
  return m;
}
