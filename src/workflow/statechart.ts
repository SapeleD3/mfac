export const CAP = 3;

export const STATES = [
  "Inbox", "Triage", "Ignored", "ReplyDrafted", "Replied", "Queued",
  "Researching", "ResearchCheck", "ResearchGate",
  "Planning", "RequirementsReview", "PlanGate",
  "Building", "Reviewing", "Confirming", "PRGate",
  "NeedsYou", "Parked", "Done", "Dropped",
] as const;
export type State = (typeof STATES)[number];

export const GATES = ["ResearchGate", "PlanGate", "PRGate", "NeedsYou"] as const;
export type Gate = (typeof GATES)[number];
export const PARKABLE: readonly State[] = ["Queued", "ResearchGate", "PlanGate", "PRGate", "NeedsYou"];
export const TERMINAL: readonly State[] = ["Ignored", "Replied", "Done", "Dropped"];
export const RUNNING: readonly State[] = ["Researching", "Planning", "RequirementsReview", "Building", "Reviewing", "Confirming"];
export const LOOPS = ["check", "requirements", "review", "confirm"] as const;
export type Loop = (typeof LOOPS)[number];
export type Approval = "research" | "plan" | "pr";

export interface Machine {
  state: State;
  parkedFrom: State;
  tries: Record<Gate, number>;
  loops: Record<Loop, number>;
  chart: boolean;
  proved: boolean;
  covered: boolean;
  findings: boolean;
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
  | { type: "requirements_done"; covered: boolean }
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
    loops: { check: 0, requirements: 0, review: 0, confirm: 0 },
    chart: false,
    proved: false,
    covered: false,
    findings: false,
    confirmed: false,
    approved: [],
  };
}

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

export function step(m: Machine, e: Event, cap = CAP): Step {
  const s = m.state;
  switch (e.type) {
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

    case "research_done": {
      if (s !== "Researching") return wrong(m, "finish research", "while Researching");
      // The engine fills chart and proved from the files the stage wrote, never from what a
      // session says. No chart counts as a failed check.
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

    case "plan_done":
      return s === "Planning" ? ok(go(m, "RequirementsReview"), "Plan") : wrong(m, "finish the plan", "while Planning");
    case "requirements_done": {
      if (s !== "RequirementsReview") return wrong(m, "finish the requirements review", "in RequirementsReview");
      const n = clone(m);
      n.covered = e.covered;
      if (e.covered) n.state = "PlanGate";
      else if (m.loops.requirements < cap) {
        n.state = "Planning";
        n.loops.requirements++;
      } else n.state = "NeedsYou";
      return ok(n, "ReqReview");
    }

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
      if (e.to === "Researching" || e.to === "Planning") n.covered = false;
      return ok(n, `SendBack(${s},${e.to})`);
    }
    case "drop":
      return isGate(s) || s === "Parked" ? ok(go(m, "Dropped"), s === "Parked" ? "PDrop" : `Drop(${s})`) : wrong(m, "drop", "at a gate, Needs you or Parked");

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

    case "interrupt":
      return RUNNING.includes(s) ? ok(go(m, "NeedsYou"), "Interrupt") : wrong(m, "stop", "a running stage");

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

export function allowed(m: Machine): Event[] {
  const candidates: Event[] = [
    { type: "pick" }, { type: "triage", as: "ignore" }, { type: "triage", as: "reply" }, { type: "triage", as: "task" },
    { type: "send_reply" }, { type: "dismiss" }, { type: "promote" }, { type: "start" },
    { type: "research_done", chart: true, proved: true }, { type: "check" }, { type: "plan_done" },
    { type: "requirements_done", covered: true }, { type: "approve" }, { type: "drop" }, { type: "build_done" }, { type: "reviews_done", findings: false },
    { type: "confirm_done", confirmed: true }, { type: "interrupt" }, { type: "park" }, { type: "unpark" },
    ...STATES.map((to) => ({ type: "send_back" as const, to })),
  ];
  return candidates.filter((e) => step(m, e).ok);
}

export const invariants: Record<string, (m: Machine, cap?: number) => boolean> = {
  TypeOK: (m, cap = CAP) =>
    STATES.includes(m.state) && PARKABLE.includes(m.parkedFrom) &&
    GATES.every((g) => m.tries[g] >= 0 && m.tries[g] <= cap) && LOOPS.every((l) => m.loops[l] >= 0 && m.loops[l] <= cap),
  ResearchRule: (m) => !["ResearchGate", "Planning", "RequirementsReview", "PlanGate", "Building", "Reviewing", "Confirming", "PRGate", "Done"].includes(m.state) || (m.chart && m.proved),
  CoverageRule: (m) => !["PlanGate", "Building", "Reviewing", "Confirming", "PRGate", "Done"].includes(m.state) || m.covered,
  BuildRule: (m) => !["Building", "Reviewing", "Confirming", "PRGate"].includes(m.state) || (m.approved.includes("research") && m.approved.includes("plan")),
  PRRule: (m) => m.state !== "PRGate" || (!m.findings && m.confirmed),
  GatesRule: (m) => m.state !== "Done" || ["research", "plan", "pr"].every((a) => m.approved.includes(a as Approval)),
};

export const COLUMNS = ["Queued", "Running", "Needs you", "Parked", "PR ready", "Done"] as const;
export type Column = (typeof COLUMNS)[number] | "Inbox";

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
    case "RequirementsReview":
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
