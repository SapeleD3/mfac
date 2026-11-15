#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { latestSessionIn } from "../claude/print.js";
import { Client, call } from "../daemon/client.js";
import type { TaskView } from "../workflow/engine.js";
import { restartEngine, startEngine } from "./engine-control.js";
import { table } from "./format.js";
import { paths } from "../shared/paths.js";
import { isAlive } from "../daemon/server.js";
import { STATES, type State } from "../workflow/statechart.js";

export interface Command {
  usage: string;
  help: string;
  run(args: string[], flags: Flags): Promise<number | void>;
}
export type Flags = Record<string, string | boolean | string[]>;

export function parse(argv: string[]): { args: string[]; flags: Flags } {
  const args: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      const value = inline ?? (next !== undefined && !next.startsWith("--") && !["json", "all", "follow", "headless", "yes", "research", "backlog", "default", "new"].includes(k) ? (i++, next) : true);
      const prev = flags[k];
      flags[k] = prev === undefined ? value : ([] as string[]).concat(prev as string | string[], String(value));
    } else args.push(a);
  }
  return { args, flags };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const str = (v: Flags[string] | undefined) => (Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined);
const list = (v: Flags[string] | undefined) => (v === undefined || v === true ? [] : ([] as string[]).concat(v as string | string[]));
const out = (s = ""): void => void process.stdout.write(`${s}\n`);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function printTask(t: TaskView) {
  out(`${bold(t.id)}  ${t.title}`);
  out(`  state     ${t.machine.state}${t.rounds ? ` (${t.rounds})` : ""}  ·  column ${t.column}`);
  out(`  recipe    ${t.recipe}${t.tags.length ? `  ·  tags ${t.tags.join(", ")}` : ""}`);
  if (t.repo) out(`  repo      ${t.repo}${t.branch ? `  ·  ${t.branch}` : ""}`);
  if (t.sourceUrl) out(`  source    ${t.sourceUrl}`);
  if (t.prUrl) out(`  PR        ${t.prUrl}`);
  out(`  approved  ${t.machine.approved.join(", ") || "nothing yet"}`);
  out(`  can       ${t.allowed.join(", ") || "nothing (a stage is working)"}`);
}

function moveResult(r: { ok: boolean; reason?: string; task?: TaskView; action?: string }) {
  if (!r.ok) {
    process.stderr.write(`Refused: ${r.reason}\n`);
    return 1;
  }
  out(`${r.task!.id} is now ${r.task!.machine.state}${r.task!.rounds ? ` (${r.task!.rounds})` : ""}`);
  return 0;
}

