/*
 * One task's life, as code. This file is the engine's copy of spec/Factory.tla: every transition
 * here is an action there, with the same guards and the same counters. The engine refuses any
 * move this file doesn't allow, whoever asks for it (the Opus coordinator, a drag on the board,
 * the CLI), so the rules can't be talked around. test/statechart.test.ts walks every reachable
 * state of this code and checks the same invariants TLC checks on the spec.
 *
 * Design principle: explicit state machine, single source of truth for the rules.
 */

/** Max send-backs per gate, and max rounds per automatic loop. */
export const CAP = 3;

export const STATES = [
  "Inbox", "Triage", "Ignored", "ReplyDrafted", "Replied", "Queued",
  "Researching", "ResearchCheck", "ResearchGate",
  "Planning", "PlanGate",
  "Building", "Reviewing", "Confirming", "PRGate",
  "NeedsYou", "Parked", "Done", "Dropped",
] as const;
export type State = (typeof STATES)[number];

export const GATES = ["ResearchGate", "PlanGate", "PRGate", "NeedsYou"] as const;
export type Gate = (typeof GATES)[number];
export const PARKABLE: readonly State[] = ["Queued", "ResearchGate", "PlanGate", "PRGate", "NeedsYou"];
export const TERMINAL: readonly State[] = ["Ignored", "Replied", "Done", "Dropped"];
/** States where a Claude session is doing the work. */
export const RUNNING: readonly State[] = ["Researching", "Planning", "Building", "Reviewing", "Confirming"];
export const LOOPS = ["check", "review", "confirm"] as const;
export type Loop = (typeof LOOPS)[number];
export type Approval = "research" | "plan" | "pr";

/** The parts of a task the rules look at. Mirrors the spec's VARIABLES. */
export interface Machine {
  state: State;
  /** Where a parked card returns to. */
  parkedFrom: State;
  /** Send-backs used, per gate (never reset). */
  tries: Record<Gate, number>;
  /** Automatic loops used (never reset). */
  loops: Record<Loop, number>;
  /** Research produced a statechart. */
  chart: boolean;
  /** Its TLA+ model passed TLC. */
  proved: boolean;
  /** Compiled code + security review found blocking issues. */
  findings: boolean;
  /** The change was run and shown to solve the problem. */
  confirmed: boolean;
  approved: Approval[];
}

export type Event =
  | { type: "pick" }
  | { type: "triage"; as: "ignore" | "reply" | "task" }
  | { type: "send_reply" }
  | { type: "dismiss" }
  | { type: "promote" }
  | { type: "start" }
  | { type: "research_done"; chart: boolean; proved: boolean }
  | { type: "check" }
  | { type: "plan_done" }
  | { type: "approve" }
  | { type: "send_back"; to: State }
  | { type: "drop" }
  | { type: "build_done" }
  | { type: "reviews_done"; findings: boolean }
  | { type: "confirm_done"; confirmed: boolean }
  | { type: "interrupt" }
  | { type: "park" }
  | { type: "unpark" };

export type EventType = Event["type"];

export type Step = { ok: true; machine: Machine; action: string } | { ok: false; reason: string };

export function initial(state: State = "Inbox"): Machine {
  return {
    state,
    parkedFrom: "Queued",
    tries: { ResearchGate: 0, PlanGate: 0, PRGate: 0, NeedsYou: 0 },
    loops: { check: 0, review: 0, confirm: 0 },
    chart: false,
    proved: false,
    findings: false,
    confirmed: false,
    approved: [],
  };
}

/** Where a send-back from each gate may go, and which approvals it clears. */
export const SEND_BACK: Record<Gate, { to: State; clears: Approval[]; needs?: Approval[] }[]> = {
  ResearchGate: [{ to: "Researching", clears: [] }],
  PlanGate: [
    { to: "Planning", clears: [] },
    { to: "Researching", clears: ["research"] },
  ],
  PRGate: [
    { to: "Building", clears: [] },
    { to: "Planning", clears: ["plan"] },
  ],
  NeedsYou: [
    { to: "Researching", clears: ["research", "plan"] },
    { to: "Building", clears: [], needs: ["research", "plan"] },
  ],
};

const APPROVE: Partial<Record<Gate, { to: State; adds: Approval }>> = {
  ResearchGate: { to: "Planning", adds: "research" },
  PlanGate: { to: "Building", adds: "plan" },
  PRGate: { to: "Done", adds: "pr" },
};

const isGate = (s: State): s is Gate => (GATES as readonly string[]).includes(s);
const clone = (m: Machine): Machine => ({ ...m, tries: { ...m.tries }, loops: { ...m.loops }, approved: [...m.approved] });
const go = (m: Machine, to: State): Machine => ({ ...clone(m), state: to });
const ok = (machine: Machine, action: string): Step => ({ ok: true, machine, action });
const no = (reason: string): Step => ({ ok: false, reason });
const wrong = (m: Machine, e: string, where: string) => no(`can't ${e} while the task is ${m.state}; only ${where}`);

