import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { paths } from "../shared/paths.js";

export interface PrintOptions {
  model: string;
  effort?: string;
  system?: string;
  allowedTools?: string[];
  session?: string;
  timeoutMs?: number;
}

export class PrintTimeout extends Error {}

export type PrintRunner = (prompt: string, opts: PrintOptions) => Promise<string>;

export const ROTATE_TURNS = 30;
const ROTATE_MS = 7 * 86_400_000;

interface Pooled {
  id: string;
  turns: number;
  startedAt: string;
}

const poolFile = () => join(paths.sessions(), "sessions.json");
const readPool = (): Record<string, Pooled> => {
  try {
    return JSON.parse(readFileSync(poolFile(), "utf8")) as Record<string, Pooled>;
  } catch {
    return {};
  }
};
const writePool = (pool: Record<string, Pooled>) => {
  mkdirSync(paths.sessions(), { recursive: true });
  writeFileSync(poolFile(), JSON.stringify(pool, null, 2));
};

export const pooledSessions = () => readPool();

export function deleteTranscript(sessionId: string, claudeDir = process.env.FACTORY_CLAUDE_DIR ?? join(homedir(), ".claude")): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  const projects = join(claudeDir, "projects");
  if (!existsSync(projects)) return false;
  let found = false;
  for (const dir of readdirSync(projects)) {
    const f = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(f)) {
      rmSync(f);
      found = true;
    }
  }
  return found;
}

function claim(name: string): { id: string; resume: boolean } {
  const pool = readPool();
  const cur = pool[name];
  const stale = cur && (cur.turns >= ROTATE_TURNS || Date.now() - Date.parse(cur.startedAt) > ROTATE_MS);
  if (cur && !stale) {
    pool[name] = { ...cur, turns: cur.turns + 1 };
    writePool(pool);
    return { id: cur.id, resume: true };
  }
  if (cur) deleteTranscript(cur.id);
  const id = randomUUID();
  pool[name] = { id, turns: 1, startedAt: new Date().toISOString() };
  writePool(pool);
  return { id, resume: false };
}

function drop(name: string) {
  const pool = readPool();
  delete pool[name];
  writePool(pool);
}

const exec = (args: string[], prompt: string, timeoutMs = 5 * 60_000) =>
  new Promise<string>((resolve, reject) => {
    mkdirSync(paths.sessions(), { recursive: true });
    // With --tools "" there is no ToolSearch, so MCP tools Claude would defer must load up front or they never appear.
    const child = spawn(process.env.FACTORY_CLAUDE ?? "claude", args, { cwd: paths.sessions(), stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ENABLE_TOOL_SEARCH: "false" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (e) => reject(new Error(`couldn't run claude: ${e.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new PrintTimeout(`Claude didn't answer within ${Math.round(timeoutMs / 1000)}s`));
      else if (code === 0) resolve(out.trim());
      else reject(new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });

const queues = new Map<string, Promise<unknown>>();

function serial<T>(name: string, work: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(work);
  queues.set(name, next);
  return next;
}

export const realRunner: PrintRunner = (prompt, opts) => {
  const base = [
    "-p",
    "--model",
    opts.model,
    ...(opts.effort ? ["--effort", opts.effort] : []),
    "--output-format",
    "text",
    "--tools",
    "",
    ...(opts.system ? ["--append-system-prompt", opts.system] : []),
    ...(opts.allowedTools?.length ? ["--allowedTools", ...opts.allowedTools] : []),
  ];
  if (!opts.session) return exec(["--no-session-persistence", ...base], prompt, opts.timeoutMs);
  const name = opts.session;
  return serial(name, async () => {
    const s = claim(name);
    const args = (x: { id: string; resume: boolean }) => [...(x.resume ? ["--resume", x.id] : ["--session-id", x.id, "--name", name]), ...base];
    try {
      return await exec(args(s), prompt, opts.timeoutMs);
    } catch (e) {
      if (!s.resume || e instanceof PrintTimeout) throw e;
      drop(name);
      return exec(args(claim(name)), prompt, opts.timeoutMs);
    }
  });
};

export let runner: PrintRunner = realRunner;

export function setPrintRunner(r: PrintRunner) {
  runner = r;
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in the reply");
  const open = body[start]!;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1)) as T;
  }
  throw new Error("unterminated JSON in the reply");
}
