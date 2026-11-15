import { useEffect, useState } from "preact/hooks";
import { Ic, LOGO } from "./kit";
import { Connections } from "./pages/connections";
import { Gate } from "./pages/gate";
import { Improve } from "./pages/improve";
import { Inbox } from "./pages/inbox";
import { NeedsYou } from "./pages/needs";
import { Queue } from "./pages/queue";
import { Routines } from "./pages/routines";
import { Session } from "./pages/session";
import { SettingsPage } from "./pages/settings";
import { TaskPage } from "./pages/task";
import { useApp } from "./store";

export type Route = { page: string; id?: string; query: URLSearchParams };
const parse = (): Route => {
  const [path = "", q = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [page, id] = path.split("/");
  return { page: page || "queue", id, query: new URLSearchParams(q) };
};
export const go = (to: string) => (location.hash = to);

export function App() {
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
    };
    addEventListener("keydown", key);
    return () => (removeEventListener("hashchange", on), removeEventListener("keydown", key));
  }, []);
  useEffect(() => {
    document.body.classList.toggle("side-min", min);
    localStorage.setItem("factory.sideMin", min ? "1" : "0");
  }, [min]);

  const pages: Record<string, [string, () => preact.JSX.Element]> = {
    queue: ["Queue", () => <Queue route={route} />],
    running: ["Running", () => <Queue route={route} only="Running" />],
    done: ["Done", () => <Queue route={route} only="Done" />],
    task: [route.id ?? "Task", () => <TaskPage id={route.id!} />],
    gate: [`Review gate · ${route.id}`, () => <Gate id={route.id!} />],
    needs: ["Needs you", () => <NeedsYou id={route.id} />],
    session: [`${route.id} · live session`, () => <Session id={route.id!} stage={route.query.get("stage") ?? undefined} />],
    inbox: ["Inbox", () => <Inbox />],
    connections: ["Connections", () => <Connections />],
    routines: ["Routines", () => <Routines />],
    improve: ["Rules and learning", () => <Improve />],
    settings: ["Settings", () => <SettingsPage />],
  };
  const [title, render] = pages[route.page] ?? pages.queue!;
  return (
    <div class="app">
      <Side on={route.page} min={min} toggle={() => setMin(!min)} />
      <div class="pane">
        <TopBar title={title} />
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
  const failing = app.routines.filter((r) => r.lastResult === "failed").length;
  const g = app.status?.guard;
  const share = g?.share !== undefined ? Math.round(g.share * 100) : undefined;
  const weekly = g?.weekly !== undefined ? Math.round(g.weekly * 100) : undefined;
  const ceiling = Math.round((app.settings?.usageCeiling ?? 0.85) * 100);
  const link = (id: string, icon: string, label: string, n?: string | number, ncls = "") => (
    <a class={on === id ? "on" : ""} href={`#${id}`} title={label}>
      <Ic n={icon} /><span class="lbl">{label}</span>{n !== undefined && n !== "" && n !== 0 && <span class={`n ${ncls}`}>{n}</span>}
    </a>
  );
  return (
    <nav class="side">
      <div class="sb-top" data-tauri-drag-region>
        <span class="lights-space" data-tauri-drag-region />
        <span class="grow" data-tauri-drag-region />
        <button class="icon-btn side-toggle" onClick={toggle} title={`${min ? "Show" : "Collapse"} sidebar (⌘\\)`}><Ic n={min ? "panel-left-open" : "panel-left-close"} /></button>
      </div>
      {link("needs", "bell-ring", "Needs you", needs || undefined, "amber")}
      {link("running", "activity", "Running", min ? running : `${running} of ${slots}`)}
      {link("queue", "square-kanban", "Queue", t.filter((x) => x.column === "Queued").length)}
      {link("inbox", "inbox", "Inbox and triage", app.intake.filter((i) => i.status === "Inbox" || i.status === "Triage" || i.status === "ReplyDrafted").length)}
      {link("done", "circle-check", "Done", t.filter((x) => x.column === "Done").length)}
      <div class="sg"><span class="lbl">Factory</span></div>
      {link("connections", "plug", "Connections", app.alerts.length || undefined, "red")}
      {link("routines", "calendar-clock", "Routines", failing || undefined, "red")}
      {link("improve", "sparkles", "Rules and learning", app.rules.filter((r) => r.status === "proposed").length || undefined, "amber")}
      {link("settings", "settings", "Settings")}
      <div class="usage" title={share !== undefined ? `Plan usage: ${share}% of the 5h window. Queue pauses at ${ceiling}%.` : "Plan usage isn't measured yet"}>
        <div class="row lbl"><span>Plan usage, 5h window</span><span class="grow" /><b>{share !== undefined ? `${share}%` : "–"}</b></div>
        <div class={`bar ${share !== undefined && share >= ceiling - 20 ? "amber" : ""}`}><i style={{ width: `${share ?? 0}%` }} /></div>
        {weekly !== undefined && (
          <>
            <div class="row lbl"><span>Weekly</span><span class="grow" /><b>{weekly}%</b></div>
            <div class="bar"><i style={{ width: `${weekly}%` }} /></div>
          </>
        )}
        <span class="faint lbl">{app.status?.paused ? "Queue paused by you" : g?.blocked ? `Paused: ${g.reason ?? "usage"}` : `Queue pauses at ${ceiling}%`}</span>
        <b class="mini-pct">{share !== undefined ? `${share}%` : "–"}</b>
      </div>
    </nav>
  );
}

function TopBar({ title }: { title: string }) {
  const app = useApp();
  return (
    <header class="topbar" data-tauri-drag-region>
      <b class="tb-title">{LOGO}<span>Factory</span></b>
      {title && <><span class="tb-sep">/</span><span class="tb-crumb">{title}</span></>}
      <span class="grow" data-tauri-drag-region />
      <span class="tb-engine" title="The engine runs on its own; closing this window leaves the factory working.">
        <span class={`dot ${app.up ? "ok" : "err"}`} />{app.up ? "Engine up" : app.loaded ? "Engine down" : "Connecting…"}
      </span>
    </header>
  );
}

function Toasts() {
  const app = useApp();
  return <div class="toastbar">{app.toasts.map((t) => <div key={t.id} class={t.level === "error" ? "err" : ""}>{t.message}</div>)}</div>;
}
