/*
 * Settings: how the factory shows itself, how much runs at once, which model does what, and what each
 * tag changes. Caps and gates are shown but locked: they're engine rules.
 */
import { useState } from "preact/hooks";
import { Btn, Pips, TagChip } from "../kit";
import { act, useApp, useCall } from "../store";
import { CAP, type Settings } from "../types";

const TAG_INFO: [string, string, string][] = [
  ["learn", "You ask to understand something", "Research writes an explainer; the statechart, model and TLC result are kept as artifacts"],
  ["urgent", "Incidents, “prod”, a manager asking", "Jumps the queue; sound on gates"],
  ["ui", "The change touches screens", "Adds the UI review with screenshots"],
  ["sensitive", "Auth, payments, data, security", "Always stops at every gate; never auto-approved"],
  ["harden", "A send-back a check could have caught", "Turns the correction into a lint rule, type or test"],
];
const ROLES: [string, string][] = [["coordinator", "Coordinator (one per task)"], ["triage", "Triage"], ["researcher", "Research"], ["planner", "Plan"], ["builder", "Build"], ["code_review", "Code review"], ["security_review", "Security review"], ["confirm", "Confirm"], ["reply", "Reply drafts"]];

export function SettingsPage() {
  const app = useApp();
  const s = app.settings;
  const repos = useCall<{ name: string; path: string; base: string; setup: string }[]>("repo.list");
  const [repoPath, setRepoPath] = useState("");
  if (!s) return <div class="pane-body"><div class="empty">Loading…</div></div>;
  const save = (patch: Partial<Settings>) => act("settings.set", patch, ["settings", "status"]);
  const mode = (id: Settings["ui"]["mode"], name: string, desc: string, art: preact.JSX.Element) => (
    <div class={`mode ${s.ui.mode === id ? "on" : ""}`} onClick={() => save({ ui: { ...s.ui, mode: id } })}>
      <div class="mode-art">{art}</div><b>{name}</b><div class="small dim">{desc}</div>
    </div>
  );
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h"><h2>Settings</h2></div>
        <div class="label" style={{ marginBottom: 6 }}>How it runs</div>
        <div class="grid3">
          {mode("widget", "Widget (default)", "Floating pill and menu bar icon; the full window opens from the panel.", <div style={{ position: "absolute", right: 8, top: 8, width: 70, height: 72, borderRadius: 6, background: "var(--bg-raised)", border: "1px solid var(--border-strong)" }} />)}
          {mode("app", "Full app", "The main window opens at login, plus the pill.", <div style={{ position: "absolute", inset: 8, borderRadius: 6, background: "var(--bg-raised)", border: "1px solid var(--border-strong)" }}><div style={{ width: "30%", height: "100%", borderRight: "1px solid var(--border)" }} /></div>)}
          {mode("headless", "Headless", "No UI at login. The engine still runs; drive it with factory commands.", <div style={{ position: "absolute", inset: 8, borderRadius: 6, background: "#0c0d10", font: "10px var(--font-mono)", color: "var(--ok)", padding: 6 }}>$ factory ls</div>)}
        </div>
        <div class="xs faint" style={{ marginTop: 6 }}>All three attach to the same running engine. Closing the UI leaves the factory working.</div>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div class="card"><div class="card-h">Running</div><div class="card-b"><table class="tbl">
            <tr><td>Tasks at once</td><td style={{ textAlign: "right" }}><div class="seg">{[1, 2, 3, 4, 5].map((n) => <button key={n} class={s.slots === n ? "on" : ""} onClick={() => save({ slots: n })}>{n}</button>)}</div></td></tr>
            <tr><td>Pause the queue at usage</td><td style={{ textAlign: "right" }}><div class="seg">{[0.7, 0.85, 0.95].map((n) => <button key={n} class={Math.abs(s.usageCeiling - n) < 0.001 ? "on" : ""} onClick={() => save({ usageCeiling: n })}>{Math.round(n * 100)}%</button>)}</div> <span class="xs faint">of the 5h window</span></td></tr>
            <tr><td>Intake every</td><td style={{ textAlign: "right" }}><div class="seg">{[5, 10, 15, 30].map((n) => <button key={n} class={s.pollMinutes === n ? "on" : ""} onClick={() => save({ pollMinutes: n })}>{n} min</button>)}</div></td></tr>
            <tr><td>Working hours</td><td style={{ textAlign: "right" }}>
              <input class="in xs" type="number" min={0} max={23} style={{ width: 52 }} value={s.workingHours.start} onChange={(e) => save({ workingHours: { ...s.workingHours, start: Number(e.currentTarget.value) } })} />–
              <input class="in xs" type="number" min={1} max={24} style={{ width: 52 }} value={s.workingHours.end} onChange={(e) => save({ workingHours: { ...s.workingHours, end: Number(e.currentTarget.value) } })} />
              <span class="small" style={{ marginLeft: 8, cursor: "pointer" }} onClick={() => save({ workingHours: { ...s.workingHours, weekends: !s.workingHours.weekends } })}><span class={`switch ${s.workingHours.weekends ? "on" : ""}`} /> weekends</span>
            </td></tr>
            <tr><td>Sound on urgent and gates</td><td style={{ textAlign: "right", cursor: "pointer" }} onClick={() => save({ ui: { ...s.ui, sound: !s.ui.sound } })}><span class={`switch ${s.ui.sound ? "on" : ""}`} /></td></tr>
          </table></div></div>
          <div class="card"><div class="card-h">Models per stage</div><div class="card-b"><table class="tbl">
            {ROLES.map(([k, label]) => (
              <tr key={k}><td>{label}</td><td style={{ textAlign: "right" }}>
                <select class="in xs" style={{ width: "auto" }} value={s.models[k]} onChange={(e) => save({ models: { ...s.models, [k]: e.currentTarget.value } })}>
                  {["opus", "sonnet", "haiku"].map((m) => <option key={m} value={m}>{m[0]!.toUpperCase() + m.slice(1)}</option>)}
                </select>
              </td></tr>
            ))}
            <tr><td colSpan={2} class="xs faint">Claude Code on your subscription. Other agents can come later behind the same adapter.</td></tr>
          </table></div></div>
        </div>
        <div class="card" style={{ marginTop: 16 }}><div class="card-h">Gates and caps <span class="lock">engine rules</span></div><div class="card-b"><table class="tbl">
          <tr><td>Send-backs per gate</td><td><Pips used={CAP} of={CAP} /> {CAP}</td><td class="small dim">After the last, only approve or drop remain</td></tr>
          <tr><td>Research check retries (TLC)</td><td><Pips used={CAP} of={CAP} /> {CAP}</td><td class="small dim">Then Needs you</td></tr>
          <tr><td>Review findings to builder</td><td><Pips used={CAP} of={CAP} /> {CAP}</td><td class="small dim">Code + security compiled together</td></tr>
          <tr><td>Research rule</td><td>always</td><td class="small dim">Statechart + passing TLC before the research gate opens</td></tr>
        </table></div></div>
        <div class="card" style={{ marginTop: 16 }}><div class="card-h">Tags</div><div class="card-b">
          <table class="tbl"><tr><th>Tag</th><th>Triage sets it when</th><th>What changes</th></tr>
            {TAG_INFO.map(([t, w, c]) => <tr key={t}><td><TagChip t={t} /></td><td class="small dim">{w}</td><td class="small">{c}</td></tr>)}
          </table>
          <div class="xs faint" style={{ marginTop: 6 }}>Add or remove tags any time from a task, or with <code>factory tag F-001 learn</code>.</div>
        </div></div>
        <div class="card" style={{ marginTop: 16 }}><div class="card-h">Repos</div><div class="card-b">
          <table class="tbl"><tr><th>Repo</th><th>Folder</th><th>Base</th><th>Setup</th></tr>
            {(repos.data ?? []).map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td class="small dim">{r.path}</td><td class="small">{r.base}</td><td class="small"><code>{r.setup || "–"}</code></td></tr>)}
          </table>
          <div class="row" style={{ marginTop: 8 }}>
            <input class="in" placeholder="/Users/you/code/some-repo" value={repoPath} onInput={(e) => setRepoPath(e.currentTarget.value)} />
            <Btn onClick={async () => { if (await act("repo.add", { path: repoPath.trim() })) { setRepoPath(""); repos.reload(); } }} disabled={!repoPath.trim()}>Add repo</Btn>
          </div>
        </div></div>
      </main>
    </div>
  );
}