/**
 * Apply one event. Pure: returns the next machine or the reason the move isn't allowed.
 * `cap` is only lowered by tests, to walk the whole state space quickly; TLC checks CAP = 3.
 */
export function step(m: Machine, e: Event, cap = CAP): Step {
  const s = m.state;
  switch (e.type) {
    // ---------- intake and triage ----------
    case "pick":
      return s === "Inbox" ? ok(go(m, "Triage"), "Pick") : wrong(m, "pick", "from Inbox");
    case "triage":
      if (s !== "Triage") return wrong(m, "triage", "from Triage");
      return ok(go(m, e.as === "ignore" ? "Ignored" : e.as === "reply" ? "ReplyDrafted" : "Queued"), e.as === "ignore" ? "TIgnore" : e.as === "reply" ? "TReply" : "TTask");
    case "send_reply":
      return s === "ReplyDrafted" ? ok(go(m, "Replied"), "SendReply") : wrong(m, "send a reply", "from ReplyDrafted");
    case "dismiss":
      return s === "ReplyDrafted" ? ok(go(m, "Ignored"), "Dismiss") : wrong(m, "dismiss", "a drafted reply");
    case "promote":
      return s === "Ignored" || s === "ReplyDrafted" ? ok(go(m, "Queued"), "Promote") : wrong(m, "promote", "an ignored item or a drafted reply");
    case "start":
      return s === "Queued" ? ok(go(m, "Researching"), "Start") : wrong(m, "start", "from Queued");

    // ---------- research: must ship a statechart and a TLC-checked model ----------
    case "research_done": {
      if (s !== "Researching") return wrong(m, "finish research", "while Researching");
      // The engine fills chart and proved from the files the stage wrote (see research-check.ts),
      // never from what a session says. No chart counts as a failed check.
      const n = go(m, "ResearchCheck");
      n.chart = e.chart;
      n.proved = e.chart && e.proved;
      return ok(n, "Research");
    }
    case "check": {
      if (s !== "ResearchCheck") return wrong(m, "check research", "in ResearchCheck");
      if (m.chart && m.proved) return ok(go(m, "ResearchGate"), "CheckPass");
      if (m.loops.check < cap) {
        const n = go(m, "Researching");
        n.loops.check++;
        return ok(n, "CheckRetry");
      }
      return ok(go(m, "NeedsYou"), "CheckOut");
    }

    // ---------- planning ----------
    case "plan_done":
      return s === "Planning" ? ok(go(m, "PlanGate"), "Plan") : wrong(m, "finish the plan", "while Planning");

    // ---------- human gates: approve, send back (max cap per gate), drop ----------
    case "approve": {
      const a = isGate(s) ? APPROVE[s] : undefined;
      if (!a) return wrong(m, "approve", "at the research, plan or PR gate");
      const n = go(m, a.to);
      if (!n.approved.includes(a.adds)) n.approved.push(a.adds);
      return ok(n, `Approve(${s})`);
    }
    case "send_back": {
      if (!isGate(s)) return wrong(m, "send back", "at a gate or Needs you");
      const route = SEND_BACK[s].find((r) => r.to === e.to);
      if (!route) return no(`${s} can send back to ${SEND_BACK[s].map((r) => r.to).join(" or ")}, not ${e.to}`);
      if (m.tries[s] >= cap) return no(`${s} has used all ${cap} send-backs; only approve or drop remain`);
      if (route.needs && !route.needs.every((a) => m.approved.includes(a))) return no(`sending back to ${e.to} needs ${route.needs.join(" and ")} approved first`);
      const n = go(m, e.to);
      n.tries[s]++;
      n.approved = n.approved.filter((a) => !route.clears.includes(a));
      if (e.to === "Researching") {
        n.chart = false;
        n.proved = false;
      }
      return ok(n, `SendBack(${s},${e.to})`);
    }
    case "drop":
      return isGate(s) || s === "Parked" ? ok(go(m, "Dropped"), s === "Parked" ? "PDrop" : `Drop(${s})`) : wrong(m, "drop", "at a gate, Needs you or Parked");

    // ---------- build loop: no human gate until the PR is ready ----------
    case "build_done": {
      if (s !== "Building") return wrong(m, "finish a build", "while Building");
      const n = go(m, "Reviewing");
      n.findings = false;
      n.confirmed = false;
      return ok(n, "Build");
    }
    case "reviews_done": {
      if (s !== "Reviewing") return wrong(m, "compile reviews", "while Reviewing");
      if (!e.findings) {
        const n = go(m, "Confirming");
        n.findings = false;
        return ok(n, "Clean");
      }
      const n = go(m, m.loops.review < cap ? "Building" : "NeedsYou");
      n.findings = true;
      if (m.loops.review < cap) n.loops.review++;
      return ok(n, m.loops.review < cap ? "Rework" : "ReviewOut");
    }
    case "confirm_done": {
      if (s !== "Confirming") return wrong(m, "confirm", "while Confirming");
      const n = clone(m);
      n.confirmed = e.confirmed;
      if (e.confirmed) n.state = "PRGate";
      else if (m.loops.confirm < cap) {
        n.state = "Building";
        n.loops.confirm++;
      } else n.state = "NeedsYou";
      return ok(n, "Confirm");
    }

    // ---------- stop a running stage ----------
    case "interrupt":
      return RUNNING.includes(s) ? ok(go(m, "NeedsYou"), "Interrupt") : wrong(m, "stop", "a running stage");

    // ---------- kanban: park and unpark ----------
    case "park": {
      if (!PARKABLE.includes(s)) return wrong(m, "park", "from Queued, a review column or Needs you");
      const n = go(m, "Parked");
      n.parkedFrom = s;
      return ok(n, "Park");
    }
    case "unpark":
      return s === "Parked" ? ok(go(m, m.parkedFrom), "Unpark") : wrong(m, "unpark", "a parked card");
  }
}

