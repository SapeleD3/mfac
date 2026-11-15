import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { call } from "../src/daemon/client.js";
import type { TaskView } from "../src/workflow/engine.js";
import { startEngine } from "../src/daemon/host.js";
import { type Stage, runnerPart } from "../src/stages/runner.js";
import { ticketsPart } from "../src/board/tickets.js";

const dir = mkdtempSync(join(tmpdir(), "factory-runner-"));
process.env.FACTORY_HOME = dir;
const socket = join(dir, "run", "factoryd.sock");
process.env.FACTORY_SOCKET = socket;

const alive = new Set<string>();
const started: { id: string; cwd: string; command: string[]; env: Record<string, string> }[] = [];
const pasted: { id: string; text: string }[] = [];
const fakeTmux = {
  start: (id: string, cwd: string, command: string[], env: Record<string, string> = {}) => {
    alive.add(id);
    started.push({ id, cwd, command, env });
  },
  isAlive: (id: string) => alive.has(id),
  paste: (id: string, text: string) => void pasted.push({ id, text }),
  keys: () => {},
  stop: (id: string) => void alive.delete(id),
  capture: () => "screen",
  live: () => new Set(alive),
  idleSeconds: () => 0,
};
let tlcPasses = true;
const fakeTlc = async () => ({ ok: tlcPasses, states: 42, output: tlcPasses ? "No error has been found." : "Error: Invariant Safe is violated." });

let running: Awaited<ReturnType<typeof startEngine>>;
const c = <T = unknown>(method: string, params: unknown = {}) => call<T>(method, params, socket);
const coord = (task: string, command: string, args: Record<string, unknown> = {}) => c<string>("coord.do", { task, command, args });
const sessionOf = async (stageId: string) => (await c<Stage[]>("stage.list", {})).find((s) => s.id === stageId)!.sessionId;
const job = (id: string) => join(dir, "jobs", id);
const lastPaste = () => pasted[pasted.length - 1]!;

let repo: string;

