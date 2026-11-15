import { useState } from "preact/hooks";
import { openTerminal, openUrl } from "../bridge";
import { Brand, Btn, Ic, ago } from "../kit";
import { act, useApp, useCall } from "../store";
import type { Connection } from "../types";

const ST: Record<Connection["status"], [string, string, string]> = {
  connected: ["dot ok", "Connected", "chip ok"],
  expired: ["dot err", "Expired", "chip err"],
  error: ["dot err", "Error", "chip err"],
  missing: ["dot off", "Missing", "chip"],
};

export function Connections() {
  const app = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const alert = app.alerts[0];
  const doctor = useCall<{ checks: { status: "ok" | "warn" | "err"; name: string; detail: string; fix?: string }[] }>("doctor.run");
  const notion = useCall<NotionStatus>("notion.status");
  const notionOk = app.connections.find((c) => c.name === "notion")?.status === "connected";
  const skills = useCall<{ name: string; description: string; status: "ok" | "missing" | "no-source"; version?: string; provides: string[] }[]>("skills.list");
  const fix = (c: Connection) => {
    if (c.fix.url) void openUrl(c.fix.url);
    if (c.name !== "claude" && c.name !== "github") void openTerminal(`factory connect ${c.name}`);
  };
  return (
    <div class="pane-body">
      <main class="main">
        {alert && (
          <div class="p-alert" style={{ borderRadius: 8, border: "1px solid color-mix(in srgb,var(--danger) 35%,transparent)", marginBottom: 14 }}>
            <span class="dot err" style={{ marginTop: 4 }} />
            <div class="grow"><b>{alert.label} is {alert.status}{alert.lastOkAt ? ` (last worked ${ago(alert.lastOkAt)})` : ""}.</b> {alert.detail} Work that needs it waits and catches up from its last cursor once fixed.</div>
            <Btn kind="btn-primary" onClick={() => fix(alert)}><Ic n="wrench" s={14} />Fix {alert.label}</Btn>
            <Btn kind="btn-ghost" onClick={() => act("connections.snooze", { name: alert.name, hours: 1 }, ["connections"])}>Snooze 1h</Btn>
          </div>
        )}
        <div class="main-h"><h2>Connections</h2><span class="grow" /><span class="small dim">Checks Claude's connectors every 5 min, no model calls</span><Btn onClick={() => act("connections.test", {}, ["connections"])}><Ic n="heart-pulse" s={14} />Test all</Btn></div>
        <div class="list conn">
          <div class="cn-row cn-head"><span /><span>Connection</span><span>Used for</span><span>Status</span><span>Last worked</span><span /></div>
          {app.connections.map((c) => {
            const isOpen = open[c.name] ?? c.status !== "connected";
            const st = ST[c.status];
            return (
              <div key={c.name} class={`cn ${isOpen ? "open" : ""} ${c.status === "connected" ? "ok" : c.status}`}>
                <div class="cn-row" onClick={() => setOpen({ ...open, [c.name]: !isOpen })}>
                  <Brand n={c.name} s={28} />
                  <span><b>{c.label}</b><div class="xs faint">{c.required ? "Required" : "Optional"}</div></span>
                  <span class="small dim">{c.neededFor}</span>
                  <span><span class={st[2]}>{c.status === "missing" && !c.required ? "Not set up" : st[1]}</span></span>
                  <span class="small dim">{c.lastOkAt ? ago(c.lastOkAt) : "never"}</span>
                  <span class="cn-chev"><Ic n={isOpen ? "chevron-up" : "chevron-down"} s={16} /></span>
                </div>
                {isOpen && (
                  <div class="cn-body">
                    <div class="cn-meta"><span class="label">Through</span><span class="small">{c.via}{c.name !== "claude" && c.name !== "github" ? ". The factory holds no token; it uses Claude's access." : ""}</span></div>
                    {c.status === "connected" ? (
                      <div class="cn-meta"><span class="label">Last test</span><span class="small">{ago(c.checkedAt)}: {c.detail}</span></div>
                    ) : (
                      <div class="cn-meta">
                        <span class="label">{c.status === "missing" ? "To set it up" : "To fix it"}</span>
                        <div>
                          {c.detail && c.status !== "missing" && <div class="small err-line" style={{ marginBottom: 4 }}>{c.detail}</div>}
                          <ol class="fix-steps">{c.fix.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                        </div>
                      </div>
                    )}
                    <div class="row" style={{ gap: 6, marginTop: 4 }}>
                      {c.status !== "connected" && <Btn kind="btn-primary" onClick={() => fix(c)}><Ic n="wrench" s={14} />{c.status === "missing" ? "Set up" : "Fix"}</Btn>}
                      <Btn onClick={() => act("connections.test", { name: c.name }, ["connections"])}><Ic n="heart-pulse" s={14} />Test now</Btn>
                      {c.status !== "connected" && <Btn kind="btn-ghost" onClick={() => act("connections.snooze", { name: c.name, hours: 4 }, ["connections"])}>Snooze 4h</Btn>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div class="card">
            <div class="card-h">Setup checks <span class="faint small" style={{ fontWeight: 400 }}>factory doctor</span><span class="grow" />{doctor.data && <Btn onClick={doctor.reload}>Run again</Btn>}</div>
            <div class="card-b layers">
              {doctor.data ? doctor.data.checks.map((c) => <div key={c.name} title={c.fix ? `Fix: ${c.fix}` : undefined}><span class={`dot ${c.status === "warn" ? "needs" : c.status}`} />{c.name}<span class="grow" /><span class="faint xs">{c.detail}</span></div>) : <div class="small dim">{doctor.error ? "Running the checks…" : "Loading…"}</div>}
            </div>
          </div>
          <div class="card">
            <div class="card-h">Skills <span class="faint small" style={{ fontWeight: 400 }}>factory skills</span><span class="grow" />{skills.data?.some((x) => x.status === "missing") && <Btn kind="btn-primary" onClick={async () => (await act("skills.install", {}), skills.reload())}>Install missing</Btn>}</div>
            <div class="card-b layers">
              {(skills.data ?? []).map((k) => (
                <div key={k.name}><span class={`dot ${k.status === "ok" ? "ok" : k.status === "missing" ? "needs" : "off"}`} /><b style={{ fontWeight: 500 }}>{k.name}</b><span class="faint xs">{k.description}</span><span class="grow" /><span class={`xs ${k.status === "ok" ? "faint" : ""}`}>{k.status === "ok" ? k.version : k.status === "missing" ? "missing" : "no source"}</span></div>
              ))}
              <div class="xs faint" style={{ marginTop: 4 }}>Installed into the factory's own skills folder. Your ~/.claude/skills is never touched. Add a source with <code>factory skills add NAME URL</code>.</div>
            </div>
          </div>
        </div>
        <div class="grid2" style={{ marginTop: 16 }}>
          {notion.data ? <><FactoryBoard s={notion.data} connected={notionOk} reload={notion.reload} /><IntakeBoard s={notion.data} connected={notionOk} reload={notion.reload} /></> : <div class="small dim">{notion.error ?? "Loading…"}</div>}
        </div>
      </main>
    </div>
  );
}

interface NotionStatus {
  ready: boolean;
  pending: number;
  parentPageId?: string;
  intakeBoard?: string;
  intakeStatus: string;
}

const Step = ({ done, n, children }: { done: boolean; n: number; children: preact.ComponentChildren }) => (
  <div class="row" style={{ alignItems: "flex-start", gap: 8 }}><span class={`dot ${done ? "ok" : "off"}`} style={{ marginTop: 6 }} /><span><b style={{ fontWeight: 500 }}>{n}.</b> {children}</span></div>
);

function FactoryBoard({ s, connected, reload }: { s: NotionStatus; connected: boolean; reload: () => void }) {
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    if (await act("notion.setup", { page: page.trim() })) reload();
    setBusy(false);
  };
  return (
    <div class="card">
      <div class="card-h">Factory board <span class="faint small" style={{ fontWeight: 400 }}>where research and plans are reviewed</span><span class="grow" />{s.parentPageId && <a href="#" class="xs" onClick={(e) => (e.preventDefault(), openUrl(`https://www.notion.so/${s.parentPageId!.replace(/-/g, "")}`))}>Open</a>}</div>
      <div class="card-b layers">
        <Step n={1} done={connected}>Connect Notion in Claude {connected ? "" : <>(the Notion row above, or <code>factory connect notion</code>)</>}</Step>
        <Step n={2} done={s.ready}>In Notion, make an empty page you can edit, for example "Factory", and copy its link (⋯ menu, Copy link)</Step>
        <Step n={3} done={s.ready}>{s.ready ? "Jobs, Tickets and Reviews were created on it" : "Paste the link here. The factory creates three databases on it: Jobs, Tickets and Reviews"}</Step>
        {!s.ready && (
          <div class="row">
            <input class="in" placeholder="https://www.notion.so/…" value={page} onInput={(e) => setPage(e.currentTarget.value)} disabled={!connected} />
            <Btn kind="btn-primary" onClick={create} disabled={!connected || !page.trim() || busy}>{busy ? "Creating…" : "Create board"}</Btn>
          </div>
        )}
        {s.ready && <div><span class={`dot ${s.pending ? "needs" : "ok"}`} />{s.pending ? `${s.pending} changes waiting to sync` : "Everything synced"}</div>}
      </div>
    </div>
  );
}

function IntakeBoard({ s, connected, reload }: { s: NotionStatus; connected: boolean; reload: () => void }) {
  const [board, setBoard] = useState(s.intakeBoard ?? "");
  const [status, setStatus] = useState(s.intakeStatus);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const save = async () => {
    setBusy(true);
    const r = await act<{ added: number; skipped?: string; status: string }>("notion.intake", { board: board.trim(), status: status.trim() }, ["tasks", "intake", "routines"]);
    if (r) setResult(r.skipped ? `Saved. ${r.skipped}` : `Checked: ${r.added} card${r.added === 1 ? "" : "s"} in "${r.status}" queued.`);
    setBusy(false);
    reload();
  };
  return (
    <div class="card">
      <div class="card-h">Your Notion board <span class="faint small" style={{ fontWeight: 400 }}>a source of work, like Slack and Jira</span></div>
      <div class="card-b layers">
        <Step n={1} done={connected}>Connect Notion in Claude</Step>
        <Step n={2} done={!!s.intakeBoard}>Open your personal kanban board in Notion, add a "{status || "Ready for agent"}" option to its status column if it doesn't have one, and copy the board's link</Step>
        <Step n={3} done={!!s.intakeBoard}>Paste it here. Every 15 minutes in working hours, cards in that column go straight to the queue (you already chose them, so they skip triage); when the task finishes, the factory comments on the card</Step>
        <div class="row">
          <input class="in" placeholder="Board link" value={board} onInput={(e) => setBoard(e.currentTarget.value)} disabled={!connected} />
          <input class="in" style={{ width: 160 }} placeholder="Ready for agent" value={status} onInput={(e) => setStatus(e.currentTarget.value)} disabled={!connected} />
          <Btn kind="btn-primary" onClick={save} disabled={!connected || !board.trim() || busy}>{busy ? "Checking…" : s.intakeBoard ? "Save and check" : "Watch board"}</Btn>
        </div>
        {result && <div class="xs dim">{result}</div>}
      </div>
    </div>
  );
}
