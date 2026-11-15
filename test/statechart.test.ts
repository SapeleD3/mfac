import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP, type Event, type Machine, STATES, TERMINAL, initial, invariants, step } from "../src/workflow/statechart.js";

const EVENTS: Event[] = [
  { type: "pick" }, { type: "triage", as: "ignore" }, { type: "triage", as: "reply" }, { type: "triage", as: "task" }, { type: "triage", as: "backlog" }, { type: "demote" }, { type: "prioritize" },
  { type: "send_reply" }, { type: "dismiss" }, { type: "promote" }, { type: "start" },
  { type: "research_done", chart: true, proved: true }, { type: "research_done", chart: true, proved: false },
  { type: "research_done", chart: false, proved: false }, { type: "check" }, { type: "plan_done" },
  { type: "requirements_done", covered: true }, { type: "requirements_done", covered: false },
  { type: "approve" }, { type: "drop" }, { type: "build_done" },
  { type: "reviews_done", findings: true }, { type: "reviews_done", findings: false },
  { type: "confirm_done", confirmed: true }, { type: "confirm_done", confirmed: false },
  { type: "interrupt" }, { type: "park" }, { type: "unpark" },
  ...STATES.map((to) => ({ type: "send_back" as const, to })),
];

const key = (m: Machine) => JSON.stringify({ ...m, approved: [...m.approved].sort() });

const WALK_CAP = 1;

function explore() {
  const start = initial();
  const seen = new Map<string, Machine>([[key(start), start]]);
  const edges = new Map<string, { to: string; action: string }[]>();
  const queue = [start];
  while (queue.length) {
    const m = queue.shift()!;
    const out: { to: string; action: string }[] = [];
    for (const e of EVENTS) {
      const r = step(m, e, WALK_CAP);
      if (!r.ok) continue;
      const k = key(r.machine);
      out.push({ to: k, action: r.action });
      if (!seen.has(k)) {
        seen.set(k, r.machine);
        queue.push(r.machine);
      }
    }
    edges.set(key(m), out);
  }
  return { seen, edges };
}

const { seen, edges } = explore();

test("the code's state space is finite and every reachable state keeps the spec's invariants", () => {
  assert.ok(seen.size > 500, `explored ${seen.size} states`);
  for (const m of seen.values()) {
    for (const [name, holds] of Object.entries(invariants)) assert.ok(holds(m, WALK_CAP), `${name} broken in ${key(m)}`);
  }
});

test("every task ends or waits in Parked: without parking moves the graph has no cycles and no dead ends", () => {
  const color = new Map<string, number>();
  const visit = (k: string): void => {
    color.set(k, 1);
    const m = seen.get(k)!;
    const out = edges.get(k)!.filter((e) => !["Park", "Unpark", "Demote", "Prioritize"].includes(e.action));
    if (!TERMINAL.includes(m.state) && m.state !== "Parked") assert.ok(out.length > 0, `dead end in ${k}`);
    for (const e of out) {
      const c = color.get(e.to);
      assert.notEqual(c, 1, `cycle through ${e.action} at ${k}`);
      if (c === undefined) visit(e.to);
    }
    color.set(k, 2);
  };
  visit(key(initial()));
});

test("gates refuse a fourth send-back and keep approve and drop", () => {
  let m: Machine = { ...initial("ResearchGate"), chart: true, proved: true };
  for (let i = 0; i < CAP; i++) {
    const back = step(m, { type: "send_back", to: "Researching" });
    assert.ok(back.ok);
    m = { ...back.machine, state: "ResearchGate", chart: true, proved: true };
  }
  const fourth = step(m, { type: "send_back", to: "Researching" });
  assert.equal(fourth.ok, false);
  assert.match((fourth as { reason: string }).reason, /all 3 send-backs/);
  assert.ok(step(m, { type: "approve" }).ok);
  assert.ok(step(m, { type: "drop" }).ok);
});

test("research without a passing TLC check never reaches the gate", () => {
  let m = initial("Researching");
  for (let i = 0; i <= CAP; i++) {
    const done = step(m, { type: "research_done", chart: true, proved: false });
    assert.ok(done.ok);
    const checked = step(done.machine, { type: "check" });
    assert.ok(checked.ok);
    m = checked.machine;
  }
  assert.equal(m.state, "NeedsYou");
  assert.equal(m.loops.check, CAP);
});

test("compiled review findings go back to the builder three times, then to Needs you", () => {
  let m: Machine = { ...initial("Building"), chart: true, proved: true, approved: ["research", "plan"] };
  const states: string[] = [];
  for (let i = 0; i <= CAP; i++) {
    const built = step(m, { type: "build_done" });
    assert.ok(built.ok);
    const reviewed = step(built.machine, { type: "reviews_done", findings: true });
    assert.ok(reviewed.ok);
    m = reviewed.machine;
    states.push(m.state);
  }
  assert.deepEqual(states, ["Building", "Building", "Building", "NeedsYou"]);
});

test("parking returns a card to exactly where it was", () => {
  const parked = step({ ...initial("PlanGate"), chart: true, proved: true, approved: ["research"] }, { type: "park" });
  assert.ok(parked.ok);
  assert.equal(parked.machine.state, "Parked");
  const back = step(parked.machine, { type: "unpark" });
  assert.ok(back.ok);
  assert.equal(back.machine.state, "PlanGate");
});

test("refusals explain themselves", () => {
  const r = step(initial("Building"), { type: "approve" });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /can't approve while the task is Building/);
  const skip = step({ ...initial("NeedsYou"), approved: ["research"] }, { type: "send_back", to: "Building" });
  assert.equal(skip.ok, false);
  assert.match((skip as { reason: string }).reason, /needs research and plan approved/);
});
