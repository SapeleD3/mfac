import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client, call } from "../src/daemon/client.js";
import type { TaskView } from "../src/workflow/engine.js";
import { startEngine } from "../src/daemon/host.js";
import { main } from "../src/cli/cli.js";

const dir = mkdtempSync(join(tmpdir(), "factory-test-"));
process.env.FACTORY_HOME = dir;
const socket = join(dir, "run", "factoryd.sock");
process.env.FACTORY_SOCKET = socket;
let running: Awaited<ReturnType<typeof startEngine>>;

before(async () => {
  running = await startEngine({ plugins: [] });
});
after(async () => {
  await running.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("the socket is a file only this user can open, and nothing listens on a port", () => {
  const mode = statSync(socket).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(statSync(join(dir, "run")).mode & 0o777, 0o700);
});

test("a task walks the whole line through the socket, with the engine refusing skipped steps", async () => {
  const t = await call<TaskView>("task.add", { title: "Fix the export button", tags: ["ui"] }, socket);
  assert.equal(t.machine.state, "Queued");
  assert.equal(t.column, "Queued");
  const move = (event: object, actor = "coordinator") => call<{ ok: boolean; reason?: string; task?: TaskView }>("task.move", { id: t.id, event, actor }, socket);

  const skip = await move({ type: "build_done" });
  assert.equal(skip.ok, false);
  await assert.rejects(move({ type: "approve" }), /person's decision/);

  assert.ok((await move({ type: "start" })).ok);
  assert.ok((await move({ type: "research_done", chart: true, proved: true })).ok);
  assert.equal((await move({ type: "check" })).task!.machine.state, "ResearchGate");
  const sent = await call<{ ok: boolean; task: TaskView }>("task.decide", { id: t.id, verdict: "send_back", note: "Cover the CSV path too" }, socket);
  assert.equal(sent.task.machine.state, "Researching");
  assert.equal(sent.task.machine.tries.ResearchGate, 1);
  await move({ type: "research_done", chart: true, proved: true });
  await move({ type: "check" });
  await call("task.decide", { id: t.id, verdict: "approve" }, socket);
  await move({ type: "plan_done" });
  const gaps = await move({ type: "requirements_done", covered: false });
  assert.equal(gaps.task!.machine.state, "Planning");
  assert.equal(gaps.task!.machine.loops.requirements, 1);
  await move({ type: "plan_done" });
  assert.equal((await move({ type: "requirements_done", covered: true })).task!.machine.state, "PlanGate");
  await call("task.decide", { id: t.id, verdict: "approve" }, socket);
  await move({ type: "build_done" });
  assert.equal((await move({ type: "reviews_done", findings: true })).task!.machine.state, "Building");
  await move({ type: "build_done" });
  await move({ type: "reviews_done", findings: false });
  const pr = await move({ type: "confirm_done", confirmed: true });
  assert.equal(pr.task!.machine.state, "PRGate");
  assert.equal(pr.task!.column, "PR ready");
  const done = await call<{ ok: boolean; task: TaskView }>("task.decide", { id: t.id, verdict: "approve" }, socket);
  assert.equal(done.task.machine.state, "Done");

  const { events } = await call<{ events: { kind: string; actor: string; data: { note?: string } }[] }>("task.get", { id: t.id }, socket);
  assert.ok(events.some((e) => e.kind === "refused" && e.actor === "coordinator"));
  assert.ok(events.some((e) => e.data.note === "Cover the CSV path too"));
});

test("subscribers hear every change", async () => {
  const c = await new Client(socket).connect();
  const heard: string[] = [];
  await c.subscribe((event, data) => heard.push(`${event}:${(data as { task?: TaskView }).task?.machine.state}`));
  const t = await call<TaskView>("task.add", { title: "Spike: how does sync work?", tags: ["learn"] }, socket);
  await call("task.park", { id: t.id }, socket);
  await new Promise((r) => setTimeout(r, 50));
  c.close();
  assert.deepEqual(heard, ["change:Queued", "change:Parked"]);
});

test("the backlog holds work off the queue and the bin gives it back", async () => {
  const t = await call<TaskView>("task.add", { title: "Tidy the settings copy", backlog: true }, socket);
  assert.equal(t.column, "Backlog");
  const queued = await call<{ ok: boolean; task: TaskView }>("task.prioritize", { id: t.id }, socket);
  assert.equal(queued.task.column, "Queued");
  assert.equal((await call<{ task: TaskView }>("task.demote", { id: t.id }, socket)).task.column, "Backlog");
  await assert.rejects(call("task.move", { id: t.id, event: { type: "prioritize" }, actor: "coordinator" }, socket), /person's decision/);

  assert.equal((await call<{ task: TaskView }>("task.park", { id: t.id }, socket)).task.column, "Bin");
  const back = await call<TaskView>("task.restore", { id: t.id }, socket);
  assert.equal(back.machine.state, "Backlog");

  await call("task.move", { id: t.id, event: { type: "drop" }, actor: "human" }, socket);
  const dropped = await call<{ task: TaskView }>("task.get", { id: t.id }, socket);
  assert.equal(dropped.task.column, "Bin");
  const copy = await call<TaskView>("task.restore", { id: t.id }, socket);
  assert.notEqual(copy.id, t.id);
  assert.equal(copy.column, "Backlog");
  assert.match(copy.body, new RegExp(`Restored from ${t.id}`));
});

test("tags are checked and urgent jumps the queue", async () => {
  const t = await call<TaskView>("task.add", { title: "Checkout is down" }, socket);
  const tagged = await call<TaskView>("task.tag", { id: t.id, add: ["urgent"] }, socket);
  assert.ok(tagged.priority >= 10);
  await assert.rejects(call("task.tag", { id: t.id, add: ["shiny"] }, socket), /unknown tag shiny/);
  const list = await call<TaskView[]>("task.list", {}, socket);
  assert.equal(list[0]!.id, t.id);
});

test("the CLI talks to the same engine", async () => {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stdout.write;
  try {
    assert.equal(await main(["add", "Write", "the", "docs", "--tag", "learn"]), 0);
    assert.equal(await main(["ls"]), 0);
    assert.equal(await main(["drop", "F-001"]), 1);
  } finally {
    process.stdout.write = write;
  }
  assert.match(lines.join(""), /Queued F-\d+: Write the docs/);
  assert.match(lines.join(""), /COLUMN/);
});

test("a chat hands its work to one task: new context goes to that task, and once it's done to a follow-up", async () => {
  const chat = "11111111-2222-3333-4444-555555555555";
  const first = await call<{ task: TaskView; how: string }>(
    "task.fromChat",
    { chat, title: "Which queue should we use", body: "Compare SQS and Kafka for the events.", recipe: "research", repo: dir },
    socket,
  );
  assert.equal(first.how, "new");
  assert.equal(first.task.source, "chat");
  assert.equal(first.task.machine.kind, "research");
  const id = first.task.id;

  const more = await call<{ how: string; task: TaskView }>("task.fromChat", { chat, title: "Also cost", body: "Include monthly cost at 10k events/s." }, socket);
  assert.equal(more.how, "brief");
  assert.match(more.task.body, /More context, from your Claude Code chat[\s\S]*monthly cost/);

  const heard: { text: string }[] = [];
  running.engine.on("context", (c) => heard.push(c));
  const step = (event: object, actor = "coordinator") => running.engine.move(id, event as never, actor as never);
  step({ type: "start" }, "engine");
  await call("task.context", { id, text: "Latency matters more than cost." }, socket);
  assert.equal(heard.length, 1, "a running task's coordinator hears it at its next step");

  step({ type: "research_done", chart: true, proved: true }, "engine");
  step({ type: "check" }, "engine");
  step({ type: "requirements_done", covered: true });
  assert.equal(running.engine.decide(id, "approve").task?.machine.state, "Done");

  const after = await call<{ how: string; followUp: TaskView }>("task.fromChat", { chat, title: "Now build it", body: "Go with SQS." }, socket);
  assert.equal(after.how, "followup");
  assert.equal(after.followUp.parent, id);
  assert.equal(after.followUp.chat, chat);
  const next = await call<{ how: string; task: TaskView }>("task.fromChat", { chat, title: "One more thing", body: "Use FIFO queues." }, socket);
  assert.equal(next.task.id, after.followUp.id, "the chat now continues the follow-up");
  const fresh = await call<{ how: string; task: TaskView }>("task.fromChat", { chat, title: "Unrelated", body: "Rename the logger.", fresh: true }, socket);
  assert.equal(fresh.how, "new");
});
