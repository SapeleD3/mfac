import { useState } from "preact/hooks";
import { inApp, pickFolder } from "../bridge";
import { Btn, Ic, Pips, TagChip } from "../kit";
import { act, useApp, useCall } from "../store";
import { CAP, type Repo, type Settings } from "../types";

const TAG_INFO: [string, string, string][] = [
  ["learn", "You ask to understand something", "Research writes an explainer; the statechart, model and TLC result are kept as artifacts"],
  ["urgent", "Incidents, “prod”, a manager asking", "Jumps the queue; sound on gates"],
  ["ui", "The change touches screens", "Adds the UI review with screenshots"],
  ["sensitive", "Auth, payments, data, security", "Always stops at every gate; never auto-approved"],
  ["harden", "A send-back a check could have caught", "Turns the correction into a lint rule, type or test"],
];
const ROLES: [string, string][] = [
  ["coordinator", "Coordinator (one per task)"],
  ["triage", "Triage"],
  ["researcher", "Research"],
  ["planner", "Plan"],
  ["requirements_review", "Plan vs requirements"],
  ["builder", "Build"],
  ["code_review", "Code review"],
  ["security_review", "Security review"],
  ["confirm", "Confirm"],
  ["reply", "Reply drafts"],
];

const EFFORT: [string, string][] = [
  ["", "Default"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
];

export function SettingsPage() {
  const app = useApp();
  const s = app.settings;
  if (!s)
    return (
      <div class="pane-body">
        <div class="empty">Loading…</div>
      </div>
    );
  const save = (patch: Partial<Settings>) => act("settings.set", patch, ["settings", "status"]);
  const mode = (id: Settings["ui"]["mode"], name: string, desc: string, art: preact.JSX.Element) => (
    <div class={`mode ${s.ui.mode === id ? "on" : ""}`} onClick={() => save({ ui: { ...s.ui, mode: id } })}>
      <div class="mode-art">{art}</div>
      <b>{name}</b>
      <div class="small dim">{desc}</div>
    </div>
  );
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h">
          <h2>Settings</h2>
        </div>
        <div class="label" style={{ marginBottom: 6 }}>
          How it runs
        </div>
        <div class="grid3">
          {mode(
            "widget",
            "Widget (default)",
            "Floating pill and menu bar icon; the full window opens from the panel.",
            <div style={{ position: "absolute", right: 8, top: 8, width: 70, height: 72, borderRadius: 6, background: "var(--bg-raised)", border: "1px solid var(--border-strong)" }} />,
          )}
          {mode(
            "app",
            "Full app",
            "The main window opens at login, plus the pill.",
            <div style={{ position: "absolute", inset: 8, borderRadius: 6, background: "var(--bg-raised)", border: "1px solid var(--border-strong)" }}>
              <div style={{ width: "30%", height: "100%", borderRight: "1px solid var(--border)" }} />
            </div>,
          )}
          {mode(
            "headless",
            "Headless",
            "No UI at login. The engine still runs; drive it with factory commands.",
            <div style={{ position: "absolute", inset: 8, borderRadius: 6, background: "#0c0d10", font: "10px var(--font-mono)", color: "var(--ok)", padding: 6 }}>$ factory ls</div>,
          )}
        </div>
        <div class="xs faint" style={{ marginTop: 6 }}>
          All three attach to the same running engine. Closing the UI leaves the factory working.
        </div>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div class="card">
            <div class="card-h">Running</div>
            <div class="card-b">
              <table class="tbl">
                <tr>
                  <td>Tasks at once</td>
                  <td style={{ textAlign: "right" }}>
                    <div class="seg">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} class={s.slots === n ? "on" : ""} onClick={() => save({ slots: n })}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Pause the queue at usage</td>
                  <td style={{ textAlign: "right" }}>
                    <div class="seg">
                      {[0.7, 0.85, 0.95].map((n) => (
                        <button key={n} class={Math.abs(s.usageCeiling - n) < 0.001 ? "on" : ""} onClick={() => save({ usageCeiling: n })}>
                          {Math.round(n * 100)}%
                        </button>
                      ))}
                    </div>{" "}
                    <span class="xs faint">of the 5-hour or weekly limit</span>
                  </td>
                </tr>
                <tr>
                  <td>Intake every</td>
                  <td style={{ textAlign: "right" }}>
                    <div class="seg">
                      {[15, 30, 60].map((n) => (
                        <button key={n} class={s.pollMinutes === n ? "on" : ""} onClick={() => save({ pollMinutes: n })}>
                          {n === 60 ? "1 hour" : `${n} min`}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Working hours</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      class="in xs"
                      type="number"
                      min={0}
                      max={23}
                      style={{ width: 52 }}
                      value={s.workingHours.start}
                      onChange={(e) => save({ workingHours: { ...s.workingHours, start: Number(e.currentTarget.value) } })}
                    />
                    –
                    <input
                      class="in xs"
                      type="number"
                      min={1}
                      max={24}
                      style={{ width: 52 }}
                      value={s.workingHours.end}
                      onChange={(e) => save({ workingHours: { ...s.workingHours, end: Number(e.currentTarget.value) } })}
                    />
                    <span class="small" style={{ marginLeft: 8, cursor: "pointer" }} onClick={() => save({ workingHours: { ...s.workingHours, weekends: !s.workingHours.weekends } })}>
                      <span class={`switch ${s.workingHours.weekends ? "on" : ""}`} /> weekends
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Sound on urgent and gates</td>
                  <td style={{ textAlign: "right", cursor: "pointer" }} onClick={() => save({ ui: { ...s.ui, sound: !s.ui.sound } })}>
                    <span class={`switch ${s.ui.sound ? "on" : ""}`} />
                  </td>
                </tr>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-h">Model and effort per stage</div>
            <div class="card-b">
              <table class="tbl">
                <tr>
                  <th>Stage</th>
                  <th style={{ textAlign: "right" }}>Model</th>
                  <th style={{ textAlign: "right" }}>Effort</th>
                </tr>
                {ROLES.map(([k, label]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td style={{ textAlign: "right" }}>
                      <select class="in xs" style={{ width: "auto" }} value={s.models[k]} onChange={(e) => save({ models: { ...s.models, [k]: e.currentTarget.value } })}>
                        {["opus", "sonnet", "haiku"].map((m) => (
                          <option key={m} value={m}>
                            {m[0]!.toUpperCase() + m.slice(1)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <select class="in xs" style={{ width: "auto" }} value={s.efforts[k] ?? ""} onChange={(e) => save({ efforts: { ...s.efforts, [k]: e.currentTarget.value } })}>
                        {EFFORT.map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} class="xs faint">
                    Claude Code on your subscription. Effort is passed as <code>--effort</code>; higher effort thinks longer and uses more of the plan. Default leaves it to the model.
                  </td>
                </tr>
              </table>
            </div>
          </div>
        </div>
        <div class="card" style={{ marginTop: 16 }}>
          <div class="card-h">
            Gates and caps <span class="lock">engine rules</span>
          </div>
          <div class="card-b">
            <table class="tbl">
              <tr>
                <td>Send-backs per gate</td>
                <td>
                  <Pips used={CAP} of={CAP} /> {CAP}
                </td>
                <td class="small dim">After the last, only approve or drop remain</td>
              </tr>
              <tr>
                <td>Research check retries (TLC)</td>
                <td>
                  <Pips used={CAP} of={CAP} /> {CAP}
                </td>
                <td class="small dim">Then Needs you</td>
              </tr>
              <tr>
                <td>Review findings to builder</td>
                <td>
                  <Pips used={CAP} of={CAP} /> {CAP}
                </td>
                <td class="small dim">Code + security compiled together</td>
              </tr>
              <tr>
                <td>Research rule</td>
                <td>always</td>
                <td class="small dim">Statechart + passing TLC before the research gate opens</td>
              </tr>
            </table>
          </div>
        </div>
        <div class="card" style={{ marginTop: 16 }}>
          <div class="card-h">Tags</div>
          <div class="card-b">
            <table class="tbl">
              <tr>
                <th>Tag</th>
                <th>Triage sets it when</th>
                <th>What changes</th>
              </tr>
              {TAG_INFO.map(([t, w, c]) => (
                <tr key={t}>
                  <td>
                    <TagChip t={t} />
                  </td>
                  <td class="small dim">{w}</td>
                  <td class="small">{c}</td>
                </tr>
              ))}
            </table>
            <div class="xs faint" style={{ marginTop: 6 }}>
              Add or remove tags any time from a task, or with <code>factory tag F-001 learn</code>.
            </div>
          </div>
        </div>
        <ReposCard />
      </main>
    </div>
  );
}

function AboutField({ saved, save }: { saved: string; save: (about: string) => Promise<void> }) {
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== saved;
  const commit = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    await save(text.trim());
    setBusy(false);
  };
  return (
    <div class="row" style={{ gap: 6 }}>
      <input
        class="in"
        placeholder="e.g. the billing API and checkout pages"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && void commit()}
        onBlur={() => void commit()}
      />
      {dirty ? (
        <Btn kind="btn-primary" onClick={commit} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Btn>
      ) : (
        saved && <span class="xs faint">Saved</span>
      )}
    </div>
  );
}

function ReposCard() {
  const repos = useCall<Repo[]>("repo.list");
  const [path, setPath] = useState("");
  const add = async (p: string) => {
    if (await act("repo.add", { path: p })) {
      setPath("");
      repos.reload();
    }
  };
  const update = async (name: string, patch: Partial<Repo>) => {
    if (await act("repo.update", { name, ...patch })) repos.reload();
  };
  const choose = async () => {
    const picked = await pickFolder("Add a repo");
    if (picked) await add(picked);
  };
  return (
    <div class="card" style={{ marginTop: 16 }}>
      <div class="card-h">
        Repos{" "}
        <span class="faint small" style={{ fontWeight: 400 }}>
          where work from Slack, Jira and your Notion board most likely lands
        </span>
      </div>
      <div class="card-b">
        <div class="small dim" style={{ marginBottom: 8 }}>
          Triage reads what each repo is for and puts incoming work in the one it most likely belongs to. When it can't tell, the work goes to the default repo. New tasks you add yourself start in the
          default too, or in any folder you pick.
        </div>
        <table class="tbl">
          <tr>
            <th>Default</th>
            <th>Repo</th>
            <th>What it's for</th>
            <th>Base</th>
            <th>Setup</th>
            <th />
          </tr>
          {(repos.data ?? []).map((r) => (
            <tr key={r.name}>
              <td>
                <input type="radio" name="default-repo" checked={r.isDefault} onChange={() => update(r.name, { isDefault: true })} />
              </td>
              <td>
                <b>{r.name}</b>
                <div class="xs faint">{r.path}</div>
              </td>
              <td style={{ width: "40%" }}>
                <AboutField saved={r.about} save={(about) => update(r.name, { about })} />
              </td>
              <td class="small">{r.base}</td>
              <td class="small">
                <code>{r.setup || "–"}</code>
              </td>
              <td>
                <Btn kind="btn-ghost" onClick={async () => (await act("repo.remove", { name: r.name })) && repos.reload()}>
                  <Ic n="x" s={14} />
                </Btn>
              </td>
            </tr>
          ))}
        </table>
        <div class="row" style={{ marginTop: 8 }}>
          {inApp && (
            <Btn kind="btn-primary" onClick={choose}>
              <Ic n="folder-plus" s={14} />
              Choose a folder…
            </Btn>
          )}
          <input class="in" placeholder="/Users/you/code/some-repo" value={path} onInput={(e) => setPath(e.currentTarget.value)} />
          <Btn onClick={() => add(path.trim())} disabled={!path.trim()}>
            Add repo
          </Btn>
        </div>
      </div>
    </div>
  );
}
