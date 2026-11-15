import type { ComponentChildren, JSX } from "preact";
import { BRANDS } from "./brands";
import { ICONS } from "./icons";
import { CAP, type Gate, type Machine, type State, type Tag, type Task } from "./types";

export const Ic = ({ n, s = 16, cls = "" }: { n: string; s?: number; cls?: string }) => (
  <svg
    class={`ic ${cls}`}
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: ICONS[n] ?? "" }}
  />
);

export const Brand = ({ n, s = 20 }: { n: string; s?: number }) => {
  if (!BRANDS[n])
    return (
      <span class="brand-tile you" style={{ width: s, height: s }}>
        <Ic n={n === "github" ? "git-pull-request" : n === "factory" ? "factory" : "user"} s={Math.round(s * 0.65)} />
      </span>
    );
  const inner = Math.round(s * 0.66);
  return (
    <span class={`brand-tile b-${n}`} style={{ width: s, height: s }}>
      <svg width={inner} height={inner} viewBox="0 0 24 24" aria-label={n} dangerouslySetInnerHTML={{ __html: BRANDS[n]! }} />
    </span>
  );
};

export const TagChip = ({ t, onRemove }: { t: Tag | string; onRemove?: () => void }) => (
  <span class={`tag ${t}`} title={onRemove ? "Click to remove" : undefined} onClick={onRemove} style={onRemove ? { cursor: "pointer" } : undefined}>
    {t}
  </span>
);
export const Tags = ({ ts }: { ts: string[] }) => (
  <>
    {ts.map((t) => (
      <TagChip key={t} t={t} />
    ))}
  </>
);

const SRC: Record<string, string> = { slack: "Slack", jira: "Jira", notion: "Notion", manual: "You", factory: "Factory", claude: "Claude Code", chat: "Your Claude chat" };
export const Src = ({ s, label }: { s: string; label?: string }) => (
  <span class="src">
    <Brand n={s === "manual" ? "you" : s === "chat" ? "claude" : s} s={16} />
    {label ?? SRC[s] ?? s}
  </span>
);
export const taskSource = (t: Task) => <Src s={t.source} label={t.sourceRef ? `${SRC[t.source] ?? t.source} ${t.sourceRef.split("@")[0]}` : SRC[t.source]} />;

export const Pips = ({ used, of = CAP, cls = "" }: { used: number; of?: number; cls?: string }) => (
  <span class={`pips ${cls}`} title={`${used} of ${of} used`}>
    {Array.from({ length: of }, (_, i) => (
      <i key={i} class={i < used ? "on" : ""} />
    ))}
  </span>
);

const CHAR = ["#f2b366", "#8fb5ff", "#c79bf2", "#7fd1b9", "#ff8a7a", "#e3e5ea", "#b7d36b"];
export const Avatar = ({ t }: { t: Task }) => {
  const n = [...t.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span class="avatar" style={{ background: CHAR[n % CHAR.length] }}>
      {t.title[0]?.toUpperCase()}
    </span>
  );
};