before(async () => {
  repo = mkdtempSync(join(tmpdir(), "factory-repo-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  running = await startEngine({ plugins: [ticketsPart, runnerPart({ tmux: fakeTmux, tlc: fakeTlc, tickSeconds: 3600, permissionTimeoutMs: 2000 })] });
});
after(async () => {
  await running.stop();
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const REQUIREMENTS = [
  "# Requirements",
  "### R1: Export downloads a CSV",
  '- Source: "the export button does nothing"',
  "- Acceptance: Given a report, when I click Export, then a CSV downloads",
  "- Verify by: the export test",
  "## Out of scope",
  "None",
  "## Open questions",
  "None",
].join("\n");

test("a task runs from queue to PR gate, with the engine holding every rule", async () => {
  await c("settings.set", { slots: 1, efforts: { coordinator: "high" } });
  await assert.rejects(c("settings.set", { efforts: { builder: "extreme" } }), /effort for builder/);
  const t = await c<TaskView>("task.add", { title: "Fix the export button", repo, tags: ["ui"] });
  const other = await c<TaskView>("task.add", { title: "Second task waits for a slot" });
  await c("factory.tick");
  const now = await c<{ task: TaskView }>("task.get", { id: t.id });
  assert.equal(now.task.machine.state, "Researching");
  assert.ok(now.task.worktree?.includes(join("worktrees")), "worktree created");
  assert.equal((await c<{ task: TaskView }>("task.get", { id: other.id })).task.machine.state, "Queued", "one slot only");

  const coordStart = started.find((s) => s.id === `${t.id}-coordinator-1`)!;
  assert.ok(coordStart.command.includes("opus"));
  assert.equal(coordStart.command[coordStart.command.indexOf("--effort") + 1], "high", "the stage's effort setting reaches claude");
  assert.ok(coordStart.command.includes("--settings"));
  assert.equal(coordStart.env.FACTORY_TASK, t.id);
  assert.equal(coordStart.cwd, now.task.worktree);

  await assert.rejects(coord(t.id, "run", { role: "builder" }), /builder runs in Building/);
  assert.match(await coord(t.id, "run", { role: "researcher" }), /Started/);
  await assert.rejects(coord(t.id, "run", { role: "researcher" }), /still running/);

  await c("hook.stop", { session_id: await sessionOf(`${t.id}-researcher-1`) });
  assert.match(lastPaste().text, /without writing research.md/);

  writeFileSync(join(job(t.id), "research.md"), "# Research\nThe button posts the wrong form.");
  writeFileSync(join(job(t.id), "requirements.md"), REQUIREMENTS);
  writeFileSync(join(job(t.id), "statechart.md"), "```mermaid\nstateDiagram-v2\n  Idle --> Exporting: click\n```\n");
  writeFileSync(join(job(t.id), "Export.tla"), "---- MODULE Export ----\n====");
  writeFileSync(join(job(t.id), "Export.cfg"), "INVARIANT Safe");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-researcher-1`) });
  assert.equal(lastPaste().id, `${t.id}-coordinator-1`);
  assert.match(lastPaste().text, /researcher-1 finished and wrote research.md/);

  tlcPasses = false;
  assert.match(await coord(t.id, "submit-research"), /check failed \(round 1\/3\)[\s\S]*Invariant Safe is violated/);
  tlcPasses = true;
  await coord(t.id, "run", { role: "researcher", note: "fix the model" });
  writeFileSync(join(job(t.id), "research.md"), "# Research v2");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-researcher-2`) });
  assert.match(await coord(t.id, "submit-research"), /research gate is open/);
  assert.equal(alive.has(`${t.id}-coordinator-1`), false, "coordinator's session freed at the gate");

  await assert.rejects(c("task.move", { id: t.id, event: { type: "approve" }, actor: "coordinator" }), /person's decision/);
  await c("task.decide", { id: t.id, verdict: "approve", note: "Good, keep the CSV path" });
  await new Promise((r) => setTimeout(r, 30));
  const resumed = started.filter((s) => s.id === `${t.id}-coordinator-1`).pop()!;
  assert.ok(resumed.command.includes("--resume"));
  assert.ok(resumed.command.some((a) => a.includes("Keep the CSV path") || a.includes("keep the CSV path")));

  await coord(t.id, "run", { role: "planner" });
  const filed = await call<{ id: string; createdBy: string }>("ticket.add", { task: t.id, title: "Fix form target", createdBy: "planner", pickedUpBy: "builder", check: "export test passes" }, socket);
  assert.equal(filed.createdBy, "planner");
  writeFileSync(join(job(t.id), "plan.md"), "# Plan\nFix the form target.");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-planner-1`) });
  assert.match(await coord(t.id, "submit-plan"), /requirements_review-1[\s\S]*never mentions R1/);
  writeFileSync(join(job(t.id), "review-requirements.md"), "| R1 | missing |\nVERDICT: gaps");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-requirements_review-1`) });
  assert.match(lastPaste().text, /requirements review finished/);
  await assert.rejects(coord(t.id, "requirements", { covered: true }), /never mentions R1/);
  assert.match(await coord(t.id, "requirements", { gaps: true }), /back to the planner \(round 1\/3\)/);
  await coord(t.id, "run", { role: "planner", note: "trace R1" });
  writeFileSync(join(job(t.id), "plan.md"), "# Plan\n## Traceability\n| R1 | Fix form target | export test |");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-planner-2`) });
  await coord(t.id, "submit-plan");
  writeFileSync(join(job(t.id), "review-requirements.md"), "| R1 | covered |\nVERDICT: covered");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-requirements_review-2`) });
  assert.match(await coord(t.id, "requirements", { covered: true }), /plan gate is open/);
  await c("task.decide", { id: t.id, verdict: "approve" });

  await coord(t.id, "run", { role: "builder" });
  writeFileSync(join(job(t.id), "build.md"), "# Build");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-builder-1`) });
  assert.match(await coord(t.id, "submit-build"), /code_review-1.*security_review-1.*ui_review-1/);

  const before = pasted.length;
  for (const role of ["code_review", "security_review"]) {
    writeFileSync(join(job(t.id), `review-${role.split("_")[0]}.md`), "Blocking findings: 0");
    await c("hook.stop", { session_id: await sessionOf(`${t.id}-${role}-1`) });
  }
  assert.equal(pasted.length, before, "no message until every review is in");
  writeFileSync(join(job(t.id), "review-ui.md"), "Blocking findings: 1");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-ui_review-1`) });
  assert.match(lastPaste().text, /All reviews finished/);

  await assert.rejects(coord(t.id, "findings", { blocking: 1 }), /review-compiled.md first/);
  writeFileSync(join(job(t.id), "review-compiled.md"), "1. Button has no label");
  assert.match(await coord(t.id, "findings", { blocking: 1 }), /back to the builder \(round 1\/3\)/);
  await coord(t.id, "run", { role: "builder" });
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-builder-2`) });
  await coord(t.id, "submit-build");
  for (const role of ["code_review", "security_review", "ui_review"]) await c("hook.stop", { session_id: await sessionOf(`${t.id}-${role}-2`) });
  assert.match(await coord(t.id, "findings", { blocking: 0 }), /Run the confirm stage/);

  await coord(t.id, "run", { role: "confirm" });
  writeFileSync(join(job(t.id), "confirm.md"), "| R1 | clicked export | csv.png | FAIL |\nVERDICT: not solved");
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-confirm-1`) });
  await assert.rejects(coord(t.id, "confirm", { solved: true }), /R1 failed[\s\S]*VERDICT: solved/);
  writeFileSync(join(job(t.id), "confirm.md"), "| R1 | clicked export | csv.png | PASS |\nVERDICT: solved");
  assert.match(await coord(t.id, "confirm", { solved: true }), /PR gate is open/);
  const final = (await c<{ task: TaskView }>("task.get", { id: t.id })).task;
  assert.equal(final.machine.state, "PRGate");
  assert.equal(final.machine.loops.review, 1);

  await c("factory.tick");
  assert.equal((await c<{ task: TaskView }>("task.get", { id: other.id })).task.machine.state, "Researching");
});

