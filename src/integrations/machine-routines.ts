import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export type Runner = (cmd: string, args: string[]) => Promise<string>;

const run: Runner = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? "" : String(out))));

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

function every(s: number): string {
  if (s % 86400 === 0) return s === 86400 ? "every day" : `every ${s / 86400} days`;
  if (s % 3600 === 0) return s === 3600 ? "every hour" : `every ${s / 3600} h`;
  if (s % 60 === 0) return `every ${s / 60} min`;
  return `every ${s}s`;
}

function calendar(c: Record<string, number>): string {
  const at = c.Hour !== undefined ? `at ${pad(c.Hour)}:${pad(c.Minute ?? 0)}` : c.Minute !== undefined ? `hourly at :${pad(c.Minute)}` : "every minute";
  if (c.Weekday !== undefined) return `${DAYS[c.Weekday]} ${at}`;
  if (c.Day !== undefined) return `day ${c.Day}${c.Month !== undefined ? ` of month ${c.Month}` : " of each month"} ${at}`;
  return c.Hour !== undefined ? `daily ${at}` : at;
}

export function launchdSchedule(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof p.StartInterval === "number") parts.push(every(p.StartInterval));
  const cal = p.StartCalendarInterval;
  if (cal) parts.push(...(Array.isArray(cal) ? cal : [cal]).map((c) => calendar(c as Record<string, number>)));
  if (Array.isArray(p.WatchPaths) || Array.isArray(p.QueueDirectories)) parts.push("when files change");
  if (p.KeepAlive) parts.push("kept running");
  if (p.RunAtLoad) parts.push("at login");
  return parts.join(", ") || "on demand";
}

export function launchctlState(list: string): Map<string, { pid?: number; status: number }> {
  const out = new Map<string, { pid?: number; status: number }>();
  for (const line of list.split("\n").slice(1)) {
    const [pid, status, label] = line.trim().split(/\t+/);
    if (label) out.set(label, { pid: pid && pid !== "-" ? Number(pid) : undefined, status: Number(status) || 0 });
  }
  return out;
}

export function cronEntries(table: string): { schedule: string; command: string }[] {
  return table
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^\w+=/.test(l))
    .map((l) => {
      const m = l.match(/^(@\w+)\s+(.+)$/) ?? l.match(/^((?:\S+\s+){4}\S+)\s+(.+)$/);
      return m ? { schedule: cronSchedule(m[1]!), command: m[2]! } : { schedule: "?", command: l };
    });
}

function cronSchedule(expr: string): string {
  const named: Record<string, string> = {
    "@reboot": "at startup",
    "@hourly": "every hour",
    "@daily": "every day",
    "@midnight": "every day",
    "@weekly": "every week",
    "@monthly": "every month",
    "@yearly": "every year",
    "@annually": "every year",
  };
  if (named[expr]) return named[expr]!;
  const [min, hour, dom, mon, dow] = expr.split(/\s+/);
  const step = min?.match(/^\*\/(\d+)$/);
  if (step && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `every ${step[1]} min`;
  if (/^\d+$/.test(min ?? "") && /^\d+$/.test(hour ?? "") && dom === "*" && mon === "*") {
    const at = `at ${pad(Number(hour))}:${pad(Number(min))}`;
    return dow === "*" ? `daily ${at}` : dow === "1-5" ? `weekdays ${at}` : /^\d$/.test(dow!) ? `${DAYS[Number(dow)]} ${at}` : expr;
  }
  return expr;
}

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  for (const line of m?.[1]?.split("\n") ?? []) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

export async function machineRoutines(opts: { home?: string; platform?: NodeJS.Platform; run?: Runner } = {}): Promise<MachineRoutine[]> {
  const home = opts.home ?? homedir();
  const sh = opts.run ?? run;
  const out: MachineRoutine[] = [];

  const agents = join(home, "Library", "LaunchAgents");
  if ((opts.platform ?? process.platform) === "darwin" && existsSync(agents)) {
    const loaded = launchctlState(await sh("launchctl", ["list"]));
    for (const f of readdirSync(agents)
      .filter((x) => x.endsWith(".plist"))
      .sort()) {
      const file = join(agents, f);
      let p: Record<string, unknown> = {};
      try {
        p = JSON.parse(await sh("plutil", ["-convert", "json", "-o", "-", file])) as Record<string, unknown>;
      } catch {
        out.push({ id: `launchd:${f}`, kind: "launchd", name: f.replace(/\.plist$/, ""), schedule: "?", state: "not loaded", detail: "couldn't read the plist", file, factory: false });
        continue;
      }
      const label = String(p.Label ?? f.replace(/\.plist$/, ""));
      const args = Array.isArray(p.ProgramArguments) ? (p.ProgramArguments as string[]) : p.Program ? [String(p.Program)] : [];
      const l = loaded.get(label);
      const state: MachineRoutine["state"] = p.Disabled === true ? "disabled" : !l ? "not loaded" : l.pid ? "running" : l.status !== 0 ? "failing" : "loaded";
      out.push({
        id: `launchd:${label}`,
        kind: "launchd",
        name: label,
        schedule: launchdSchedule(p),
        command: args.join(" "),
        state,
        detail: l?.pid ? `pid ${l.pid}` : l && l.status !== 0 ? `last exit ${l.status}` : undefined,
        file,
        factory: label.startsWith("com.sapeled3.factory"),
      });
    }
  }

  for (const [i, e] of cronEntries(await sh("crontab", ["-l"])).entries()) {
    out.push({ id: `cron:${i}`, kind: "cron", name: e.command.split(/\s+/)[0]!.split("/").pop()!, schedule: e.schedule, command: e.command, state: "scheduled", factory: false });
  }

  const tasks = join(home, ".claude", "scheduled-tasks");
  if (existsSync(tasks)) {
    for (const d of readdirSync(tasks, { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const skill = join(tasks, d.name, "SKILL.md");
      if (!existsSync(skill)) continue;
      const fm = frontmatter(readFileSync(skill, "utf8"));
      out.push({
        id: `claude:${d.name}`,
        kind: "claude",
        name: fm.name || d.name,
        schedule: fm.schedule || fm.cron || "set in Claude",
        command: fm.description,
        state: "scheduled",
        file: skill,
        factory: false,
      });
    }
  }
  return out;
}
