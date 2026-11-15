import { resolve } from "node:path";
import { call } from "./client.js";
import type { Command, Flags } from "./cli.js";
import { connectCommands } from "./cli-connect.js";
import { table } from "./format.js";
import type { TaskView } from "./engine.js";
import type { Prompt, Stage } from "./runner.js";
import type { Ticket } from "./tickets.js";
import * as tmux from "./tmux.js";

const out = (s = ""): void => void process.stdout.write(`${s}\n`);
const str = (v: Flags[string] | undefined) => (Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined);

/** Which task a session is working on: --task, or the FACTORY_TASK the runner sets in every session. */
function taskOf(f: Flags, arg?: string): string {
  const id = str(f.task) ?? arg ?? process.env.FACTORY_TASK;
  if (!id) throw new Error("which task? pass --task F-001 (inside a factory session it's automatic)");
  return id;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Commands added by later milestones. */
export function extend(commands: Record<string, Command>) {
  Object.assign(commands, {
    coord: {
      usage: "coord status|run ROLE|submit-research|submit-plan|submit-build|findings --blocking N|confirm --solved|needs-you|harden TITLE",
      help: "The coordinator's tools (used by the Opus coordinator session; the engine checks each one)",
      async run(args: string[], f: Flags) {
        const [command, ...rest] = args;
        if (!command) throw new Error("coord needs a command; see factory help");
        const a: Record<string, unknown> = { ...f };
        if (command === "run") a.role = rest[0];
        if (command === "harden") a.title = rest.join(" ");
        const text = await call<string>("coord.do", { task: taskOf(f), command, args: a });
        out(text);
      },
    },
    ticket: {
      usage: 'ticket add "TITLE" [--check TEXT] [--picked-up-by STAGE] | ls | done ID | move ID STATUS',
      help: "Tickets on the task's board (stages file them; you can too)",
      async run(args: string[], f: Flags) {
        const [sub, ...rest] = args;
        const task = taskOf(f);
        if (sub === "add") {
          const t = await call<Ticket>("ticket.add", { task, title: rest.join(" "), check: str(f.check), pickedUpBy: str(f["picked-up-by"]), createdBy: str(f["created-by"]) ?? process.env.FACTORY_ROLE ?? "you" });
          return out(`Filed ${t.id}: ${t.title}`);
        }
        if (sub === "done" || sub === "move") {
          const t = await call<Ticket>("ticket.update", { id: rest[0], patch: { status: sub === "done" ? "Done" : rest.slice(1).join(" ") } });
          return out(`${t.id} is ${t.status}`);
        }
        const list = await call<Ticket[]>("ticket.list", { task });
        if (!list.length) return out("No tickets yet.");
        out(table([["ID", "STATUS", "CREATED BY", "PICKED UP BY", "TITLE"], ...list.map((t) => [t.id, t.status, t.createdBy, t.pickedUpBy ?? "", t.title])]));
      },
    },
    hook: {
      usage: "hook stop|permission|question",
      help: "Claude Code hooks call these; they read the hook's JSON on stdin",
      async run(args: string[]) {
        const input = JSON.parse((await readStdin()) || "{}") as Record<string, unknown>;
        try {
          if (args[0] === "stop") await call("hook.stop", input);
          else if (args[0] === "question") await call("hook.question", input);
          else if (args[0] === "permission") {
            const d = await call<{ behavior: string; message?: string }>("hook.permission", input);
            if (d.behavior === "allow" || d.behavior === "deny")
              out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: d.behavior, ...(d.message ? { message: d.message } : {}) } } }));
          }
        } catch {
          // The engine is down: say nothing, and Claude Code carries on as if there were no hook.
        }
        return 0;
      },
    },
    sessions: {
      usage: "sessions [--task ID] [--all]",
      help: "Claude sessions the factory is running",
      async run(_a: string[], f: Flags) {
        const stages = (await call<Stage[]>("stage.list", { task: str(f.task) })).filter((s) => f.all || s.status === "running");
        if (!stages.length) return out("No sessions running.");
        out(table([["STAGE", "STATUS", "MODEL", "STARTED", "SESSION"], ...stages.map((s) => [s.id, s.status, s.model, s.startedAt.slice(11, 16), s.sessionId])]));
      },
    },
    attach: {
      usage: "attach STAGE|TASK",
      help: "Open a stage's live Claude session in this terminal (Ctrl-] d to leave). Take over first to type.",
      async run(args: string[]) {
        const id = args[0];
        if (!id) throw new Error("which session? factory attach F-001 (its coordinator) or F-001-builder-2");
        const stages = await call<Stage[]>("stage.list", {});
        const s = stages.filter((x) => x.id === id || (x.taskId.toLowerCase() === id.toLowerCase() && x.status === "running")).pop();
        if (!s) throw new Error(`no running session for ${id}`);
        return tmux.attach(s.id);
      },
    },
    "take-over": {
      usage: "take-over TASK [--off]",
      help: "Type into a task's sessions yourself; the coordinator waits until you hand back with --off",
      async run(args: string[], f: Flags) {
        const t = await call<TaskView>("session.takeover", { task: taskOf(f, args[0]), on: !f.off });
        out(t.takenOver ? `You have ${t.id}. Run factory take-over ${t.id} --off to hand it back.` : `${t.id} is back with its coordinator.`);
      },
    },
    prompts: {
      usage: "prompts",
      help: "Permission requests and questions waiting for you",
      async run() {
        const list = await call<Prompt[]>("prompt.list", {});
        if (!list.length) return out("Nothing waiting for you.");
        for (const p of list) {
          if (p.kind === "permission") out(`${p.id}  ${p.taskId ?? ""} ${p.payload.role ?? ""} wants ${p.payload.tool}: ${JSON.stringify(p.payload.input).slice(0, 160)}`);
          else out(`${p.id}  ${p.taskId ?? ""} asks: ${p.payload.question}\n${(p.payload.options ?? []).map((o, i) => `      ${i + 1}. ${o}`).join("\n")}`);
        }
      },
    },
    allow: { usage: "allow PROMPT", help: "Allow a waiting permission request", run: async (a: string[]) => out(`${(await call<Prompt>("prompt.answer", { id: a[0], allow: true })).status}`) },
    deny: {
      usage: "deny PROMPT [--note TEXT]",
      help: "Deny a waiting permission request",
      run: async (a: string[], f: Flags) => out(`${(await call<Prompt>("prompt.answer", { id: a[0], allow: false, message: str(f.note) })).status}`),
    },
    answer: { usage: "answer PROMPT N", help: "Pick option N for a question a session asked", run: async (a: string[]) => out(`${(await call<Prompt>("prompt.answer", { id: a[0], option: Number(a[1]) })).status}`) },
    pause: { usage: "pause", help: "Stop starting new tasks (running ones finish their stage)", run: async () => out(JSON.stringify(await call("factory.pause", { paused: true }))) },
    resume: { usage: "resume", help: "Start taking tasks again", run: async () => out(JSON.stringify(await call("factory.pause", { paused: false }))) },
    "set-repo": {
      usage: "set-repo TASK PATH",
      help: "Point a task at a repo (before it starts)",
      run: async (a: string[]) => out(`${(await call<TaskView>("task.update", { id: a[0], patch: { repo: resolve(a[1] ?? ".") } })).repo}`),
    },
    tlc: {
      usage: "tlc MODEL.tla",
      help: "Model-check a TLA+ spec with TLC (the research stage uses this)",
      async run(args: string[]) {
        const { realTlc } = await import("./research-check.js");
        const r = await realTlc(resolve(args[0] ?? "spec/Factory.tla"));
        out(r.output.split("\n").slice(-25).join("\n"));
        out(r.ok ? `TLC passed: ${r.states} distinct states.` : "TLC FAILED.");
        return r.ok ? 0 : 1;
      },
    },
  } satisfies Record<string, Command>);
  Object.assign(commands, connectCommands);
}