test("permission requests wait for your click in the panel", async () => {
  const t = (await c<TaskView[]>("task.list", {})).find((x) => x.machine.state === "Researching")!;
  await coord(t.id, "run", { role: "researcher" });
  const session = await sessionOf(`${t.id}-researcher-1`);
  const pending = c<{ behavior: string }>("hook.permission", { session_id: session, tool_name: "Bash", tool_input: { command: "brew install foo" } });
  await new Promise((r) => setTimeout(r, 50));
  const prompts = await c<{ id: string; payload: { tool: string } }[]>("prompt.list", {});
  assert.equal(prompts[0]!.payload.tool, "Bash");
  await c("prompt.answer", { id: prompts[0]!.id, allow: false, message: "Not on the work Mac" });
  assert.deepEqual(await pending, { behavior: "deny", message: "Not on the work Mac" });

  const unanswered = await c<{ behavior: string }>("hook.permission", { session_id: session, tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(unanswered.behavior, "ask");
});

test("stopping a running task sends it to Needs you and ends its sessions", async () => {
  const t = (await c<TaskView[]>("task.list", {})).find((x) => x.machine.state === "Researching")!;
  const r = await c<{ ok: boolean; task: TaskView }>("task.interrupt", { id: t.id });
  assert.equal(r.task.machine.state, "NeedsYou");
  assert.equal(alive.has(`${t.id}-researcher-1`), false);
});

test("taking over holds the coordinator's messages until you hand back", async () => {
  const t = await c<TaskView>("task.add", { title: "Third" });
  await c("settings.set", { slots: 3 });
  await c("factory.tick");
  await c("session.takeover", { task: t.id, on: true });
  await coord(t.id, "run", { role: "researcher" });
  writeFileSync(join(job(t.id), "research.md"), "x");
  const n = pasted.length;
  await c("hook.stop", { session_id: await sessionOf(`${t.id}-researcher-1`) });
  assert.equal(pasted.length, n);
  await c("session.takeover", { task: t.id, on: false });
  assert.match(lastPaste().text, /researcher-1 finished/);
});