export const commands: Record<string, Command> = {
  add: {
    usage: 'add "title" [--repo PATH] [--recipe feature|bugfix|research|review] [--tag TAG]... [--body TEXT] [--backlog]',
    help: "Queue a task by hand, or put it in the backlog (most work arrives from Slack, Jira and your Notion board)",
    async run(args, f) {
      const title = args.join(" ").trim();
      if (!title) throw new Error('give the task a title: factory add "Fix the export button"');
      const repo = str(f.repo);
      const t = await call<TaskView>("task.add", { title, body: str(f.body), repo: repo ? resolve(repo) : undefined, recipe: str(f.recipe), tags: list(f.tag), backlog: !!f.backlog });
      if (f.json) return out(JSON.stringify(t));
      out(`${f.backlog ? "Backlogged" : "Queued"} ${bold(t.id)}: ${t.title}`);
    },
  },
  chat: {
    usage: 'chat "title" [--chat SESSION_ID] [--repo PATH] [--research] [--to TASK | --new] < brief.md',
    help: "What /mfactory runs: hands a Claude Code chat to the factory as a task, or as context for the task that chat already started",
    async run(args, f) {
      const title = args.join(" ").trim();
      if (!title) throw new Error('give the task a title: factory chat "Build the export"');
      const body = (await readStdin()).trim();
      if (!body) throw new Error("pipe the handoff brief in on stdin");
      const repo = resolve(str(f.repo) ?? process.cwd());
      const given = str(f.chat);
      const chat = given && /^[0-9a-f-]{36}$/i.test(given) ? given : latestSessionIn(repo);
      if (!chat) throw new Error("couldn't tell which Claude Code chat this is; pass --chat <session id>");
      const r = await call<{ task: TaskView; how: string; followUp?: TaskView }>("task.fromChat", {
        chat,
        title,
        body,
        repo,
        recipe: f.research ? "research" : undefined,
        to: str(f.to),
        fresh: !!f.new,
      });
      const t = r.followUp ?? r.task;
      if (f.json) return out(JSON.stringify(r));
      const what =
        r.how === "new"
          ? `New ${t.machine.kind === "research" ? "research " : ""}task ${bold(t.id)} in ${t.repo ?? "no folder"}: ${t.title}. It starts when a slot frees.`
          : r.how === "followup"
            ? `${r.task.id} had finished, so this became follow-up ${bold(t.id)}: ${t.title}.`
            : r.how === "brief"
              ? `Added to ${bold(t.id)}'s brief; it hasn't started yet.`
              : `Sent to ${bold(t.id)}'s coordinator as new context; it reads it at its next step.`;
      out(`${what}\nWatch it in the Factory app or with: factory show ${t.id}`);
    },
  },
  context: {
    usage: 'context TASK "text" [--from WHO] [--url URL]',
    help: "Adds new context to a task: into its brief if it hasn't started, to its coordinator if it's running, or as a follow-up task if it finished",
    async run(args, f) {
      const [id, ...rest] = args;
      const text = rest.join(" ").trim() || (await readStdin()).trim();
      if (!id || !text) throw new Error('factory context F-012 "what changed"');
      const r = await call<{ how: string; followUp?: TaskView }>("task.context", { id, text, from: str(f.from) ?? "you", url: str(f.url) });
      out(r.followUp ? `${id} had finished, so this became follow-up ${bold(r.followUp.id)}.` : r.how === "brief" ? `Added to ${id}'s brief.` : `Sent to ${id}'s coordinator.`);
    },
  },
  ls: {
    usage: "ls [--all] [--json]",
    help: "The queue, grouped like the board",
    async run(_a, f) {
      const tasks = await call<TaskView[]>("task.list", { all: !!f.all });
      if (f.json) return out(JSON.stringify(tasks));
      if (!tasks.length) return out(dim("Nothing in the queue."));
      out(table([["ID", "COLUMN", "STATE", "ROUNDS", "TAGS", "TITLE"], ...tasks.map((t) => [t.id, t.column, t.machine.state, t.rounds ?? "", t.tags.join(","), t.title])]));
    },
  },
  show: {
    usage: "show ID [--json]",
    help: "One task: state, rounds, what can happen next, and its history",
    async run(args, f) {
      const r = await call<{ task: TaskView; events: { at: string; kind: string; actor: string; from?: string; to?: string; data: Record<string, unknown> }[] }>("task.get", { id: need(args[0]) });
      if (f.json) return out(JSON.stringify(r));
      printTask(r.task);
      out();
      for (const e of r.events.slice(-15)) {
        const note = typeof e.data.note === "string" && e.data.note ? ` "${e.data.note}"` : typeof e.data.reason === "string" ? ` (${e.data.reason})` : "";
        out(dim(`  ${e.at.slice(5, 16).replace("T", " ")}  ${e.actor.padEnd(11)} ${e.kind}${e.to ? ` → ${e.to}` : ""}${note}`));
      }
    },
  },
  approve: {
    usage: "approve ID [--note TEXT]",
    help: "Approve the work at a gate (research, plan or PR)",
    run: async (args, f) => moveResult(await call("task.decide", { id: need(args[0]), verdict: "approve", note: str(f.note) })),
  },
  "send-back": {
    usage: "send-back ID [--to Researching|Planning|Building] [--note TEXT]",
    help: "Send work back to a stage, with your overall note (max 3 per gate)",
    async run(args, f) {
      const to = str(f.to);
      if (to && !(STATES as readonly string[]).includes(to)) throw new Error(`--to must be a state, like Researching, Planning or Building`);
      return moveResult(await call("task.decide", { id: need(args[0]), verdict: "send_back", to: to as State | undefined, note: str(f.note) }));
    },
  },
  drop: {
    usage: "drop ID [--note TEXT]",
    help: "Drop a task at a gate, Needs you or Parked",
    run: async (args, f) => moveResult(await call("task.decide", { id: need(args[0]), verdict: "drop", note: str(f.note) })),
  },
  park: { usage: "park ID", help: "Park a card: it stops taking a slot and keeps its state", run: async (a) => moveResult(await call("task.park", { id: need(a[0]) })) },
  unpark: { usage: "unpark ID", help: "Put a parked card back exactly where it was", run: async (a) => moveResult(await call("task.unpark", { id: need(a[0]) })) },
  backlog: { usage: "backlog ID", help: "Move a queued task to the backlog: it waits and never takes a slot on its own", run: async (a) => moveResult(await call("task.demote", { id: need(a[0]) })) },
  prioritize: { usage: "prioritize ID", help: "Move a backlog task into the queue", run: async (a) => moveResult(await call("task.prioritize", { id: need(a[0]) })) },
  restore: {
    usage: "restore ID",
    help: "Take a task out of the bin: a parked one goes back where it was, a dropped one comes back as a new backlog task",
    run: async (a) => out(`Restored as ${(await call<TaskView>("task.restore", { id: need(a[0]) })).id}`),
  },
  stop: {
    usage: "stop ID [--note TEXT]",
    help: "Stop a running stage; the task goes to Needs you",
    run: async (a, f) => moveResult(await call("task.interrupt", { id: need(a[0]), note: str(f.note) })),
  },
  tag: {
    usage: "tag ID +learn -urgent ...",
    help: "Add (+) or remove (-) tags: learn, urgent, ui, sensitive, harden",
    async run(args) {
      const id = need(args[0]);
      const add = args
        .slice(1)
        .filter((a) => !a.startsWith("-"))
        .map((a) => a.replace(/^\+/, ""));
      const remove = args
        .slice(1)
        .filter((a) => a.startsWith("-"))
        .map((a) => a.slice(1));
      const t = await call<TaskView>("task.tag", { id, add, remove });
      out(`${t.id} tags: ${t.tags.join(", ") || "none"}`);
    },
  },
  watch: {
    usage: "watch",
    help: "Stream what the factory does, as it happens",
    async run() {
      const c = await new Client().connect();
      await c.subscribe((event, data) => {
        const d = data as { task?: TaskView; action?: string; actor?: string; reason?: string; message?: string };
        const time = new Date().toTimeString().slice(0, 8);
        if (d.task) out(`${dim(time)} ${bold(d.task.id)} ${event === "refused" ? `refused: ${d.reason}` : `${d.action ?? event} → ${d.task.machine.state}`}${d.actor ? dim(` (${d.actor})`) : ""}`);
        else out(`${dim(time)} ${event} ${d.message ?? JSON.stringify(data)}`);
      });
      out(dim("Watching the factory. Ctrl-C to stop."));
      await new Promise(() => {});
    },
  },
  settings: {
    usage: "settings [KEY=VALUE]...",
    help: "Show or change settings (slots, pollMinutes, usageCeiling, models.builder=opus, efforts.planner=high)",
    async run(args) {
      if (!args.length) return out(JSON.stringify(await call("settings.get"), null, 2));
      const current = await call<Record<string, unknown>>("settings.get");
      const patch: Record<string, unknown> = {};
      for (const a of args) {
        const [k, v] = a.split("=", 2) as [string, string | undefined];
        if (v === undefined) throw new Error(`write settings as key=value, like slots=2`);
        const value = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
        const [top, sub] = k.split(".", 2) as [string, string | undefined];
        if (sub) patch[top] = { ...((patch[top] ?? current[top]) as object), [sub]: value };
        else patch[top] = value;
      }
      out(JSON.stringify(await call("settings.set", patch), null, 2));
    },
  },
  engine: {
    usage: "engine start|stop|restart|status|run|install [--app PATH]|uninstall",
    help: "Control the background engine. install sets up the login agent (no admin); then macOS keeps it running",
    async run(args, flags) {
      const sub = args[0] ?? "status";
      const alive = await isAlive(paths.socket());
      if (sub === "status") {
        if (!alive) {
          out("Engine: not running");
          return 1;
        }
        const p = await call<{ pid: number; startedAt: string }>("ping");
        out(`Engine: running (pid ${p.pid}, since ${p.startedAt.slice(0, 16).replace("T", " ")})`);
        return 0;
      }
      if (sub === "run") {
        await import("../daemon/host.js").then(async (m) => {
          const { register } = await import("../main/plugins.js");
          register(m.plugins);
          await m.startEngine();
          out(`Engine running in the foreground on ${paths.socket()}. Ctrl-C to stop.`);
        });
        await new Promise(() => {});
      }
      if (sub === "install" || sub === "uninstall") {
        const ld = await import("../upkeep/launchd.js");
        const app = str(flags.app);
        const files = sub === "install" ? ld.install({ app }) : ld.uninstall();
        out(files.length ? files.map((f) => `${sub === "install" ? "Loaded" : "Removed"} ${f}`).join("\n") : "Nothing to remove");
        return 0;
      }
      if (sub === "restart") return out(await restartEngine());
      if (sub === "start") return out(await startEngine());
      if (sub === "stop") {
        if (!alive) return out("Engine: not running");
        const pid = existsSync(paths.pid()) ? Number(readFileSync(paths.pid(), "utf8")) : (await call<{ pid: number }>("ping")).pid;
        process.kill(pid, "SIGTERM");
        return out("Engine: stopping");
      }
      throw new Error(`unknown engine command ${sub}`);
    },
  },
};

function need(id: string | undefined): string {
  if (!id) throw new Error("which task? give its id, like F-001");
  return id;
}

export function help(): string {
  const rows = Object.values(commands).map((c) => [`  factory ${c.usage}`, c.help]);
  return `factory: your on-device software factory\n\n${rows.map(([u, h]) => `${u}\n      ${dim(h!)}`).join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    out(help());
    return 0;
  }
  const cmd = commands[name];
  if (!cmd) {
    process.stderr.write(`Unknown command "${name}". Run factory help.\n`);
    return 2;
  }
  const { args, flags } = parse(rest);
  try {
    return (await cmd.run(args, flags)) ?? 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

if (process.argv[1] && /(^|\/)(cli\.js|factory)$/.test(process.argv[1])) {
  const { extend } = await import("./stage-commands.js");
  extend(commands);
  const longRunning = process.argv[2] === "watch" || (process.argv[2] === "engine" && process.argv[3] === "run");
  process.exitCode = await main();
  if (!longRunning) process.exit(process.exitCode);
}
