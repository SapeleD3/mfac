import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Engine } from "./engine.js";
import type { Store } from "./store.js";

interface Entry {
  at: number;
  tokens: number;
  session: string;
}

const HOUR = 3_600_000;
const WINDOW = 5 * HOUR;
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
    } catch {
    }
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
      } catch {
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function blocks(entries: Entry[]): { start: number; tokens: number }[] {
  const out: { start: number; tokens: number }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && e.at < last.start + WINDOW) last.tokens += e.tokens;
    else out.push({ start: Math.floor(e.at / HOUR) * HOUR, tokens: e.tokens });
  }
  return out;
}

export interface UsageReading {
  share: number;
  weekly?: number;
  used: number;
  limit: number;
  basis: "set" | "estimated";
  windowEndsAt?: string;
  blocked: boolean;
  reason?: string;
}

export function reading(entries: Entry[], opts: { ceiling: number; limit5h?: number; limitWeek?: number; now?: number }): UsageReading {
  const now = opts.now ?? Date.now();
  const bs = blocks(entries);
  const current = bs.length && now < bs[bs.length - 1]!.start + WINDOW ? bs[bs.length - 1]! : undefined;
  const used = current?.tokens ?? 0;
  const busiest = Math.max(0, ...bs.map((b) => b.tokens));
  const limit = opts.limit5h ?? Math.max(busiest, 1);
  const share = opts.limit5h || busiest > 0 ? Math.min(used / limit, 1.5) : 0;
  const week = entries.filter((e) => e.at > now - 7 * 24 * HOUR).reduce((a, e) => a + e.tokens, 0);
  const blocked = !!current && share >= opts.ceiling;
  return {
    share,
    weekly: opts.limitWeek ? week / opts.limitWeek : undefined,
    used,
    limit,
    basis: opts.limit5h ? "set" : "estimated",
    windowEndsAt: current ? new Date(current.start + WINDOW).toISOString() : undefined,
    blocked,
    reason: blocked ? `plan usage at ${Math.round(share * 100)}% of the 5h window; resumes ${new Date(current!.start + WINDOW).toTimeString().slice(0, 5)}` : undefined,
  };
}

export function guard(engine: Engine, store: Store): string {
  const entries = readUsage();
  const limits = store.setting<{ window5h?: number; weekly?: number }>("usage_limits", {});
  const r = reading(entries, { ceiling: engine.settings().usageCeiling, limit5h: limits.window5h, limitWeek: limits.weekly });
  const before = store.setting<{ blocked?: boolean }>("usage_guard", {});
  store.setSetting("usage_guard", r);
  if (r.blocked !== !!before.blocked) {
    engine.emit("alert", { level: r.blocked ? "warn" : "info", message: r.blocked ? `Queue paused: ${r.reason}. Running stages finish.` : "Plan usage is back under the ceiling; the queue is running again." });
  }

  const stages = store.db.prepare("SELECT id, task_id, session_id, tokens FROM stages").all() as { id: string; task_id: string; session_id: string; tokens: number }[];
  const bySession = new Map<string, number>();
  for (const e of entries) bySession.set(e.session, (bySession.get(e.session) ?? 0) + e.tokens);
  for (const s of stages) {
    const t = bySession.get(s.session_id);
    if (t === undefined || t <= s.tokens) continue;
    store.db.prepare("UPDATE stages SET tokens = ? WHERE id = ?").run(t, s.id);
    store.addTokens(s.task_id, t - s.tokens);
  }
  return `${Math.round(r.share * 100)}% of the 5h window (${r.basis})${r.blocked ? " · queue paused" : ""}`;
}
