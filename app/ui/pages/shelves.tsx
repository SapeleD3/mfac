import { go } from "../app";
import { Btn, Ic, StateDot, Tags, ago, doing, taskSource } from "../kit";
import { act, useApp } from "../store";
import type { Task } from "../types";

function Row({ t, actions }: { t: Task; actions: preact.JSX.Element }) {
  return (
    <div class="li" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => go(`task/${t.id}`)}>
      <StateDot t={t} />
      <div style={{ minWidth: 0 }}>
        <div class="li-t">{t.title}</div>
        <div class="li-s">{taskSource(t)}<span class="faint">{t.id}</span><span>{doing(t)}</span><span class="faint">{ago(t.updatedAt)}</span></div>
      </div>
      <div class="row" onClick={(e) => e.stopPropagation()}><Tags ts={t.tags} />{actions}</div>
    </div>
  );
}

export function Backlog() {
  const app = useApp();
  const tasks = app.tasks.filter((t) => t.column === "Backlog").sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h"><h2>Backlog</h2><span class="grow" /><span class="small dim">Worth doing, not now. Nothing here takes a slot until you move it to the queue.</span></div>
        <div class="list">
          {tasks.map((t) => (
            <Row key={t.id} t={t} actions={<>
              <Btn kind="btn-primary" onClick={() => act("task.prioritize", { id: t.id }, ["tasks", "status"])}><Ic n="arrow-up" s={14} />Move to queue</Btn>
              <Btn kind="btn-ghost" onClick={() => act("task.park", { id: t.id }, ["tasks"])}><Ic n="trash-2" s={14} />Bin</Btn>
            </>} />
          ))}
          {tasks.length === 0 && <div class="empty">The backlog is empty. Triage sends work here when it's real but not urgent, and you can move any queued task here from its page.</div>}
        </div>
      </main>
    </div>
  );
}

export function Bin() {
  const app = useApp();
  const tasks = app.tasks.filter((t) => t.column === "Bin").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const parked = tasks.filter((t) => t.machine.state === "Parked");
  const dropped = tasks.filter((t) => t.machine.state === "Dropped");
  const restore = (t: Task) => <Btn onClick={() => act("task.restore", { id: t.id }, ["tasks", "status"])}><Ic n="undo-2" s={14} />Restore</Btn>;
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h"><h2>Bin</h2><span class="grow" /><span class="small dim">Parked work keeps its place and goes back where it was. Dropped work comes back as a new backlog task.</span></div>
        {parked.length > 0 && <div class="label" style={{ margin: "14px 0 6px" }}>Parked · {parked.length}</div>}
        <div class="list">{parked.map((t) => <Row key={t.id} t={t} actions={restore(t)} />)}</div>
        {dropped.length > 0 && <div class="label" style={{ margin: "14px 0 6px" }}>Dropped · {dropped.length}</div>}
        <div class="list">{dropped.map((t) => <Row key={t.id} t={t} actions={restore(t)} />)}</div>
        {tasks.length === 0 && <div class="empty">The bin is empty.</div>}
      </main>
    </div>
  );
}
