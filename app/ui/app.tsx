import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Ic, LOGO } from "./kit";
import { Connections } from "./pages/connections";
import { Gate } from "./pages/gate";
import { Improve } from "./pages/improve";
import { Inbox } from "./pages/inbox";
import { NeedsYou } from "./pages/needs";
import { Projects } from "./pages/projects";
import { Queue } from "./pages/queue";
import { Routines } from "./pages/routines";
import { Session } from "./pages/session";
import { SettingsPage } from "./pages/settings";
import { Backlog, Bin } from "./pages/shelves";
import { TaskPage } from "./pages/task";
import { useApp } from "./store";

export type Route = { page: string; id?: string; query: URLSearchParams };
const parse = (): Route => {
  const [path = "", q = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [page, id] = path.split("/");
  return { page: page || "queue", id, query: new URLSearchParams(q) };
};
export const go = (to: string) => (location.hash = to);
type Crumb = { label: string; href?: string };

const SHELF: Record<string, [string, string]> = {
  Running: ["Running", "#running"],
  Done: ["Done", "#done"],
  Bin: ["Bin", "#bin"],
  Backlog: ["Backlog", "#backlog"],
  "Needs you": ["Needs you", "#needs"],
  "PR ready": ["Needs you", "#needs"],
};
const shelf = (column?: string): Crumb => {
  const [label, href] = SHELF[column ?? ""] ?? ["Queue", "#queue"];
  return { label, href };
};

export function App() {
  const app = useApp();
  const [route, setRoute] = useState(parse);
  const [min, setMin] = useState(() => localStorage.getItem("factory.sideMin") === "1");
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener("hashchange", on);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setMin((m) => !m);
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "[" || e.key === "ArrowLeft") && !(e.target instanceof HTMLElement && e.target.closest("input, textarea"))) {
        e.preventDefault();
        history.back();
      }
    };
    addEventListener("keydown", key);
    return () => (removeEventListener("hashchange", on), removeEventListener("keydown", key));
  }, []);
  useEffect(() => {
    document.body.classList.toggle("side-min", min);
    localStorage.setItem("factory.sideMin", min ? "1" : "0");
  }, [min]);

  const pages: Record<string, [string | Crumb[], () => preact.JSX.Element]> = {
    queue: ["Queue", () => <Queue route={route} />],
    running: ["Running", () => <Queue route={route} only="Running" />],
    done: ["Done", () => <Queue route={route} only="Done" />],
    task: [[shelf(app.tasks.find((x) => x.id === route.id)?.column), { label: route.id ?? "Task" }], () => <TaskPage id={route.id!} />],
    gate: [[{ label: route.id ?? "Task", href: `#task/${route.id}` }, { label: "Review gate" }], () => <Gate id={route.id!} />],
    needs: ["Needs you", () => <NeedsYou id={route.id} />],
    session: [[{ label: route.id ?? "Task", href: `#task/${route.id}` }, { label: "Live session" }], () => <Session id={route.id!} stage={route.query.get("stage") ?? undefined} />],
    inbox: ["Inbox", () => <Inbox />],
    projects: ["Projects", () => <Projects route={route} />],
    backlog: ["Backlog", () => <Backlog />],
    bin: ["Bin", () => <Bin />],
    connections: ["Connections", () => <Connections />],
    routines: ["Routines", () => <Routines />],
    improve: ["Rules and learning", () => <Improve />],
    settings: ["Settings", () => <SettingsPage />],
  };
  const [title, render] = pages[route.page] ?? pages.queue!;
  const crumbs: Crumb[] = typeof title === "string" ? [{ label: title }] : title;
  const up = crumbs.at(-2)?.href;
  useEffect(() => {
    if (!up) return;
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape" && !typing) go(up);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [up]);
  return (
    <div class="app">
      <Side on={route.page} min={min} toggle={() => setMin(!min)} />
      <div class="pane">
        <TopBar crumbs={crumbs} />
        {render()}
      </div>
      <Toasts />
    </div>
  );
}

function Side({ on, min, toggle }: { on: string; min: boolean; toggle: () => void }) {
  const app = useApp();
  const t = app.tasks;
  const needs = t.filter((x) => x.column === "Needs you" || x.column === "PR ready").length + app.prompts.length;
  const running = t.filter((x) => x.column === "Running").length;
  const slots = app.status?.slots ?? app.settings?.slots ?? 3;
  const failing = app.routines.filter((r) => r.lastResult === "failed" || r.lastResult === "warn").length;
  const g = app.status?.guard;
  const share = g?.share !== undefined ? Math.round(g.share * 100) : undefined;
  const weekly = g?.weekly !== undefined ? Math.round(g.weekly * 100) : undefined;
  const ceiling = Math.round((app.settings?.usageCeiling ?? 0.85) * 100);
  const link = (id: string, icon: string, label: string, n?: string | number, ncls = "") => (
    <a class={on === id ? "on" : ""} href={`#${id}`} title={label}>
      <Ic n={icon} s={18} />
      <span class="lbl">{label}</span>
      {n !== undefined && n !== "" && n !== 0 && <span class={`n ${ncls}`}>{n}</span>}
    </a>
  );
  return (
    <nav class="side">
      <div class="sb-top" data-tauri-drag-region>
        <span class="lights-space" data-tauri-drag-region />
        <span class="grow" data-tauri-drag-region />
        <button class="icon-btn side-toggle" onClick={toggle} title={`${min ? "Show" : "Collapse"} sidebar (⌘\\)`}>
          <Ic n={min ? "panel-left-open" : "panel-left-close"} />
        </button>
      </div>
      {link("needs", "bell-ring", "Needs you", needs || undefined, "amber")}
      {link("running", "activity", "Running", min ? running : `${running} of ${slots}`)}
      {link("queue", "square-kanban", "Queue", t.filter((x) => x.column === "Queued").length)}
      {link("inbox", "inbox", "Inbox and triage", app.intake.filter((i) => i.status === "Inbox" || i.status === "Triage" || i.status === "ReplyDrafted").length)}
      {link("backlog", "archive", "Backlog", t.filter((x) => x.column === "Backlog").length)}
      {link("done", "circle-check", "Done", t.filter((x) => x.column === "Done").length)}
      {link("bin", "trash-2", "Bin", t.filter((x) => x.column === "Bin").length)}
      {link("projects", "folders", "Projects")}
      <div class="sg">
        <span class="lbl">Factory</span>
      </div>
      {link("connections", "plug", "Connections", app.alerts.length || undefined, "red")}
      {link("routines", "calendar-clock", "Routines", failing || undefined, "red")}
      {link("improve", "sparkles", "Rules and learning", app.rules.filter((r) => r.status === "proposed").length || undefined, "amber")}
      {link("settings", "settings", "Settings")}
      <div
        class="usage"
        title={
          g?.basis === "claude"
            ? `Claude's own plan limits, as of ${g.asOf ? new Date(g.asOf).toTimeString().slice(0, 5) : "?"}${g.windowEndsAt ? `; the 5-hour limit resets ${new Date(g.windowEndsAt).toTimeString().slice(0, 5)}` : ""}. Queue pauses at ${ceiling}%.`
            : "Unknown until one of the factory's sessions reports Claude's limits. The queue isn't held for usage meanwhile."
        }
      >
        <div class="row lbl">
          <span>Plan usage, 5-hour limit</span>
          <span class="grow" />
          <b>{share !== undefined ? `${share}%` : "–"}</b>
        </div>
        <div class={`bar ${share !== undefined && share >= ceiling - 20 ? "amber" : ""}`}>
          <i style={{ width: `${share ?? 0}%` }} />
        </div>
        {weekly !== undefined && (
          <>
            <div class="row lbl">
              <span>Weekly limit</span>
              <span class="grow" />
              <b>{weekly}%</b>
            </div>
            <div class="bar">
              <i style={{ width: `${weekly}%` }} />
            </div>
          </>
        )}
        <span class="faint lbl">{app.status?.paused ? "Queue paused by you" : g?.blocked ? `Paused: ${g.reason ?? "usage"}` : `Queue pauses at ${ceiling}%`}</span>
        <b class="mini-pct">{share !== undefined ? `${share}%` : "–"}</b>
      </div>
    </nav>
  );
}

function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  const app = useApp();
  return (
    <header class="topbar" data-tauri-drag-region>
      <a class="tb-title" href="#queue" title="Back to the queue">
        {LOGO}
        <span>Factory</span>
      </a>
      {crumbs.map((c) => (
        <Fragment key={c.label}>
          <span class="tb-sep">/</span>
          {c.href ? (
            <a class="tb-crumb tb-link" href={c.href}>
              {c.label}
            </a>
          ) : (
            <span class="tb-crumb">{c.label}</span>
          )}
        </Fragment>
      ))}
      <span class="grow" data-tauri-drag-region />
      <span class="tb-engine" title="The engine runs on its own; closing this window leaves the factory working.">
        <span class={`dot ${app.up ? "ok" : "err"}`} />
        {app.up ? "Engine up" : app.loaded ? "Engine down" : "Connecting…"}
      </span>
    </header>
  );
}

function Toasts() {
  const app = useApp();
  return (
    <div class="toastbar">
      {app.toasts.map((t) => (
        <div key={t.id} class={t.level === "error" ? "err" : ""}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
