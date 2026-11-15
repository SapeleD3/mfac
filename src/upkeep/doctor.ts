import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installed as agentInstalled } from "./launchd.js";
import { paths } from "../shared/paths.js";
import { status as skillStatus } from "../skills/skills.js";
import { MODEL, embedderInstalled } from "../memory/embed.js";

export interface Check {
  name: string;
  status: "ok" | "warn" | "err";
  detail: string;
  fix?: string;
}

const run = (cmd: string, args: string[], timeout = 15_000) =>
  new Promise<{ ok: boolean; out: string; missing: boolean }>((done) =>
    execFile(cmd, args, { encoding: "utf8", timeout }, (err, stdout, stderr) => {
      const e = err as NodeJS.ErrnoException | null;
      done({ ok: !err, out: String(stdout || stderr || "").trim(), missing: e?.code === "ENOENT" });
    }),
  );

const version = (s: string) => s.match(/\d+(\.\d+)+/)?.[0] ?? s.split("\n")[0] ?? "";
const atLeast = (v: string, min: number[]) => {
  const p = v.split(".").map(Number);
  for (let i = 0; i < min.length; i++) if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i]!;
  return true;
};

export interface DoctorInput {
  engineUp?: boolean;
  connections?: { label: string; status: string; required: boolean; used: boolean }[];
  savedSkills?: Record<string, string>;
}

export async function doctor(input: DoctorInput = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const mac = process.platform === "darwin";

  const node = process.versions.node;
  const tools = await Promise.all([run("tmux", ["-V"]), run("git", ["--version"]), run("gh", ["--version"]), run("java", ["-version"])]);
  const [tmux, git, gh, java] = tools;
  const missing = [!tmux!.ok && "tmux", !git!.ok && "git"].filter(Boolean);
  checks.push({
    name: "Base tools",
    status: !atLeast(node, [22, 13]) || missing.length ? "err" : "ok",
    detail: [`node ${node}`, tmux!.ok ? version(tmux!.out).replace(/^/, "tmux ") : "no tmux", git!.ok ? `git ${version(git!.out)}` : "no git"].join(", "),
    fix: !atLeast(node, [22, 13]) ? "brew install node@22 (the factory needs 22.13+)" : missing.length ? `brew install ${missing.join(" ")}` : undefined,
  });
  checks.push({
    name: "GitHub CLI",
    status: gh!.ok ? "ok" : "warn",
    detail: gh!.ok ? `gh ${version(gh!.out)}` : "missing: branches are pushed, but PRs aren't opened",
    fix: gh!.ok ? undefined : "brew install gh && gh auth login",
  });
  checks.push({
    name: "Java (for TLC)",
    status: java!.ok ? "ok" : "err",
    detail: java!.ok ? version(java!.out) : "missing: the research rule can't run TLC",
    fix: java!.ok ? undefined : "brew install openjdk@21",
  });

  const claude = await run(process.env.FACTORY_CLAUDE ?? "claude", ["--version"]);
  checks.push({
    name: "Claude Code",
    status: !claude.ok ? "err" : process.env.ANTHROPIC_API_KEY ? "err" : "ok",
    detail: !claude.ok
      ? "the claude command isn't on PATH"
      : process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY is set: sessions would bill the API"
        : `${version(claude.out)}, subscription (no API key set)`,
    fix: !claude.ok ? "curl -fsSL https://claude.ai/install.sh | bash, then run claude once to sign in" : process.env.ANTHROPIC_API_KEY ? "unset ANTHROPIC_API_KEY in your shell profile" : undefined,
  });

  const sock = paths.socket();
  const mode = existsSync(sock) ? (statSync(sock).mode & 0o777).toString(8) : "";
  checks.push({
    name: "Engine",
    status: input.engineUp ? (mode === "600" ? "ok" : "warn") : "err",
    detail: input.engineUp ? `factoryd up · socket ${mode || "?"}` : "not running",
    fix: input.engineUp ? (mode === "600" ? undefined : "factory engine restart (the socket should be 0600)") : "factory engine start",
  });
  const db = paths.db();
  checks.push({
    name: "Database",
    status: existsSync(db) ? "ok" : "warn",
    detail: existsSync(db) ? `factory.db ${(statSync(db).size / 1_048_576).toFixed(1)} MB${existsSync(`${db}-wal`) ? " · WAL" : ""}` : "not created yet (the engine creates it)",
  });
  if (mac)
    checks.push({
      name: "Starts at login",
      status: agentInstalled() ? "ok" : "warn",
      detail: agentInstalled() ? "launch agent installed" : "not installed",
      fix: agentInstalled() ? undefined : "factory engine install",
    });

  if (tmux!.ok) {
    const sockName = `factory-doctor-${process.pid}`;
    const t0 = Date.now();
    const started = await run("tmux", ["-L", sockName, "new-session", "-d", "-s", "check", "sleep 5"]);
    const alive = started.ok && (await run("tmux", ["-L", sockName, "has-session", "-t", "check"])).ok;
    await run("tmux", ["-L", sockName, "kill-server"]);
    checks.push({ name: "Test session", status: alive ? "ok" : "err", detail: alive ? `tmux session started in ${Date.now() - t0} ms` : started.out || "tmux couldn't start a session" });
  }

  const jar = join(paths.tools(), "tla2tools-1.8.0.jar");
  checks.push({
    name: "TLC",
    status: existsSync(jar) ? "ok" : "warn",
    detail: existsSync(jar) ? "tla2tools.jar cached" : "downloaded on first research",
    fix: existsSync(jar) ? undefined : "node scripts/tlc.mjs --fetch (setup.sh does this)",
  });

  if (input.connections) {
    const bad = input.connections.filter((c) => c.status !== "connected" && c.used);
    checks.push({
      name: "Connections",
      status: bad.length ? "err" : "ok",
      detail: bad.length ? bad.map((c) => `${c.label} ${c.status}`).join(", ") : "all working",
      fix: bad.length ? "see Connections, or factory connections" : undefined,
    });
  }

  const skills = await skillStatus(input.savedSkills);
  const gaps = skills.filter((s) => s.status !== "ok");
  checks.push({
    name: "Skills",
    status: gaps.length ? "warn" : "ok",
    detail: gaps.length ? `${gaps.map((s) => s.name).join(", ")} missing` : `${skills.length} installed`,
    fix: gaps.length ? "factory skills install (or factory skills add <name> <source>)" : undefined,
  });

  const embeds = embedderInstalled();
  checks.push({
    name: "Memory",
    status: embeds ? "ok" : "warn",
    detail: embeds ? `on-device embeddings (${MODEL})` : "no embeddings: memory uses the graph and keywords only",
    fix: embeds ? undefined : "factory memory install",
  });

  if (mac) {
    const app = [join(homedir(), "Applications", "Factory.app"), "/Applications/Factory.app"].find(existsSync);
    checks.push({ name: "App", status: app ? "ok" : "warn", detail: app ?? "not installed (fine when headless)", fix: app ? undefined : "./setup.sh (without --headless)" });
  }
  return checks;
}