export const Btn = ({
  children,
  kind = "",
  onClick,
  title,
  disabled,
  sm = true,
}: {
  children: ComponentChildren;
  kind?: string;
  onClick?: (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  title?: string;
  disabled?: boolean;
  sm?: boolean;
}) => (
  <button type="button" class={`btn ${sm ? "btn-sm" : ""} ${kind}`} onClick={onClick} title={title} disabled={disabled}>
    {children}
  </button>
);
export const IconBtn = ({ n, title, onClick, s = 15 }: { n: string; title: string; onClick?: () => void; s?: number }) => (
  <button type="button" class="icon-btn" title={title} onClick={(e) => (e.stopPropagation(), onClick?.())}>
    <Ic n={n} s={s} />
  </button>
);

export const RECIPE = [
  { id: "triage", name: "Triage" },
  { id: "research", name: "Research" },
  { id: "check", name: "Statechart + TLC check", auto: true },
  { id: "rgate", name: "Research gate", gate: true },
  { id: "plan", name: "Plan" },
  { id: "requirements", name: "Requirements review", auto: true },
  { id: "pgate", name: "Plan gate", gate: true },
  { id: "build", name: "Build" },
  { id: "review", name: "Code + security review", auto: true },
  { id: "confirm", name: "Confirm it solves the problem", auto: true },
  { id: "dgate", name: "PR ready", gate: true },
  { id: "done", name: "Write back" },
] as const;

const AT: Partial<Record<State, number>> = {
  Inbox: 0,
  Triage: 0,
  ReplyDrafted: 0,
  Queued: 1,
  Backlog: 1,
  Researching: 1,
  ResearchCheck: 2,
  ResearchGate: 3,
  Planning: 4,
  RequirementsReview: 5,
  PlanGate: 6,
  Building: 7,
  Reviewing: 8,
  Confirming: 9,
  PRGate: 10,
  Done: 12,
  Dropped: 0,
  Ignored: 0,
  Replied: 0,
};

export function position(m: Machine): { at: number; kind: "now" | "gate" | "fail" | "queued" | "done" | "parked" } {
  const s = m.state === "Parked" ? m.parkedFrom : m.state;
  let at = AT[s];
  if (s === "NeedsYou") at = !m.approved.includes("research") ? (m.chart && m.proved ? 3 : 2) : !m.approved.includes("plan") ? (m.covered ? 6 : 5) : m.findings ? 8 : 9;
  const kind =
    m.state === "Parked"
      ? "parked"
      : s === "NeedsYou"
        ? "fail"
        : s === "Queued" || s === "Backlog"
          ? "queued"
          : s === "Done"
            ? "done"
            : ["ResearchGate", "PlanGate", "PRGate"].includes(s)
              ? "gate"
              : "now";
  return { at: at ?? 0, kind };
}

export const MiniRail = ({ t }: { t: Task }) => {
  const { at, kind } = position(t.machine);
  return (
    <span class="mini-rail">
      {RECIPE.map((r, i) => (
        <i key={r.id} title={r.name} class={i < at ? "done" : i === at ? (kind === "gate" ? "gate" : kind === "fail" ? "fail" : kind === "now" ? "now" : "") : ""} />
      ))}
    </span>
  );
};

export function doing(t: Task): string {
  const m = t.machine;
  switch (m.state) {
    case "Queued":
      return "Waiting for a free slot";
    case "Researching":
      return m.loops.check ? `Research, round ${m.loops.check + 1} (TLC check failed before)` : "Researching: reading code, writing the statechart and model";
    case "ResearchCheck":
      return "Checking the statechart and running TLC";
    case "ResearchGate":
      return "Research ready: review in Notion";
    case "Planning":
      return m.loops.requirements ? `Planning: closing requirement gaps (round ${m.loops.requirements} of ${CAP})` : "Planning: splitting into reviewable units";
    case "RequirementsReview":
      return `Checking the plan against the original ask${m.loops.requirements ? ` (round ${m.loops.requirements + 1} of ${CAP})` : ""}`;
    case "PlanGate":
      return "Plan ready: review in Notion";
    case "Building":
      return m.loops.review ? `Building: fixing review findings (loop ${m.loops.review} of ${CAP})` : "Building on its branch";
    case "Reviewing":
      return `Code + security review${m.loops.review ? ` (loop ${m.loops.review + 1} of ${CAP})` : ""}`;
    case "Confirming":
      return "Confirming it solves the problem";
    case "PRGate":
      return "PR ready: confirmed fixed, evidence attached";
    case "NeedsYou":
      return "Needs you: a loop ran out or the engine refused a step";
    case "Parked":
      return "In the bin · parked by you, keeps its place";
    case "Backlog":
      return "In the backlog · waits until you move it to the queue";
    case "Done":
      return t.prUrl ? "PR approved · written back" : "Done";
    case "Dropped":
      return "Dropped";
    default:
      return m.state;
  }
}

export const isGate = (s: State): s is Gate => ["ResearchGate", "PlanGate", "PRGate", "NeedsYou"].includes(s);

export const StateDot = ({ t, asking }: { t: Task; asking?: boolean }) => {
  const s = t.machine.state;
  const cls = asking || s === "ResearchGate" || s === "PlanGate" || s === "PRGate" ? "needs" : s === "NeedsYou" ? "err" : t.column === "Running" ? "working" : s === "Done" ? "ok" : "off";
  return <span class={`dot ${cls}`} />;
};

export const StateChip = ({ t, asking }: { t: Task; asking?: "permission" | "question" }) => {
  const s = t.machine.state;
  if (asking) return <span class="chip warn">{asking === "permission" ? "Asking permission" : "Asking a question"}</span>;
  if (s === "PRGate") return <span class="chip warn">PR ready</span>;
  if (s === "ResearchGate") return <span class="chip warn">At research gate</span>;
  if (s === "PlanGate") return <span class="chip warn">At plan gate</span>;
  if (s === "NeedsYou") return <span class="chip err">Needs you</span>;
  if (s === "Queued") return <span class="chip">Queued</span>;
  if (s === "Parked") return <span class="chip">In the bin</span>;
  if (s === "Backlog") return <span class="chip">Backlog</span>;
  if (s === "Done") return <span class="chip ok">Done</span>;
  if (s === "Dropped") return <span class="chip">Dropped</span>;
  const { at } = position(t.machine);
  return <span class="chip work">{RECIPE[at]?.name ?? s}</span>;
};

export const LOGO = (
  <svg width="18" height="18" viewBox="0 0 20 20">
    <rect width="20" height="20" rx="5" fill="var(--bg-raised)" />
    <path d="M4 15V9l4-2.5V9l4-2.5V9l4-2.5V15z" fill="var(--text)" />
    <circle cx="15" cy="4.5" r="1.6" fill="var(--accent)" />
  </svg>
);

export function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 0) return `in ${until(iso)}`;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function until(iso?: string): string {
  if (!iso) return "";
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  if (s <= 0) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
export const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
export const every = (s: number) =>
  s % 86400 === 0
    ? `every ${s / 86400 === 1 ? "day" : `${s / 86400} days`}`
    : s % 3600 === 0
      ? `every ${s / 3600 === 1 ? "hour" : `${s / 3600} h`}`
      : s % 60 === 0
        ? `every ${s / 60} min`
        : `every ${s}s`;
export const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
