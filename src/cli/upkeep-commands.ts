import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command, Flags } from "./cli.js";
import { call } from "../daemon/client.js";
import { type Check, doctor } from "../upkeep/doctor.js";
import { paths } from "../shared/paths.js";
import { isAlive } from "../daemon/server.js";
import { type SkillStatus, install as installSkills, status as skillStatus } from "../skills/skills.js";
import type { Retro } from "../upkeep/upkeep.js";
import { factoryRepo } from "../upkeep/upkeep.js";
import { relaunchApp } from "../upkeep/launchd.js";
import { restartEngine } from "./engine-control.js";

const out = (s = ""): void => void process.stdout.write(`${s}\n`);
const str = (v: Flags[string] | undefined) => (Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined);
const mark = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", err: "\x1b[31m✗\x1b[0m" };

async function viaEngine<T>(method: string, params: Record<string, unknown>, local: () => Promise<T>): Promise<T> {
  return (await isAlive(paths.socket())) ? call<T>(method, params) : local();
}

export const upkeepCommands: Record<string, Command> = {
  doctor: {
    usage: "doctor",
    help: "Check this Mac is ready: tools, Claude login, engine, database, login agent, TLC, connections, skills",
    async run() {
      const { checks } = await viaEngine<{ checks: Check[] }>("doctor.run", {}, async () => ({ checks: await doctor({ engineUp: false }) }));
      for (const c of checks) out(`${mark[c.status]} ${c.name.padEnd(18)} ${c.detail}${c.fix ? `\n  ${" ".repeat(18)} → ${c.fix}` : ""}`);
      const bad = checks.filter((c) => c.status === "err").length;
      out(bad ? `\n${bad} thing${bad === 1 ? "" : "s"} to fix.` : "\nReady.");
      return bad ? 1 : 0;
    },
  },
  skills: {
    usage: "skills [install|update|add NAME SOURCE]",
    help: "The factory's own skills (installed under ~/.factory, never in your ~/.claude/skills)",
    async run(args) {
      const sub = args[0];
      if (sub === "add") {
        if (!args[1] || !args[2]) throw new Error("factory skills add NAME SOURCE (a git URL or a folder)");
        for (const l of await call<string[]>("skills.add", { name: args[1], source: args[2] })) out(l);
        return 0;
      }
      if (sub === "install" || sub === "update") {
        const lines = await viaEngine<string[]>("skills.install", { update: sub === "update" }, () => installSkills({}, { update: sub === "update" }));
        for (const l of lines) out(l);
        return 0;
      }
      const list = await viaEngine<SkillStatus[]>("skills.list", {}, () => skillStatus());
      for (const s of list)
        out(
          `${s.status === "ok" ? mark.ok : mark.warn} ${s.name.padEnd(18)} ${s.status === "ok" ? `${s.version} · ${s.provides.join(", ")}` : s.status === "missing" ? "missing (factory skills install)" : "no source yet (factory skills add NAME SOURCE)"}`,
        );
      return 0;
    },
  },
  usage: {
    usage: "usage [--limit-5h TOKENS] [--limit-week TOKENS]",
    help: "Plan usage the guard sees, from Claude Code's own logs; set your plan's limits if you know them",
    async run(_args, flags) {
      const l5 = str(flags["limit-5h"]);
      const lw = str(flags["limit-week"]);
      if (l5 || lw) out(await call<string>("usage.limits", { window5h: l5 ? Number(l5) : undefined, weekly: lw ? Number(lw) : undefined }));
      const u = await call<{ share?: number; used?: number; limit?: number; basis?: string; blocked?: boolean; reason?: string; windowEndsAt?: string }>("usage.get");
      if (u.share === undefined) return out("No reading yet; the usage guard runs every 2 minutes.");
      out(
        `5h window: ${Math.round(u.share * 100)}% (${(u.used ?? 0).toLocaleString()} of ${(u.limit ?? 0).toLocaleString()} tokens, limit ${u.basis})${u.windowEndsAt ? ` · window ends ${u.windowEndsAt.slice(11, 16)}` : ""}`,
      );
      out(u.blocked ? `Queue paused: ${u.reason}` : "Queue running.");
    },
  },
  retro: {
    usage: "retro [TASK]",
    help: "What finished tasks cost and where they were sent back (the input to improve-factory)",
    async run(args) {
      const all = await call<Retro[]>("retro.list", { limit: 200 });
      const rs = args[0] ? all.filter((r) => r.taskId === args[0]) : all.slice(0, 20);
      for (const r of rs)
        out(
          `${r.taskId}  ${r.outcome.padEnd(7)} ${String(r.minutes).padStart(5)} min  ${r.tokens.toLocaleString().padStart(10)} tok  send-backs ${r.sendBacks.research}/${r.sendBacks.plan}/${r.sendBacks.pr}  loops ${r.loops.check}/${r.loops.review}/${r.loops.confirm}  ${r.title}`,
        );
      if (!rs.length) out("No retros yet. One is written when a task is done or dropped.");
    },
  },
  update: {
    usage: "update",
    help: "Pull the latest factory, rebuild, restart the engine, and rebuild, reinstall and reopen the app (unless --headless)",
    async run(_args, flags) {
      const repo = factoryRepo();
      const step = (label: string, cmd: string, a: string[], cwd = repo) => {
        out(`→ ${label}`);
        const r = spawnSync(cmd, a, { cwd, stdio: "inherit" });
        if (r.status !== 0) throw new Error(`${label} failed`);
      };
      step("git pull", "git", ["pull", "--ff-only"]);
      step("npm ci", "npm", ["ci", "--no-audit", "--no-fund"]);
      step("build", "npm", ["run", "build"]);
      const app = join(homedir(), "Applications", "Factory.app");
      const withApp = !flags.headless && process.platform === "darwin" && existsSync(join(repo, "app"));
      if (withApp) {
        step("app: npm ci", "npm", ["ci", "--no-audit", "--no-fund"], join(repo, "app"));
        step("app: build", "npm", ["run", "app"], join(repo, "app"));
        rmSync(app, { recursive: true, force: true });
        step("app: install", "ditto", [join(repo, "app", "src-tauri", "target", "release", "bundle", "macos", "Factory.app"), app]);
        writeFileSync(join(paths.home(), "app-built-from"), `${spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()}\n`);
      }
      out("→ engine: restart");
      out(await restartEngine());
      if (withApp) {
        out("→ app: reopen");
        out(relaunchApp(app) ? `Factory.app is running the new build: ${app}` : `Factory.app is installed at ${app}; open it from there (macOS didn't let it relaunch)`);
      }
    },
  },
};
