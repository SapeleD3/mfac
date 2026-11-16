import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Engine } from "../workflow/engine.js";
import type { Store } from "../workflow/store.js";

interface Entry {
  at: number;
  tokens: number;
  session: string;
}

const HOUR = 3_600_000;
const cache = new Map<string, { size: number; mtime: number; entries: Entry[] }>();

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

function parse(file: string): Entry[] {
  const st = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.entries;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const session = basename(file, ".jsonl");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const m = JSON.parse(line) as { timestamp?: string; requestId?: string; message?: { id?: string; usage?: Record<string, number> } };
      const u = m.message?.usage;
      if (!u || !m.timestamp) continue;
      // Streaming writes one line per content block with the same message id; count each message once.
      const key = `${m.message?.id ?? ""}:${m.requestId ?? ""}`;
      if (key !== ":" && seen.has(key)) continue;
      seen.add(key);
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      entries.push({ at: Date.parse(m.timestamp), tokens, session });
    } catch {}
  }
  cache.set(file, { size: st.size, mtime: st.mtimeMs, entries });
  return entries;
}

export function readUsage(days = 14, dir = claudeDir()): Entry[] {
  const root = join(dir, "projects");
  if (!existsSync(root)) return [];
  const since = Date.now() - days * 24 * HOUR;
  const out: Entry[] = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const pdir = join(root, project.name);
    for (const f of readdirSync(pdir)) {
      if (!f.endsWith(".jsonl")) continue;
      const file = join(pdir, f);
      try {
        if (statSync(file).mtimeMs < since) continue;
        for (const e of parse(file)) if (e.at >= since) out.push(e);
      } catch {}
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

interface Window {
  pct: number;
  resetsAt: number;
}

export interface PlanLimits {
  fiveHour?: Window;
  sevenDay?: Window;
  at: number;
}

export interface UsageReading {
  share?: number;
  weekly?: number;
  basis: "claude" | "unknown";
  asOf?: string;
  windowEndsAt?: string;
  weekEndsAt?: string;
  blocked: boolean;
  reason?: string;
}

const limitWindow = (w: unknown): Window | undefined => {
  const x = w as { used_percentage?: unknown; resets_at?: unknown } | undefined;
  return typeof x?.used_percentage === "number" && typeof x.resets_at === "number" ? { pct: x.used_percentage, resetsAt: x.resets_at * 1000 } : undefined;
};

/** Claude Code's status line input carries the plan's real limits for Pro and Max; the factory's own sessions pass them on. */
export function parseLimits(input: { rate_limits?: { five_hour?: unknown; seven_day?: unknown } }, now = Date.now()): PlanLimits | undefined {
  const fiveHour = limitWindow(input.rate_limits?.five_hour);
  const sevenDay = limitWindow(input.rate_limits?.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay, at: now } : undefined;
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

export function reading(limits: PlanLimits | undefined, opts: { ceiling: number; now?: number }): UsageReading {
  const now = opts.now ?? Date.now();
  const live = (w?: Window) => (w && w.resetsAt > now ? w : undefined);
  const five = live(limits?.fiveHour);
  const week = live(limits?.sevenDay);
  const share = five ? five.pct / 100 : undefined;
  const weekly = week ? week.pct / 100 : undefined;
  const fiveBlocked = share !== undefined && share >= opts.ceiling;
  const weekBlocked = weekly !== undefined && weekly >= opts.ceiling;
  const blocked = fiveBlocked || weekBlocked;
  return {
    share,
    weekly,
    basis: five || week ? "claude" : "unknown",
    asOf: five || week ? new Date(limits!.at).toISOString() : undefined,
    windowEndsAt: five ? new Date(five.resetsAt).toISOString() : undefined,
    weekEndsAt: week ? new Date(week.resetsAt).toISOString() : undefined,
    blocked,
    reason: fiveBlocked
      ? `plan usage at ${Math.round(share! * 100)}% of the 5-hour limit; resumes ${clock(five!.resetsAt)}`
      : weekBlocked
        ? `plan usage at ${Math.round(weekly! * 100)}% of the weekly limit; resumes ${new Date(week!.resetsAt).toDateString().slice(0, 10)} ${clock(week!.resetsAt)}`
        : undefined,
  };
}

export function assess(engine: Engine, store: Store): UsageReading {
  const r = reading(store.setting<PlanLimits | undefined>("plan_limits", undefined), { ceiling: engine.settings().usageCeiling });
  const before = store.setting<{ blocked?: boolean }>("usage_guard", {});
  store.setSetting("usage_guard", r);
  if (r.blocked !== !!before.blocked) {
    engine.emit("alert", {
      level: r.blocked ? "warn" : "info",
      message: r.blocked ? `Queue paused: ${r.reason}. Running stages finish.` : "Plan usage is back under the ceiling; the queue is running again.",
    });
  }
  return r;
}

export function recordLimits(engine: Engine, store: Store, input: Parameters<typeof parseLimits>[0]): string {
  const limits = parseLimits(input);
  if (limits) store.setSetting("plan_limits", limits);
  const r = assess(engine, store);
  return describe(r);
}

export function describe(r: UsageReading): string {
  if (r.basis === "unknown") return "plan usage unknown";
  const parts = [r.share !== undefined ? `5h ${Math.round(r.share * 100)}%` : "", r.weekly !== undefined ? `week ${Math.round(r.weekly * 100)}%` : ""].filter(Boolean);
  return `${parts.join(" · ")}${r.blocked ? " · queue paused" : ""}`;
}

export function guard(engine: Engine, store: Store): string {
  const r = assess(engine, store);
  const entries = readUsage();
  const stages = store.db.prepare("SELECT id, task_id, session_id, tokens FROM stages").all() as { id: string; task_id: string; session_id: string; tokens: number }[];
  const bySession = new Map<string, number>();
  for (const e of entries) bySession.set(e.session, (bySession.get(e.session) ?? 0) + e.tokens);
  for (const s of stages) {
    const t = bySession.get(s.session_id);
    if (t === undefined || t <= s.tokens) continue;
    store.db.prepare("UPDATE stages SET tokens = ? WHERE id = ?").run(t, s.id);
    store.addTokens(s.task_id, t - s.tokens);
  }
  return describe(r);
}
