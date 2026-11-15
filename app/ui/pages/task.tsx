import { useState } from "preact/hooks";
import { go } from "../app";
import { openInVSCode, openTerminal, openUrl } from "../bridge";
import { Btn, Ic, Pips, RECIPE, StateChip, StateDot, TagChip, Tags, clock, doing, position, taskSource, tokens } from "../kit";
import { act, useApp, useCall } from "../store";
import { TAGS, type Stage, type Task, type TaskEvent } from "../types";

const notionUrl = (id?: string) => (id ? `https://www.notion.so/${id.replace(/-/g, "")}` : undefined);

export function TaskPage({ id }: { id: string }) {
  const app = useApp();
  const active = app.tasks.filter((t) => t.column !== "Done" && t.column !== "Inbox");
  const t = app.tasks.find((x) => x.id === id);
  const list = [...active, ...(t && !active.includes(t) ? [t] : [])];
  return (
    <div class="pane-body split">
      <div class="tlist">
        {list.map((x) => (
          <div key={x.id} class={`li ${x.id === id ? "on" : ""}`} style={{ gridTemplateColumns: "14px 1fr" }} onClick={() => go(`task/${x.id}`)}>
            <StateDot t={x} />
            <div style={{ minWidth: 0 }}>
              <div class="li-t" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {x.title}
              </div>
              <div class="li-s">
                {taskSource(x)}
                <span class="faint">{x.id}</span>
              </div>
              <div class="li-s">
                <StateChip t={x} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {t ? <Detail t={t} /> : <div class="empty">{app.loaded ? `No task ${id}.` : "Loading…"}</div>}
    </div>
  );
}

function Detail({ t }: { t: Task }) {
  const got = useCall<{ task: Task; events: TaskEvent[] }>("task.get", { id: t.id }, [t.id]).data;
  const stages = useCall<Stage[]>("stage.list", { task: t.id }, [t.id]).data ?? [];
  const files = useCall<{ name: string; bytes: number; dir: boolean }[]>("job.files", { id: t.id }, [t.id]).data ?? [];
  const [file, setFile] = useState<string>();
  const [tagging, setTagging] = useState(false);
  const events = got?.events ?? [];
  const s = t.machine.state;
  const running = stages.some((x) => x.status === "running");
  const minutes = Math.round((Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / 60000);
  const sendBacks = Object.values(t.machine.tries).reduce((a, b) => a + b, 0);

  return (
    <section class="detail">
      <div class="row">
        {taskSource(t)}
        <span class="faint small">
          {t.id} · {t.repo ?? "repo not chosen yet"}
        </span>
        <span class="grow" />
        {stages.length > 0 && (
          <Btn onClick={() => go(`session/${t.id}`)}>
            <Ic n="monitor-play" s={14} />
            Watch session
          </Btn>
        )}
        {t.worktree && (
          <Btn onClick={() => openInVSCode(t.worktree!)}>
            <Ic n="code" s={14} />
            Open worktree in VS Code
          </Btn>
        )}
        {(s === "ResearchGate" || s === "PlanGate" || s === "PRGate") && (
          <Btn kind="btn-primary" onClick={() => go(`gate/${t.id}`)}>
            <Ic n="diamond" s={14} />
            Review and decide
          </Btn>
        )}
        {s === "NeedsYou" && (
          <Btn kind="btn-primary" onClick={() => go(`needs/${t.id}`)}>
            Decide
          </Btn>
        )}
        {t.column === "Running" && (
          <Btn kind="btn-ghost" onClick={() => act("task.interrupt", { id: t.id, note: "stopped from the app" }, ["tasks"])} title="Stops the stage and moves the task to Needs you">
            <Ic n="pause" s={14} />
            Stop
          </Btn>
        )}
        {t.allowed.includes("prioritize") && (
          <Btn kind="btn-ghost" onClick={() => act("task.prioritize", { id: t.id }, ["tasks", "status"])}>
            <Ic n="arrow-up" s={14} />
            Move to queue
          </Btn>
        )}
        {t.allowed.includes("demote") && (
          <Btn kind="btn-ghost" onClick={() => act("task.demote", { id: t.id }, ["tasks", "status"])}>
            <Ic n="arrow-down" s={14} />
            Move to backlog
          </Btn>
        )}
        {t.allowed.includes("park") && (
          <Btn kind="btn-ghost" onClick={() => act("task.park", { id: t.id }, ["tasks", "status"])}>
            <Ic n="trash-2" s={14} />
            Move to bin
          </Btn>
        )}
        {(s === "Parked" || s === "Dropped") && (
          <Btn kind="btn-ghost" onClick={() => act("task.restore", { id: t.id }, ["tasks", "status"])}>
            <Ic n="undo-2" s={14} />
            Restore
          </Btn>
        )}
      </div>
      <h3 style={{ margin: "8px 0 4px", fontSize: "var(--text-xl)" }}>{t.title}</h3>
      <div class="row wrap">
        <StateChip t={t} />
        {t.tags.map((x) => (
          <TagChip key={x} t={x} onRemove={() => act("task.tag", { id: t.id, remove: [x] }, ["tasks"])} />
        ))}
        {tagging ? (
          TAGS.filter((x) => !t.tags.includes(x)).map((x) => (
            <span key={x} class={`tag ${x}`} style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => (setTagging(false), act("task.tag", { id: t.id, add: [x] }, ["tasks"]))}>
              {x}
            </span>
          ))
        ) : (
          <span class="tag add" onClick={() => setTagging(true)}>
            <Ic n="plus" s={11} /> tag
          </span>
        )}
        {t.worktree && <span class="faint small">· {t.worktree}</span>}
      </div>
      {t.body && (
        <p class="small dim" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {t.body}
        </p>
      )}
      <div class="grid2" style={{ marginTop: 12, gridTemplateColumns: "1.15fr 1fr" }}>
        <div>
          <Rail t={t} stages={stages} files={files.map((f) => f.name)} onFile={setFile} />
        </div>
        <div class="col">
          <div class="label">Coordinator · {t.machine.state === "Queued" ? "starts with the task" : running ? "working" : "idle"}</div>
          <div class="coord" style={{ maxHeight: 280, overflow: "auto" }}>
            {events.length === 0 && <div class="small dim">Nothing yet.</div>}
            {events.slice(-40).map((e) => (
              <EventLine key={e.id} e={e} />
            ))}
          </div>
          <div class="label" style={{ marginTop: 8 }}>
            Files in jobs/{t.id}
          </div>
          <div class="st-files">
            {files
              .filter((f) => !f.dir)
              .map((f) => (
                <span key={f.name} class={`file ${file === f.name ? "on" : ""}`} onClick={() => setFile(file === f.name ? undefined : f.name)}>
                  {f.name}
                </span>
              ))}
            {files.length === 0 && <span class="small dim">No files yet. Each stage writes its output here.</span>}
          </div>
          {file && <FileView id={t.id} name={file} />}
          <div class="label" style={{ marginTop: 8 }}>
            Cost so far
          </div>
          <div class="small dim">
            {tokens(t.tokens)} tokens · {minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`} · {sendBacks} send-back{sendBacks === 1 ? "" : "s"} total
          </div>
          <div class="label" style={{ marginTop: 8 }}>
            Linked
          </div>
          <div class="small row wrap">
            {t.sourceUrl ? (
              <a href="#" onClick={(e) => (e.preventDefault(), openUrl(t.sourceUrl!))}>
                {taskSource(t)}
              </a>
            ) : (
              taskSource(t)
            )}
            {t.notionReviewId && (
              <a href="#" onClick={(e) => (e.preventDefault(), openUrl(notionUrl(t.notionReviewId)!))}>
                <span class="src">
                  <Ic n="external-link" s={13} />
                  Review doc in Notion
                </span>
              </a>
            )}
            {t.prUrl && (
              <a href="#" onClick={(e) => (e.preventDefault(), openUrl(t.prUrl!))}>
                <span class="src">
                  <Ic n="git-pull-request" s={13} />
                  Pull request
                </span>
              </a>
            )}
            {t.branch && <code class="xs">{t.branch}</code>}
          </div>
          {stages.length > 0 && (
            <div class="row" style={{ marginTop: 8 }}>
              <Btn kind="btn-ghost" onClick={() => openTerminal(`factory attach ${t.id}`)}>
                <Ic n="square-terminal" s={14} />
                Open in Terminal
              </Btn>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Rail({ t, stages, files, onFile }: { t: Task; stages: Stage[]; files: string[]; onFile: (f: string) => void }) {
  const m = t.machine;
  const { at, kind } = position(m);
  const last = (role: string) => [...stages].reverse().find((s) => s.role === role);
  const has = (f: string) => files.includes(f);
  const rows: { id: string; sub: string; files: string[]; cap?: preact.JSX.Element }[] = [
    { id: "triage", sub: t.source === "manual" ? "Added by you" : `From ${t.source}${t.sourceRef ? ` ${t.sourceRef.split("@")[0]}` : ""}`, files: [] },
    { id: "research", sub: stageLine(last("researcher")) || "researcher", files: ["research.md", "statechart.md"].filter(has).concat(files.filter((f) => f.endsWith(".tla"))) },
    {
      id: "check",
      sub: m.proved ? "Statechart present and TLC passed" : m.loops.check ? "TLC found a problem; research is fixing it" : "Statechart + TLA+ model checked by TLC",
      files: ["tlc-result.md"].filter(has),
      cap: (
        <>
          check <Pips used={m.loops.check} />
        </>
      ),
    },
    {
      id: "rgate",
      sub: m.approved.includes("research") ? "Approved by you" : "You review in Notion",
      files: [],
      cap: (
        <>
          send-backs <Pips used={m.tries.ResearchGate} />
        </>
      ),
    },
    { id: "plan", sub: stageLine(last("planner")) || "planner", files: ["plan.md"].filter(has) },
    {
      id: "pgate",
      sub: m.approved.includes("plan") ? "Approved by you" : "You review in Notion",
      files: [],
      cap: (
        <>
          send-backs <Pips used={m.tries.PlanGate} />
        </>
      ),
    },
    { id: "build", sub: `${stageLine(last("builder")) || "builder"}${t.branch ? ` · ${t.branch}` : ""}`, files: ["build.md"].filter(has) },
    {
      id: "review",
      sub: "Code and security review in parallel; findings compiled and sent back to the builder",
      files: files.filter((f) => f.startsWith("review-")),
      cap: (
        <>
          to builder <Pips used={m.loops.review} />
        </>
      ),
    },
    {
      id: "confirm",
      sub: "Reruns the original problem; must say it's solved",
      files: ["confirm.md"].filter(has),
      cap: (
        <>
          tries <Pips used={m.loops.confirm} />
        </>
      ),
    },
    {
      id: "dgate",
      sub: "Your first look at the code: the PR, evidence, and the diff in VS Code",
      files: [],
      cap: (
        <>
          send-backs <Pips used={m.tries.PRGate} />
        </>
      ),
    },
    { id: "done", sub: t.source === "slack" || t.source === "jira" ? `Written back to ${t.source}` : "PR link kept on the task", files: [] },
  ];
  return (
    <div class="rail">
      {rows.map((r, i) => {
        const def = RECIPE[i]!;
        const gate = "gate" in def && def.gate;
        const auto = "auto" in def && def.auto;
        const state = i < at ? "done" : i === at ? (kind === "fail" ? "fail" : kind === "queued" || kind === "parked" ? "todo" : kind === "done" ? "done" : "now") : "todo";
        const cls = `st ${state} ${gate ? "gate" : ""} ${auto || ["build", "review", "confirm"].includes(r.id) ? "auto" : ""}`;
        return (
          <div key={r.id} class={cls}>
            <span class="st-dot">
              <span>{state === "done" && !gate ? <Ic n="check" s={12} /> : gate ? state === "done" ? <Ic n="check" s={12} /> : "" : i + 1}</span>
            </span>
            <div>
              <div class="st-head">
                <b>{def.name}</b>
                {gate ? <span class="chip warn">you</span> : r.id === "build" || auto ? <span class="chip">no gate</span> : null}
                <span class="grow" />
                <span class="xs dim">{r.cap}</span>
              </div>
              <div class="st-sub">{i === at && kind === "fail" ? doing(t) : r.sub}</div>
              {r.files.length > 0 && (
                <div class="st-files">
                  {r.files.map((f) => (
                    <span key={f} class={`file ${state === "done" ? "ok" : ""}`} onClick={() => onFile(f)}>
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const stageLine = (s?: Stage) => (s ? `${s.role.replace("_", " ")} · ${s.model}${s.round > 1 ? ` · round ${s.round}` : ""} · ${s.status === "running" ? "running" : s.status}` : "");

function EventLine({ e }: { e: TaskEvent }) {
  const d = e.data as { note?: string; reason?: string; message?: string; role?: string; event?: { type?: string }; verdict?: string; add?: string[]; remove?: string[]; error?: string };
  let text: preact.ComponentChildren;
  let cls = "";
  switch (e.kind) {
    case "created":
      text = "Task created.";
      break;
    case "refused":
      cls = "engine-no";
      text = `Engine refused “${d.event?.type ?? "?"}”: ${d.reason}`;
      break;
    case "session_started":
      text = (
        <>
          Started <b>{d.role?.replace("_", " ")}</b>.
        </>
      );
      break;
    case "session_resumed":
      text = (
        <>
          Resumed <b>{d.role?.replace("_", " ")}</b>.
        </>
      );
      break;
    case "coordinator_woken":
      text = <span class="dim">{(d.message ?? "").split("\n")[0]?.slice(0, 160)}</span>;
      break;
    case "tagged":
      text = `Tags: ${[...(d.add ?? []).map((x) => `+${x}`), ...(d.remove ?? []).map((x) => `−${x}`)].join(" ")}`;
      break;
    case "taken_over":
      text = "You took over the session; the coordinator waits.";
      break;
    case "handed_back":
      text = "You handed the session back.";
      break;
    case "worktree_failed":
      cls = "engine-no";
      text = `Couldn't make the worktree: ${d.error}`;
      break;
    case "repo_setup":
      text = "Ran the repo's setup.";
      break;
    default:
      text = (
        <>
          {e.actor === "human" ? "You" : e.actor}: <b>{e.kind}</b>
          {e.to && e.from !== e.to ? ` → ${e.to}` : ""}
          {d.note ? ` · “${d.note}”` : ""}
        </>
      );
  }
  return (
    <div class="coord-line">
      <span class="t">{clock(e.at)}</span>
      <span class={cls}>{text}</span>
    </div>
  );
}

export function FileView({ id, name }: { id: string; name: string }) {
  const f = useCall<{ text: string; path: string; truncated: boolean }>("job.read", { id, name }, [id, name]);
  return (
    <div class="card" style={{ marginTop: 8 }}>
      <div class="card-h">
        <Ic n="file-text" s={14} />
        {name}
        <span class="grow" />
        {f.data && (
          <Btn kind="btn-ghost" onClick={() => openInVSCode(f.data!.path)}>
            Open in VS Code
          </Btn>
        )}
      </div>
      <div class="card-b" style={{ maxHeight: 360, overflow: "auto" }}>
        {f.error ? (
          <div class="err-line">{f.error}</div>
        ) : (
          <pre class="doc-md" style={{ margin: 0 }}>
            {f.data?.text ?? "Loading…"}
          </pre>
        )}
      </div>
    </div>
  );
}

export { Tags };
