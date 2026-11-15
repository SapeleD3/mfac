/*
 * Review gates. Research and plan are reviewed in Notion: the in-depth review and every comment
 * happen on the Notion page, and the factory reads them from there. Here you read a summary, give one
 * overall evaluation of the whole document, and decide. PR ready is the first look at code: evidence,
 * the compiled review, and the diff in VS Code.
 */
import { useState } from "preact/hooks";
import { go } from "../app";
import { openInVSCode, openUrl } from "../bridge";
import { Brand, Btn, Ic, Pips, Tags, taskSource } from "../kit";
import { act, useApp, useCall } from "../store";
import { CAP, type Task } from "../types";
import { FileView } from "./task";

interface Summary {
  url?: string;
  comments: number;
  discussions: number;
  summary: string;
  tlc?: string;
  statechart?: string;
}

const STAGE_NAME: Record<string, string> = { Researching: "Revise research", Planning: "Revise the plan", Building: "Back to build", Queued: "Reject to the start", Triage: "Reject to triage" };

export function Gate({ id }: { id: string }) {
  const app = useApp();
  const t = app.tasks.find((x) => x.id === id);
  if (!t) return <div class="pane-body"><div class="empty">{app.loaded ? `No task ${id}.` : "Loading…"}</div></div>;
  const s = t.machine.state;
  if (s === "PRGate") return <PRReady t={t} />;
  if (s !== "ResearchGate" && s !== "PlanGate") {
    return (
      <div class="pane-body"><main class="main"><div class="empty">{t.id} isn't at a review gate (it's {t.column.toLowerCase()}). <a href={`#task/${t.id}`}>Open the task</a></div></main></div>
    );
  }
  return <DocGate t={t} />;
}

function Decide({ t, note, extra }: { t: Task; note: string; extra?: preact.ComponentChildren }) {
  const s = t.machine.state as "ResearchGate" | "PlanGate" | "PRGate";
  const used = t.machine.tries[s];
  const left = CAP - used;
  const targets = t.allowed.filter((a) => a.startsWith("send_back:")).map((a) => a.slice(10));
  const [choice, setChoice] = useState<"approve" | "back" | "drop">(targets.length ? "back" : "approve");
  const [to, setTo] = useState(targets[0]);
  const next = s === "ResearchGate" ? "Plan" : s === "PlanGate" ? "Build" : "Done";
  const decide = async () => {
    const verdict = choice === "back" ? "send_back" : choice;
    const r = await act<{ ok: boolean }>("task.decide", { id: t.id, verdict, to: choice === "back" ? to : undefined, note }, ["tasks"]);
    if (r?.ok) go(choice === "drop" ? "queue" : `task/${t.id}`);
  };
  const c = (id: typeof choice, title: string, sub: string, disabled = false) => (
    <div class={`choice ${choice === id ? "on" : ""}`} onClick={() => !disabled && setChoice(id)} style={disabled ? { opacity: 0.45, cursor: "default" } : undefined}>
      <span class="rad" /><div><b>{title}</b><span>{sub}</span></div>
    </div>
  );
  return (
    <div class="decide-sec">
      <div class="row" style={{ marginBottom: 8 }}><b>Decide</b><span class="grow" /><span class="xs dim">send-backs <Pips used={used} /> {used} of {CAP} used</span></div>
      {c("approve", s === "PRGate" ? "Approve" : "Approve", s === "PRGate" ? "Done. The PR stays open for your usual merge; the source gets the link." : `Moves to ${next}. Open Notion comments are kept as notes for later stages.`)}
      {c("back", "Send back", left > 0 ? "Goes back with your evaluation and every open comment. The stage updates the same page as a new round." : "No send-backs left at this gate: approve or drop.", !targets.length)}
      {choice === "back" && targets.length > 0 && (
        <div style={{ padding: "4px 0 8px 26px" }} class="col">
          <span class="small dim">Where to?</span>
          <div class="seg">{targets.map((x) => <button key={x} class={to === x ? "on" : ""} onClick={() => setTo(x)}>{STAGE_NAME[x] ?? x}</button>)}</div>
          <span class="xs faint">Rejecting to an earlier stage clears approvals from that point on.</span>
        </div>
      )}
      {c("drop", "Drop", `Ends the task${t.source === "slack" || t.source === "jira" ? ` and leaves a note on ${t.source}` : ""}.`)}
      {extra}
      <div class="row" style={{ marginTop: 8 }}>
        <Btn kind="btn-primary" onClick={decide}>{choice === "approve" ? "Approve" : choice === "drop" ? "Drop task" : `Send back · ${left - 1} left after this`}</Btn>
        <span class="grow" /><span class="kbd">⌘↵</span>
      </div>
    </div>
  );
}

