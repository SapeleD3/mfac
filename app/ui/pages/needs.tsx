import { useState } from "preact/hooks";
import { go } from "../app";
import { Btn, Pips, Tags } from "../kit";
import { act, useApp, useCall } from "../store";
import { CAP, type Task, type TaskEvent } from "../types";
import { AskBody } from "../widget";
import { TaskLi } from "./queue";

const TO: Record<string, string> = { Researching: "Restart research with a note", Planning: "Redo the plan", Building: "Retry the build", Queued: "Start over" };

export function NeedsYou({ id }: { id?: string }) {
  const app = useApp();
  const tasks = app.tasks.filter((t) => t.column === "Needs you" || t.column === "PR ready");
  const asking = app.prompts;
  const sel = app.tasks.find((t) => t.id === (id ?? tasks.find((x) => x.machine.state === "NeedsYou")?.id));
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h"><h2>Needs you</h2><span class="chip warn">{tasks.length + asking.length}</span></div>
        {asking.length > 0 && (
          <>
            <div class="label" style={{ margin: "4px 0 6px" }}>Sessions asking</div>
            <div class="p-list" style={{ padding: 0, marginBottom: 12 }}>
              {asking.map((p) => (
                <div key={p.id} class="p-row ask" style={{ cursor: "default" }}>
                  <span class="avatar" style={{ background: "var(--needs-you)" }}>?</span>
                  <div style={{ minWidth: 0 }}><div class="p-title">{app.tasks.find((t) => t.id === p.taskId)?.title ?? p.payload.title ?? "A session"}</div><div class="p-doing">{p.taskId} · {p.payload.role}</div></div>
                  <span class="dot needs" />
                  <AskBody p={p} />
                </div>
              ))}
            </div>
          </>
        )}
        {tasks.length ? <div class="list">{tasks.map((t) => <TaskLi key={t.id} t={t} on={t.id === sel?.id} />)}</div> : asking.length === 0 && <div class="empty">Nothing needs you. The factory will tell you when something does.</div>}
        {sel && sel.machine.state === "NeedsYou" && <NeedsCard t={sel} />}
        {sel && sel.machine.state !== "NeedsYou" && (sel.column === "Needs you" || sel.column === "PR ready") && (
          <div class="row" style={{ marginTop: 12 }}><Btn kind="btn-primary" onClick={() => go(`gate/${sel.id}`)}>Review {sel.id}</Btn></div>
        )}
      </main>
    </div>
  );
}

function NeedsCard({ t }: { t: Task }) {
  const got = useCall<{ events: TaskEvent[] }>("task.get", { id: t.id }, [t.id]).data;
  const [note, setNote] = useState("");
  const why = [...(got?.events ?? [])].reverse().find((e) => e.to === "NeedsYou" || e.kind === "refused");
  const d = (why?.data ?? {}) as { note?: string; reason?: string; message?: string };
  const m = t.machine;
  const used = m.tries.NeedsYou;
  const targets = t.allowed.filter((a) => a.startsWith("send_back:")).map((a) => a.slice(10));
  const ranOut = m.loops.check >= CAP ? `Research check failed ${m.loops.check} of ${CAP} times.` : m.loops.review >= CAP ? `Review findings went back to the builder ${m.loops.review} of ${CAP} times.` : m.loops.confirm >= CAP ? `Confirm couldn't show it's solved after ${m.loops.confirm} tries.` : "";
  const buildBlocked = !targets.includes("Building") && !(m.approved.includes("research") && m.approved.includes("plan"));
  return (
    <div class="card" style={{ marginTop: 16 }}>
      <div class="card-h"><span class="dot err" />{t.title}<span class="grow" /><Tags ts={t.tags} /><span class="xs dim">needs-you <Pips used={used} /></span></div>
      <div class="card-b col">
        {ranOut && <div class="small">{ranOut}</div>}
        {why?.kind === "refused" && <div class="p-term">Engine refused: {d.reason}</div>}
        {(d.note || d.message) && <div class="small dim">Coordinator: “{d.note ?? d.message}”</div>}
        {!ranOut && !why && <div class="small dim">The coordinator stopped and asked for you. See the task's log for what it tried.</div>}
        <textarea class="in" rows={2} placeholder="A note for the stage that picks this up" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        <div class="row wrap">
          {targets.map((x, i) => (
            <Btn key={x} kind={i === 0 ? "btn-primary" : ""} onClick={() => act("task.decide", { id: t.id, verdict: "send_back", to: x, note }, ["tasks"])}>{TO[x] ?? `Back to ${x}`}</Btn>
          ))}
          <Btn onClick={() => go(`task/${t.id}`)}>Open the task</Btn>
          <Btn kind="btn-ghost" onClick={() => act("task.park", { id: t.id }, ["tasks"])}>Park</Btn>
          <Btn kind="btn-ghost" onClick={() => act("task.decide", { id: t.id, verdict: "drop", note }, ["tasks"])}>Drop</Btn>
        </div>
        {buildBlocked && <div class="xs faint">Retry the build is off: research and plan aren't both approved yet (build rule).</div>}
        {used >= CAP && <div class="xs faint">No send-backs left here: drop it, or park it to come back later.</div>}
      </div>
    </div>
  );
}
