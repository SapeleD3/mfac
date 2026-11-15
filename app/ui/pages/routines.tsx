import { useState } from "preact/hooks";
import { Btn, Ic, IconBtn, ago, clock, every, until } from "../kit";
import { act, useApp, useCall } from "../store";
import type { MachineRoutine, Routine } from "../types";

const ICON: Record<string, string> = { "health-check": "heart-pulse", "intake-slack": "inbox", "intake-jira": "inbox", "intake-notion": "inbox", "notion-pull": "refresh-cw", triage: "list-ordered", "notion-sync": "refresh-cw", cleanup: "sparkles", "post-merge-watch": "radar", "usage-guard": "gauge", doctor: "shield-check", retro: "notebook-pen", "improve-factory": "sparkles" };

export function Routines() {
  const app = useApp();
  const [f, setF] = useState<"all" | "on" | "paused" | "fail">("all");
  const [hist, setHist] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const all = app.routines;
  const bad = (r: Routine) => r.lastResult === "failed" || r.lastResult === "warn";
  const machine = useCall<MachineRoutine[]>("routines.machine").data;
  const show = all.filter((r) => f === "all" || (f === "on" && r.enabled) || (f === "paused" && !r.enabled) || (f === "fail" && bad(r)));
  const counts = { all: all.length, on: all.filter((r) => r.enabled).length, paused: all.filter((r) => !r.enabled).length, fail: all.filter(bad).length };
  const runningNow = all.find((r) => r.lastResult === "running");
  const next = all.filter((r) => r.enabled && r.nextRunAt).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  const groups: [string, Routine[]][] = [["Built in", show.filter((r) => r.builtin)], ["Added in the factory", show.filter((r) => !r.builtin)]];
  const res = (r: Routine) => {
    if (!r.lastResult) return <span class="chip">not run yet</span>;
    const [cls, icon] = r.lastResult === "ok" ? ["ok", "circle-check"] : r.lastResult === "warn" ? ["warn", "triangle-alert"] : r.lastResult === "skipped" ? ["", "circle-minus"] : r.lastResult === "running" ? ["work", "activity"] : ["err", "circle-x"];
    return <span class={`chip rt-chip ${cls}`} title={r.lastDetail || r.lastResult}><Ic n={icon} s={12} /><span>{r.lastDetail || r.lastResult}</span></span>;
  };
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h">
          <h2>Routines</h2><span class="grow" />
          <div class="seg">{([["all", "All"], ["on", "On"], ["paused", "Paused"], ["fail", "Needs attention"]] as const).map(([id, n]) => <button key={id} class={f === id ? "on" : ""} onClick={() => setF(id)}>{n} {counts[id]}</button>)}</div>
          <Btn kind="btn-primary" onClick={() => setAdding(true)}><Ic n="plus" s={14} />New routine</Btn>
        </div>
        <div class="grid3" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 14 }}>
          {([["activity", "Running now", runningNow?.name ?? "Nothing", runningNow ? "started " + ago(runningNow.lastRunAt) : ""], ["circle-x", "Failing", String(counts.fail), all.filter(bad).map((r) => r.name).join(", ")], ["circle-pause", "Paused", String(counts.paused), ""], ["clock", "Next up", next?.name ?? "–", next ? (until(next.nextRunAt) === "now" ? "due now" : `in ${until(next.nextRunAt)}`) : ""]] as const).map(([i, a, b, c]) => (
            <div key={a} class="card metric"><div class="xs dim row" style={{ gap: 6 }}><Ic n={i} s={13} /> {a}</div><div class="v" style={{ fontSize: "var(--text-lg)" }}>{b}</div><div class="d faint">{c}</div></div>
          ))}
        </div>
        <div class="list rt">
          <div class="rt-row rt-head"><span /><span>Routine</span><span>Schedule</span><span>Last run</span><span>Next run</span><span>State</span><span /></div>
          {groups.filter(([, rs]) => rs.length).map(([g, rs]) => (
            <div key={g}>
              <div class="rt-group">{g}</div>
              {rs.map((r) => (
                <div key={r.id} class={`rt-row ${bad(r) ? "bad" : ""}`}>
                  <span class="rt-ic"><Ic n={ICON[r.id] ?? "calendar-clock"} s={16} /></span>
                  <span class="rt-name"><b>{r.name}</b><div class="xs dim rt-desc" title={r.description}>{r.description}</div>{r.failures >= 3 && <div class="xs" style={{ color: "var(--danger)" }}>failed {r.failures} times in a row</div>}</span>
                  <span class="small">
                    {editing === r.id ? (
                      <input class="in xs" style={{ width: 70 }} defaultValue={`${Math.round(r.everySeconds / 60)}m`} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { void act("routines.update", { id: r.id, every: e.currentTarget.value }, ["routines"]); setEditing(undefined); } else if (e.key === "Escape") setEditing(undefined); }} />
                    ) : (
                      <>
                        <div>{every(r.everySeconds)}{r.workingHours ? ", working hours" : ""}</div>
                        {r.defaultEverySeconds !== undefined && <div class="xs faint">{r.defaultEverySeconds === r.everySeconds ? "default" : `changed; default ${every(r.defaultEverySeconds)}`}</div>}
                      </>
                    )}
                  </span>
                  <span class="col rt-last"><span class="small">{r.lastRunAt ? clock(r.lastRunAt) : "–"}</span>{res(r)}</span>
                  <span class={`small ${r.enabled ? "" : "dim"}`}>{r.enabled ? (r.nextRunAt ? `${clock(r.nextRunAt)} · ${until(r.nextRunAt) === "now" ? "due now" : `in ${until(r.nextRunAt)}`}` : "soon") : "–"}</span>
                  <span class="row" style={{ gap: 6, cursor: "pointer" }} onClick={() => act("routines.update", { id: r.id, enabled: !r.enabled }, ["routines"])}>
                    <span class={`switch ${r.enabled ? "on" : ""}`} /><span class={`small ${r.enabled ? "" : "dim"}`}>{r.enabled ? "On" : "Paused"}</span>
                  </span>
                  <span class="row" style={{ gap: 2 }}>
                    <IconBtn n="play" s={14} title="Run now" onClick={() => act("routines.run", { id: r.id }, ["routines"])} />
                    <IconBtn n="history" s={14} title="History" onClick={() => setHist(hist === r.id ? undefined : r.id)} />
                    <IconBtn n="pen-line" s={14} title="Change the schedule" onClick={() => setEditing(r.id)} />
                    {!r.builtin && <IconBtn n="x" s={14} title="Remove" onClick={() => act("routines.remove", { id: r.id }, ["routines"])} />}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {hist && <History id={hist} name={all.find((r) => r.id === hist)?.name ?? hist} />}
        <OnThisMac rs={machine} />
        <p class="note"><b>What you can change.</b> Every built-in schedule is a default: the pencil changes how often it runs, the switch pauses it, and Settings sets working hours and the intake interval. Built-ins can't be deleted, and caps and gates aren't routines, so they can't be switched off here. Routines you add are a shell command on a schedule, often <code>factory add …</code>. Same list in the terminal: <code>factory routines</code>.</p>
      </main>
      {adding && <NewRoutine close={() => setAdding(false)} />}
    </div>
  );
}

const MSTATE: Record<MachineRoutine["state"], string> = { running: "work", loaded: "ok", failing: "err", "not loaded": "", disabled: "", scheduled: "ok" };
const KIND: Record<MachineRoutine["kind"], string> = { launchd: "Launch agent", cron: "crontab", claude: "Claude scheduled task" };

function OnThisMac({ rs }: { rs?: MachineRoutine[] }) {
  return (
    <div class="list rt" style={{ marginTop: 16 }}>
      <div class="rt-group">On this Mac · read-only</div>
      {rs === undefined && <div class="rt-row"><span /><span class="small dim">Looking…</span></div>}
      {rs?.length === 0 && <div class="small dim" style={{ padding: "10px 12px" }}>No launch agents in ~/Library/LaunchAgents, no crontab entries and no Claude scheduled tasks were found for your user.</div>}
      {rs?.map((r) => (
        <div key={r.id} class={`rt-row ${r.state === "failing" ? "bad" : ""}`}>
          <span class="rt-ic"><Ic n={r.kind === "cron" ? "clock" : r.kind === "claude" ? "sparkles" : "laptop"} s={16} /></span>
          <span class="rt-name"><b title={r.name}>{r.name}</b><div class="xs dim rt-desc" title={r.command}>{KIND[r.kind]}{r.factory ? " · the factory's own" : ""}{r.command ? ` · ${r.command}` : ""}</div></span>
          <span class="small">{r.schedule}</span>
          <span class="col rt-last"><span class={`chip rt-chip ${MSTATE[r.state]}`} title={r.detail}><span>{r.state}{r.detail ? ` · ${r.detail}` : ""}</span></span></span>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function History({ id, name }: { id: string; name: string }) {
  const runs = useCall<{ id: number; started_at: string; ended_at?: string; result: string; detail?: string }[]>("routines.history", { id, limit: 24 }, [id]).data ?? [];
  const [sel, setSel] = useState<number>();
  const shown = runs.find((r) => r.id === sel) ?? runs.find((r) => r.result === "failed") ?? runs[0];
  return (
    <div class="card" style={{ marginTop: 16 }}>
      <div class="card-h"><Ic n="history" s={15} /> {name} · last {runs.length} runs<span class="grow" /><span class="xs dim">click a run to see its result</span></div>
      <div class="card-b">
        <div class="runs">{[...runs].reverse().map((r) => <span key={r.id} class={`run ${r.result === "ok" ? "ok" : r.result === "failed" ? "fail" : "skip"}`} title={clock(r.started_at)} onClick={() => setSel(r.id)} style={{ cursor: "pointer" }} />)}</div>
        {shown && <div class="xs dim" style={{ marginTop: 6 }}>{clock(shown.started_at)} {shown.result}: <code>{shown.detail || "–"}</code></div>}
        {runs.length === 0 && <div class="small dim">No runs yet.</div>}
      </div>
    </div>
  );
}

function NewRoutine({ close }: { close: () => void }) {
  const [name, setName] = useState("");
  const [everyS, setEvery] = useState("1h");
  const [command, setCommand] = useState("");
  const [wh, setWh] = useState(true);
  const add = async () => {
    if (await act("routines.add", { name, every: everyS, command, workingHours: wh }, ["routines"])) close();
  };
  return (
    <div class="modal-back" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New routine</h3>
        <input class="in" placeholder="Name, e.g. Nightly dependency check" value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
        <input class="in" placeholder="Every: 10m, 2h, 1d" value={everyS} onInput={(e) => setEvery(e.currentTarget.value)} />
        <input class="in" style={{ fontFamily: "var(--font-mono)" }} placeholder={'Command, e.g. factory add "Check for outdated deps in api" --tags harden'} value={command} onInput={(e) => setCommand(e.currentTarget.value)} />
        <label class="row small" style={{ cursor: "pointer" }} onClick={() => setWh(!wh)}><span class={`switch ${wh ? "on" : ""}`} />Only in working hours</label>
        <div class="row"><span class="grow" /><Btn kind="btn-ghost" onClick={close}>Cancel</Btn><Btn kind="btn-primary" onClick={add} disabled={!name.trim() || !command.trim()}>Add routine</Btn></div>
      </div>
    </div>
  );
}
