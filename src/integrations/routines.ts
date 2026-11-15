import { spawn } from "node:child_process";
import type { Engine } from "../workflow/engine.js";
import { type Row, type Store, now, opt } from "../workflow/store.js";

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
  lastDetail?: string;
  nextRunAt?: string;
  failures: number;
  defaultEverySeconds?: number;
}

export interface Builtin {
  id: string;
  name: string;
  description: string;
  everySeconds: number;
  workingHours?: boolean;
  enabled?: boolean;
  run: () => Promise<string>;
}

const toRoutine = (r: Row): Routine => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description ?? ""),
  everySeconds: Number(r.every_s),
  workingHours: Number(r.working_hours) === 1,
  enabled: Number(r.enabled) === 1,
  builtin: Number(r.builtin) === 1,
  command: opt(r.command),
  lastRunAt: opt(r.last_run_at),
  lastResult: opt(r.last_result) as Routine["lastResult"],
  lastDetail: opt(r.last_detail),
  nextRunAt: opt(r.next_run_at),
  failures: Number(r.failures ?? 0),
});

export function inWorkingHours(at: Date, hours: { start: number; end: number; weekends: boolean }): boolean {
  const day = at.getDay();
  if (!hours.weekends && (day === 0 || day === 6)) return false;
  const h = at.getHours() + at.getMinutes() / 60;
  return h >= hours.start && h < hours.end;
}

export function parseEvery(s: string): number {
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) throw new Error(`write the schedule like 10m, 2h or 1d (got "${s}")`);
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, "": 1 } as Record<string, number>)[m[2]!.toLowerCase()]!;
}

export class Routines {
  private builtins = new Map<string, Builtin>();
  private timer?: NodeJS.Timeout;
  private runningNow = new Set<string>();

  constructor(
    private store: Store,
    private engine: Engine,
  ) {}

  register(b: Builtin) {
    this.builtins.set(b.id, b);
    this.store.db
      .prepare(
        `INSERT INTO routines (id, name, description, every_s, working_hours, enabled, builtin, next_run_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, builtin = 1`,
      )
      .run(b.id, b.name, b.description, b.everySeconds, b.workingHours ? 1 : 0, b.enabled === false ? 0 : 1, new Date(Date.now() + 15_000).toISOString());
  }

  list(): Routine[] {
    return (this.store.db.prepare("SELECT * FROM routines ORDER BY builtin DESC, name").all() as Row[]).map((r) => this.withDefault(toRoutine(r)));
  }

  get(id: string): Routine | undefined {
    const r = this.store.db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as Row | undefined;
    return r ? this.withDefault(toRoutine(r)) : undefined;
  }

  private withDefault(r: Routine): Routine {
    const b = this.builtins.get(r.id);
    return b ? { ...r, defaultEverySeconds: b.everySeconds } : r;
  }

  history(id: string, limit = 20) {
    return this.store.db.prepare("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY id DESC LIMIT ?").all(id, limit) as Row[];
  }

  add(input: { name: string; every: string; command: string; workingHours?: boolean }): Routine {
    if (!input.name?.trim() || !input.command?.trim()) throw new Error("a routine needs a name and a command");
    const id = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (this.get(id)) throw new Error(`there's already a routine called ${id}`);
    const every = parseEvery(input.every);
    this.store.db
      .prepare("INSERT INTO routines (id, name, description, every_s, working_hours, enabled, builtin, command, next_run_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)")
      .run(id, input.name.trim(), `Runs: ${input.command}`, every, input.workingHours ? 1 : 0, input.command, new Date(Date.now() + every * 1000).toISOString());
    return this.emitChange(id);
  }

  update(id: string, patch: { enabled?: boolean; every?: string; workingHours?: boolean }): Routine {
    const r = this.get(id);
    if (!r) throw new Error(`no routine ${id}`);
    const every = patch.every ? parseEvery(patch.every) : r.everySeconds;
    this.store.db
      .prepare("UPDATE routines SET enabled = ?, every_s = ?, working_hours = ? WHERE id = ?")
      .run(patch.enabled === undefined ? (r.enabled ? 1 : 0) : patch.enabled ? 1 : 0, every, patch.workingHours === undefined ? (r.workingHours ? 1 : 0) : patch.workingHours ? 1 : 0, id);
    return this.emitChange(id);
  }

  remove(id: string) {
    const r = this.get(id);
    if (!r) throw new Error(`no routine ${id}`);
    if (r.builtin) throw new Error("built-in routines can be paused, not removed");
    this.store.db.prepare("DELETE FROM routines WHERE id = ?").run(id);
    return { removed: id };
  }

  private emitChange(id: string): Routine {
    const r = this.get(id)!;
    this.engine.emit("routine", { routine: r });
    return r;
  }

  async run(id: string, opts: { manual?: boolean } = {}): Promise<Routine> {
    const r = this.get(id);
    if (!r) throw new Error(`no routine ${id}`);
    if (this.runningNow.has(id)) return r;
    this.runningNow.add(id);
    const started = now();
    const runId = Number(this.store.db.prepare("INSERT INTO routine_runs (routine_id, started_at, result) VALUES (?, ?, 'running')").run(id, started).lastInsertRowid);
    this.store.db.prepare("UPDATE routines SET last_result = 'running', last_run_at = ? WHERE id = ?").run(started, id);
    this.emitChange(id);
    let result: "ok" | "warn" | "failed" | "skipped" = "ok";
    let detail = "";
    try {
      detail = r.builtin ? await this.builtins.get(id)!.run() : await shell(r.command!);
      const marked = detail.match(/^(skip|warn):\s*/);
      if (marked) {
        result = marked[1] === "skip" ? "skipped" : "warn";
        detail = detail.slice(marked[0].length);
      }
    } catch (e) {
      result = "failed";
      detail = e instanceof Error ? e.message : String(e);
    } finally {
      this.runningNow.delete(id);
    }
    const next = new Date(Date.now() + r.everySeconds * 1000).toISOString();
    this.store.db.prepare("UPDATE routine_runs SET ended_at = ?, result = ?, detail = ? WHERE id = ?").run(now(), result, detail.slice(0, 2000), runId);
    this.store.db
      .prepare("UPDATE routines SET last_result = ?, last_detail = ?, next_run_at = ?, failures = CASE WHEN ? = 'failed' THEN failures + 1 ELSE 0 END WHERE id = ?")
      .run(result, detail.slice(0, 500), opts.manual ? (r.nextRunAt ?? next) : next, result, id);
    const saved = this.emitChange(id);
    if (result === "failed" && saved.failures === 3) this.engine.emit("alert", { level: "warn", message: `Routine "${r.name}" has failed 3 times in a row: ${detail.slice(0, 160)}` });
    return saved;
  }

  async tick(at = new Date()) {
    const hours = this.engine.settings().workingHours;
    for (const r of this.list()) {
      if (!r.enabled || this.runningNow.has(r.id)) continue;
      if (r.nextRunAt && Date.parse(r.nextRunAt) > at.getTime()) continue;
      if (r.workingHours && !inWorkingHours(at, hours)) continue;
      await this.run(r.id);
    }
  }

  start(everyMs = 15_000) {
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

function shell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.SHELL ?? "/bin/sh", ["-lc", command], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = out.trim().split("\n").slice(-3).join(" ").slice(0, 300);
      code === 0 ? resolve(tail || "done") : reject(new Error(`exited ${code}: ${tail}`));
    });
  });
}