function DocGate({ t }: { t: Task }) {
  const sum = useCall<Summary>("review.summary", { id: t.id }, [t.id]);
  const [verdict, setVerdict] = useState<"solid" | "work" | "off">("work");
  const [text, setText] = useState("");
  const isPlan = t.machine.state === "PlanGate";
  const s = sum.data;
  const round = t.machine.tries[t.machine.state as "ResearchGate"] + 1;
  const note = [`Overall: ${verdict === "solid" ? "solid" : verdict === "work" ? "needs work" : "off track"}.`, text.trim()].filter(Boolean).join(" ");
  return (
    <div class="pane-body">
      <div class="notion-route">
        <Brand n="notion" s={34} />
        <div class="grow">
          <b>Review this in Notion first.</b> The full {isPlan ? "plan" : "research doc, with the statechart, TLA+ model and TLC result,"} is on its Notion page. Leave a comment on each issue there, anchored to the words it's about. Every open comment goes back with a send-back, and the next round replies under each one.
          <ol class="nr-steps"><li>Open the doc in Notion and read it in full</li><li>Comment on each issue, right on the text</li><li>Come back here: one overall evaluation, then decide</li></ol>
        </div>
        <div class="col" style={{ alignItems: "flex-end" }}>
          <Btn kind="btn-primary" disabled={!s?.url} onClick={() => s?.url && openUrl(s.url)}><Ic n="external-link" s={14} />Open in Notion</Btn>
          <span class="xs faint">{s?.url ? `Factory Reviews / ${t.id} / Round ${round}` : s || sum.error ? "Not on Notion yet: set up the board on Connections" : "Loading…"}</span>
        </div>
      </div>
      <div class="gate-wrap">
        <article class="doc readonly">
          <div class="ro-band">Summary preview · read only · comment in Notion, not here</div>
          <h1>{t.title}</h1>
          <div class="props">
            <span>Stage</span><b>{isPlan ? "Plan" : "Research"} · round {round} of up to {CAP + 1}</b>
            <span>Task</span><b>{t.id} <Tags ts={t.tags} /></b>
            <span>Source</span><b>{taskSource(t)}</b>
            <span>Decision</span><b><span class="chip warn">Waiting for you</span></b>
          </div>
          <h2>Summary</h2>
          {s?.summary ? <pre class="doc-md prose">{s.summary.split("\n").filter((l) => !/^#\s/.test(l)).join("\n\n")}</pre> : <p class="dim">{sum.error ?? "Loading…"}</p>}
          {!isPlan && (
            <>
              <h2>Statechart</h2>
              {s?.statechart ? <pre class="tlc">{s.statechart.slice(0, 4000)}</pre> : <p class="dim">No statechart.md (the engine wouldn't open this gate without one).</p>}
              <h2>Verification</h2>
              {s?.tlc ? <pre class="tlc">{s.tlc.slice(0, 3000)}</pre> : <p class="dim">No TLC result.</p>}
            </>
          )}
          <p style={{ marginTop: 12, color: "#9b9b9b", fontSize: 13 }}>
            The full doc in Notion also has the evidence, file:line references and the open questions.
            {t.tags.includes("learn") && <> Because this task is tagged <b style={{ color: "var(--tag-learn)" }}>learn</b>, the statechart, TLA+ model, TLC result and an explainer are kept as artifacts linked from the source.</>}
          </p>
        </article>
        <aside class="decide">
          <div class="decide-sec">
            <div class="row"><b>Comments in Notion</b><span class="chip warn">{s?.url ? `${s.discussions} open` : "–"}</span><span class="grow" /><span class="faint xs">{s?.url ? "read when this page opened" : ""}</span></div>
            <div class="small dim" style={{ marginTop: 4 }}>Counted from the Notion page. You add and edit them there; they all go back with a send-back.</div>
            <div class="row" style={{ marginTop: 6 }}><Btn disabled={!s?.url} onClick={() => s?.url && openUrl(s.url)}><Ic n="message-square" s={14} />Open comments in Notion</Btn></div>
          </div>
          <div class="decide-sec">
            <b>Overall evaluation</b>
            <div class="small dim" style={{ margin: "2px 0 6px" }}>One verdict on the whole document, not line comments.</div>
            <div class="seg" style={{ marginBottom: 6 }}>
              {(["solid", "work", "off"] as const).map((v) => <button key={v} class={verdict === v ? "on" : ""} onClick={() => setVerdict(v)}>{v === "solid" ? "Solid" : v === "work" ? "Needs work" : "Off track"}</button>)}
            </div>
            <textarea class="in" rows={3} placeholder="How does the document hold up as a whole?" value={text} onInput={(e) => setText(e.currentTarget.value)} />
          </div>
          <Decide t={t} note={note} />
          <div class="decide-sec"><div class="harden-note"><b>Corrections become checks.</b> After a send-back the coordinator asks whether a lint rule, type or test could have caught it, and queues a <span class="tag harden">harden</span> task if so.</div></div>
          {!isPlan && <div class="decide-sec small dim">Research rule: this gate only opened because the statechart and a passing TLC check exist. That's an engine check, not a prompt.</div>}
        </aside>
      </div>
    </div>
  );
}

function PRReady({ t }: { t: Task }) {
  const files = useCall<{ name: string }[]>("job.files", { id: t.id }, [t.id]).data ?? [];
  const confirm = useCall<{ text: string }>(files.some((f) => f.name === "confirm.md") ? "job.read" : undefined, { id: t.id, name: "confirm.md" }, [files.length]).data;
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string>();
  const reviews = files.filter((f) => f.name.startsWith("review-")).map((f) => f.name);
  const m = t.machine;
  return (
    <div class="pane-body">
      <div style={{ padding: "20px 24px" }} class="col">
        <div class="row">{taskSource(t)}<span class="faint small">{t.id}</span><Tags ts={t.tags} /><span class="grow" /><span class="xs dim">send-backs <Pips used={m.tries.PRGate} /></span></div>
        <h3 style={{ fontSize: "var(--text-xl)" }}>{t.title}</h3>
        <div class="row small dim">{t.branch ? <>Branch <code>{t.branch}</code></> : "No branch recorded"}{t.repo ? ` · ${t.repo}` : ""}{t.prUrl ? " · PR opened" : ""}</div>
        <div class="grid2" style={{ gridTemplateColumns: "1.3fr 1fr", marginTop: 8 }}>
          <div class="col">
            <div class="card" style={{ borderColor: "var(--ok)", marginBottom: 8 }}>
              <div class="card-b row" style={{ alignItems: "flex-start" }}><span class="dot ok" style={{ marginTop: 5 }} /><div><b>Confirmed it solves the problem.</b> <pre class="doc-md prose dim small" style={{ margin: "4px 0 0", fontSize: 13 }}>{confirm?.text.split("\n").filter((l) => l.trim()).slice(0, 12).join("\n") ?? "The confirm stage's write-up is in confirm.md."}</pre></div></div>
            </div>
            <div class="label">Compiled review · all fixed</div>
            <div class="card"><div class="card-b">
              {reviews.length ? reviews.map((r) => <div key={r} class="find"><span style={{ color: "var(--ok)" }}><Ic n="check" s={14} /></span><span class="file" onClick={() => setOpen(open === r ? undefined : r)}>{r}</span><span class="faint xs">{m.loops.review} loop{m.loops.review === 1 ? "" : "s"}</span></div>) : <div class="small dim">No review files.</div>}
            </div></div>
            {open && <FileView id={t.id} name={open} />}
          </div>
          <div class="col">
            <div class="label">Checks, cheapest first</div>
            <div class="card"><div class="card-b layers">
              <div><span class="dot ok" />Code + security review<span class="grow" /><span class="faint xs">0 open</span></div>
              <div><span class={`dot ${m.confirmed ? "ok" : "needs"}`} />Confirmed fixed<span class="grow" /><span class="faint xs">confirm.md</span></div>
              <div><span class={`dot ${m.proved ? "ok" : "off"}`} />Formal verification<span class="grow" /><span class="faint xs">TLC at research</span></div>
              <div><span class="dot needs" /><b>You</b><span class="grow" /><span class="faint xs">{t.tags.includes("sensitive") ? "sensitive: always escalates" : "first look at code"}</span></div>
            </div></div>
            <div class="row wrap" style={{ marginTop: 6 }}>
              {t.worktree && <Btn onClick={() => openInVSCode(t.worktree!)}><Ic n="code" s={14} />Open diff in VS Code</Btn>}
              {t.prUrl && <Btn onClick={() => openUrl(t.prUrl!)}><Ic n="git-pull-request" s={14} />Open the PR</Btn>}
              <Btn kind="btn-ghost" onClick={() => go(`session/${t.id}`)}><Ic n="monitor-play" s={14} />Watch session</Btn>
            </div>
            <textarea class="in" rows={2} placeholder="Notes for the builder (these go back with a send-back)" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            <Decide t={t} note={note} />
            <div class="xs faint">On approve: the task is done, and the Slack thread or Jira ticket gets the PR link.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
