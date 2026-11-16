import { useEffect, useState } from "preact/hooks";
import { inApp, pickFolder } from "../bridge";
import type { Route } from "../app";
import { go } from "../app";
import { Avatar, Btn, Ic, MiniRail, StateChip, StateDot, Tags, doing, taskSource } from "../kit";
import { act, refresh, toast, useApp, useCall } from "../store";
import { type Repo, TAGS, type Tag, type Task } from "../types";

const PICK = "choose-a-folder";

const COLS: [Task["column"], string, string][] = [
  ["Queued", "queued", "Waiting for a free slot"],
  ["Running", "running", "On its own; no gate until PR ready"],
  ["Needs you", "needs", "Gates, questions, permissions, caps run out"],
  ["PR ready", "pr", "Confirmed fixed; your first look at code"],
  ["Done", "done", "Written back to where it came from"],
];

function refusal(from: Task["column"], to: Task["column"]): string | undefined {
  if (from === to) return undefined;
  if (to === "PR ready") return "Only a confirmed fix reaches PR ready";
  if (to === "Done") return "Done only after you approve the PR";
  if (to === "Running") return "Runs when a slot frees";
  return "Not allowed by the engine";
}

export function Queue({ route, only }: { route: Route; only?: Task["column"] }) {
  const app = useApp();
  const [view, setView] = useState<"board" | "list">(() => (only ? "list" : ((localStorage.getItem("factory.qview") as "board" | "list") ?? "board")));
  const [tag, setTag] = useState<Tag | "">("");
  const [adding, setAdding] = useState(route.query.get("new") === "1");
  const [refused, setRefused] = useState<{ col: string; why: string }>();
  const [over, setOver] = useState<string>();
  const tasks = app.tasks.filter((t) => !["Inbox", "Backlog", "Bin"].includes(t.column) && (!tag || t.tags.includes(tag)) && (!only || t.column === only));
  const backlog = app.tasks.filter((t) => t.column === "Backlog").length;
  const binned = app.tasks.filter((t) => t.column === "Bin").length;
  const waiting = app.intake.filter((i) => i.status === "Inbox" || i.status === "Triage" || i.status === "ReplyDrafted").length;
  const askOf = (t: Task) => app.prompts.find((p) => p.taskId === t.id)?.kind;
  const colOf = (t: Task): Task["column"] => (askOf(t) && t.column === "Running" ? "Needs you" : t.column);

  const drop = async (id: string, to: Task["column"]) => {
    const t = app.tasks.find((x) => x.id === id);
    if (!t || t.column === to) return;
    const why = refusal(t.column, to);
    if (why) {
      setRefused({ col: to, why });
      setTimeout(() => setRefused(undefined), 1400);
      return;
    }
  };

  const head = (
    <div class="main-h">
      <h2>{only ?? "All tasks"}</h2>
      <span class="grow" />
      {!only && (
        <div class="seg">
          {(["board", "list"] as const).map((v) => (
            <button key={v} class={view === v ? "on" : ""} onClick={() => (setView(v), localStorage.setItem("factory.qview", v))}>
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
      )}
      <div class="seg">
        <button class={!tag ? "on" : ""} onClick={() => setTag("")}>
          All tags
        </button>
        {TAGS.map((t) => (
          <button key={t} class={tag === t ? "on" : ""} onClick={() => setTag(t)}>
            {t}
          </button>
        ))}
      </div>
      {!only && (
        <Btn onClick={() => go("backlog")}>
          <Ic n="archive" s={14} />
          Backlog {backlog}
        </Btn>
      )}
      {!only && (
        <Btn onClick={() => go("bin")}>
          <Ic n="trash-2" s={14} />
          Bin {binned}
        </Btn>
      )}
      <Btn kind="btn-primary" onClick={() => setAdding(true)}>
        <Ic n="plus" s={14} />
        New task
      </Btn>
    </div>
  );

  let body: preact.JSX.Element | preact.JSX.Element[];
  if (view === "board" && !only) {
    body = (
      <div class="kb">
        {COLS.map(([col, cls, hint]) => {
          const cards = tasks.filter((t) => colOf(t) === col).slice(0, col === "Done" ? 12 : 100);
          return (
            <div
              key={col}
              class={`kb-col ${cls} ${over === col ? "over" : ""} ${refused?.col === col ? "refused" : ""}`}
              data-why={refused?.col === col ? refused.why : undefined}
              onDragOver={(e) => (e.preventDefault(), setOver(col))}
              onDragLeave={() => setOver(undefined)}
              onDrop={(e) => (e.preventDefault(), setOver(undefined), void drop(e.dataTransfer?.getData("text/plain") ?? "", col))}
            >
              <div class="kb-h">
                <b>{col}</b>
                <span class="chip">{tasks.filter((t) => colOf(t) === col).length}</span>
              </div>
              <div class="xs faint kb-hint">{hint}</div>
              {cards.map((t) => (
                <div key={t.id} class="kb-card" draggable onDragStart={(e) => e.dataTransfer?.setData("text/plain", t.id)} onClick={() => go(`task/${t.id}`)}>
                  <div class="row" style={{ gap: 6 }}>
                    <Avatar t={t} />
                    <b class="kb-t">{t.title}</b>
                  </div>
                  <div class="li-s">
                    {taskSource(t)}
                    <span class="faint">{t.id}</span>
                  </div>
                  <div class="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    <MiniRail t={t} />
                  </div>
                  <div class="xs dim" style={{ marginTop: 4 }}>
                    {askOf(t) ? (askOf(t) === "permission" ? "Asking permission" : "Asking a question") : doing(t)}
                  </div>
                  {t.tags.length > 0 && (
                    <div class="row wrap" style={{ gap: 4, marginTop: 6 }}>
                      <Tags ts={t.tags} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  } else {
    const groups = (only ? [only] : (["Needs you", "Running", "PR ready", "Queued", "Done"] as const)).map((g) => [g, tasks.filter((t) => colOf(t) === g)] as const).filter(([, ts]) => ts.length);
    body = groups.length ? (
      groups.map(([g, ts]) => (
        <div key={g}>
          <div class="label" style={{ margin: "14px 0 6px" }}>
            {g} · {ts.length}
          </div>
          <div class="list">
            {ts.map((t) => (
              <TaskLi key={t.id} t={t} asking={askOf(t)} />
            ))}
          </div>
        </div>
      ))
    ) : (
      <div class="empty">
        {only === "Running" ? "Nothing is running." : only === "Done" ? "Nothing finished yet." : "No active tasks."}
        {!only && (backlog > 0 || waiting > 0 || binned > 0) && (
          <div class="small dim" style={{ marginTop: 6 }}>
            {[waiting && <a href="#inbox">{waiting} waiting in the inbox</a>, backlog && <a href="#backlog">{backlog} in the backlog</a>, binned && <a href="#bin">{binned} in the bin</a>]
              .filter(Boolean)
              .map((x, i) => (
                <span key={i}>
                  {i ? " · " : ""}
                  {x}
                </span>
              ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div class="pane-body">
      <main class="main board-main">
        {head}
        {body}
      </main>
      {adding && <NewTask close={() => (setAdding(false), go(only ? (only === "Running" ? "running" : "done") : "queue"))} />}
    </div>
  );
}

export function TaskLi({ t, on, asking }: { t: Task; on?: boolean; asking?: "permission" | "question" }) {
  return (
    <div class={`li ${on ? "on" : ""}`} onClick={() => go(`task/${t.id}`)}>
      <StateDot t={t} asking={!!asking} />
      <div style={{ minWidth: 0 }}>
        <div class="li-t">{t.title}</div>
        <div class="li-s">
          {taskSource(t)}
          <span class="faint">{t.id}</span>
          <MiniRail t={t} />
          <span>{doing(t)}</span>
        </div>
      </div>
      <div class="row">
        <Tags ts={t.tags} />
        <StateChip t={t} asking={asking} />
      </div>
    </div>
  );
}

function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const repos = useCall<Repo[]>("repo.list").data;
  const [typing, setTyping] = useState(false);
  const known = (repos ?? []).some((r) => r.path === value);
  useEffect(() => {
    const def = repos?.find((r) => r.isDefault);
    if (def && value === "") onChange(def.path);
  }, [repos]);
  const choose = async () => {
    if (!inApp) return setTyping(true);
    const picked = await pickFolder("Folder for this task");
    if (picked) onChange(picked);
  };
  return (
    <div class="row wrap">
      <span class="small dim">Folder</span>
      <select
        class="in"
        style={{ width: "auto", maxWidth: 320 }}
        value={value}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v !== PICK) return onChange(v);
          e.currentTarget.value = value;
          void choose();
        }}
      >
        <option value="">None: research only</option>
        {(repos ?? []).map((r) => (
          <option key={r.name} value={r.path}>
            {r.name}
            {r.isDefault ? " (default)" : ""}
          </option>
        ))}
        {value && !known && <option value={value}>{value}</option>}
        <option value={PICK}>Choose a folder…</option>
      </select>
      {typing && <input class="in" style={{ flex: 1 }} placeholder="/Users/you/code/some-folder" value={known ? "" : value} onInput={(e) => onChange(e.currentTarget.value.trim())} />}
    </div>
  );
}

function NewTask({ close }: { close: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [repo, setRepo] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [research, setResearch] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    const t = await act<Task>("task.add", { title, body, repo: repo || undefined, tags, recipe: research ? "research" : undefined }, ["tasks"]);
    if (t) {
      toast(`${t.id} queued. It starts when a slot frees.`);
      refresh("status");
      close();
    }
  };
  return (
    <div class="modal-back" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New task</h3>
        <input
          class="in"
          placeholder="What should change? One line."
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
        />
        <textarea class="in" rows={5} placeholder="Context, links, how you'll know it's fixed (optional)" value={body} onInput={(e) => setBody(e.currentTarget.value)} />
        <FolderPicker value={repo} onChange={setRepo} />
        <label class="row small" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.currentTarget.checked)} />
          Research only
          <span class="dim">research, its check and review, then your verdict; no plan or code</span>
        </label>
        <div class="row wrap">
          <span class="small dim">Tags</span>
          {TAGS.map((t) => (
            <span key={t} class={`tag ${tags.includes(t) ? t : "add"}`} style={{ cursor: "pointer" }} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
              {t}
            </span>
          ))}
        </div>
        <div class="row">
          <span class="grow" />
          <Btn kind="btn-ghost" onClick={close}>
            Cancel
          </Btn>
          <Btn kind="btn-primary" onClick={submit} disabled={!title.trim()}>
            Add to queue
          </Btn>
        </div>
      </div>
    </div>
  );
}