/** Every event type that could apply in this state (ignoring payload), for the UI's buttons. */
export function allowed(m: Machine): Event[] {
  const candidates: Event[] = [
    { type: "pick" }, { type: "triage", as: "ignore" }, { type: "triage", as: "reply" }, { type: "triage", as: "task" },
    { type: "send_reply" }, { type: "dismiss" }, { type: "promote" }, { type: "start" },
    { type: "research_done", chart: true, proved: true }, { type: "check" }, { type: "plan_done" },
    { type: "approve" }, { type: "drop" }, { type: "build_done" }, { type: "reviews_done", findings: false },
    { type: "confirm_done", confirmed: true }, { type: "interrupt" }, { type: "park" }, { type: "unpark" },
    ...STATES.map((to) => ({ type: "send_back" as const, to })),
  ];
  return candidates.filter((e) => step(m, e).ok);
}

// ---------- the invariants from the spec, checked by tests on every reachable state ----------

export const invariants: Record<string, (m: Machine, cap?: number) => boolean> = {
  TypeOK: (m, cap = CAP) =>
    STATES.includes(m.state) && PARKABLE.includes(m.parkedFrom) &&
    GATES.every((g) => m.tries[g] >= 0 && m.tries[g] <= cap) && LOOPS.every((l) => m.loops[l] >= 0 && m.loops[l] <= cap),
  /** Nothing passes the research gate without a statechart and a passing check. */
  ResearchRule: (m) => !["ResearchGate", "Planning", "PlanGate", "Building", "Reviewing", "Confirming", "PRGate", "Done"].includes(m.state) || (m.chart && m.proved),
  /** Building only starts on approved research and an approved plan. */
  BuildRule: (m) => !["Building", "Reviewing", "Confirming", "PRGate"].includes(m.state) || (m.approved.includes("research") && m.approved.includes("plan")),
  /** A human sees the code only once review is clean and the fix is confirmed. */
  PRRule: (m) => m.state !== "PRGate" || (!m.findings && m.confirmed),
  /** Done only after research, plan and PR are all approved. */
  GatesRule: (m) => m.state !== "Done" || ["research", "plan", "pr"].every((a) => m.approved.includes(a as Approval)),
};

/** The board's columns, left to right, as in the approved mockups. Intake states live in the Inbox, not on the board. */
export const COLUMNS = ["Queued", "Running", "Needs you", "Parked", "PR ready", "Done"] as const;
export type Column = (typeof COLUMNS)[number] | "Inbox";

/** Which column a state belongs to on the kanban board. Every gate but PR ready is "Needs you". */
export function column(state: State): Column {
  switch (state) {
    case "Inbox":
    case "Triage":
    case "ReplyDrafted":
      return "Inbox";
    case "Queued":
      return "Queued";
    case "Researching":
    case "ResearchCheck":
    case "Planning":
    case "Building":
    case "Reviewing":
    case "Confirming":
      return "Running";
    case "ResearchGate":
    case "PlanGate":
    case "NeedsYou":
      return "Needs you";
    case "PRGate":
      return "PR ready";
    case "Parked":
      return "Parked";
    default:
      return "Done";
  }
}

export const isTerminal = (s: State) => TERMINAL.includes(s);
export const isRunning = (s: State) => RUNNING.includes(s);
export const isGateState = isGate;
