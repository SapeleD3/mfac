import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP, type Event, type Machine, STATES, TERMINAL, initial, invariants, step } from "../src/workflow/statechart.js";

const EVENTS: Event[] = [
  { type: "pick" },
  { type: "triage", as: "ignore" },
  { type: "triage", as: "reply" },
  { type: "triage", as: "task" },
  { type: "triage", as: "backlog" },
  { type: "demote" },
  { type: "prioritize" },
  { type: "send_reply" },
  { type: "dismiss" },
  { type: "promote" },
  { type: "start" },
  { type: "research_done", chart: true, proved: true },
  { type: "research_done", chart: true, proved: false },
  { type: "research_done", chart: false, proved: false },
  { type: "check" },
  { type: "plan_done" },
  { type: "requirements_done", covered: true },
  { type: "requirements_done", covered: false },
  { type: "approve" },
  { type: "drop" },
  { type: "build_done" },
  { type: "reviews_done", findings: true },
  { type: "reviews_done", findings: false },
  { type: "confirm_done", confirmed: true },
  { type: "confirm_done", confirmed: false },
  { type: "interrupt" },
  { type: "park" },
  { type: "unpark" },
  ...STATES.map((to) => ({ type: "send_back" as const, to })),
];

const key = (m: Machine) => JSON.stringify({ ...m, approved: [...m.approved].sort() });

const WALK_CAP = 1;

function explore() {
  const starts = [initial(), initial("Inbox", "research")];
  const seen = new Map<string, Machine>(starts.map((m) => [key(m), m]));
  const edges = new Map<string, { to: string; action: string }[]>();
  const queue = [...starts];
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

test("every task ends or waits in Parked: without parking moves or sending research back, the graph has no cycles and no dead ends", () => {
  const color = new Map<string, number>();
  const visit = (k: string): void => {
    color.set(k, 1);
    const m = seen.get(k)!;
    const out = edges.get(k)!.filter((e) => !["Park", "Unpark", "Demote", "Prioritize"].includes(e.action) && !/^SendBack\(\w+,Researching\)$/.test(e.action));
    if (!TERMINAL.includes(m.state) && m.state !== "Parked") assert.ok(out.length > 0, `dead end in ${k}`);
    for (const e of out) {
      const c = color.get(e.to);
      assert.notEqual(c, 1, `cycle through ${e.action} at ${k}`);
      if (c === undefined) visit(e.to);
    }
    color.set(k, 2);
  };
  visit(key(initial()));
  visit(key(initial("Inbox", "research")));
});

test("a research task is reviewed after its check, ends at the research gate, and never plans or builds", () => {
  const go = (m: Machine, e: Event) => {
    const r = step(m, e);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    return r.machine;
  };
  let m = initial("Queued", "research");
  m = go(m, { type: "start" });
  m = go(m, { type: "research_done", chart: true, proved: true });
  m = go(m, { type: "check" });
  assert.equal(m.state, "RequirementsReview");
  m = go(m, { type: "requirements_done", covered: false });
  assert.equal(m.state, "Researching", "gaps go back to the researcher, not a planner");
  m = go(go(go(m, { type: "research_done", chart: true, proved: true }), { type: "check" }), { type: "requirements_done", covered: true });
  assert.equal(m.state, "ResearchGate");
  const back = step(m, { type: "send_back", to: "Planning" });
  assert.equal(back.ok, false);
  m = go(m, { type: "approve" });
  assert.equal(m.state, "Done");
  assert.deepEqual(m.approved, ["research"]);
  for (const s of seen.values()) if (s.kind === "research") assert.ok(!["Planning", "PlanGate", "Building", "Reviewing", "Confirming", "PRGate"].includes(s.state), `research reached ${s.state}`);
});

test("sending research back is never capped and starts the caps over; plan and build send-backs stop at three", () => {
  let m: Machine = { ...initial("ResearchGate"), chart: true, proved: true, loops: { check: 2, requirements: 3, review: 0, confirm: 0 } };
  for (let i = 0; i < CAP * 3; i++) {
    const back = step(m, { type: "send_back", to: "Researching" });
    assert.ok(back.ok, `research send-back ${i + 1} is allowed`);
    assert.deepEqual(back.machine.loops, { check: 0, requirements: 0, review: 0, confirm: 0 }, "the automatic loops count afresh for the new research");
    m = { ...back.machine, state: "ResearchGate", chart: true, proved: true, covered: true };
  }
  let p: Machine = { ...initial("PlanGate"), chart: true, proved: true, covered: true, approved: ["research"] };
  for (let i = 0; i < CAP; i++) {
    const back = step(p, { type: "send_back", to: "Planning" });
    assert.ok(back.ok);
    p = { ...back.machine, state: "PlanGate", covered: true };
  }
  const fourth = step(p, { type: "send_back", to: "Planning" });
  assert.equal(fourth.ok, false);
  assert.match((fourth as { reason: string }).reason, /all 3 send-backs to planning; you can still send it back to research/);
  assert.ok(step(p, { type: "approve" }).ok);
  assert.ok(step(p, { type: "drop" }).ok);
  const redo = step(p, { type: "send_back", to: "Researching" });
  assert.ok(redo.ok);
  assert.equal(redo.machine.tries.PlanGate, 0, "new research, new plan: its cap starts over");
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
