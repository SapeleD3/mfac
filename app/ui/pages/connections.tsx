import { useState } from "preact/hooks";
import { inApp, openTerminal, openUrl, pickFolder } from "../bridge";
import { Brand, Btn, Ic, ago } from "../kit";
import { act, toast, useApp, useCall } from "../store";
import type { Connection, ServerChoice } from "../types";

const KIND: Record<string, string> = { "claude.ai": "a connector in your Claude account", plugin: "an MCP server from a Claude Code plugin", local: "an MCP server you added to Claude Code" };

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
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const test = async (c: Connection) => {
    setTesting((x) => ({ ...x, [c.name]: true }));
    const r = await act<Connection & { server?: string }>("connections.verify", { name: c.name }, ["connections"]);
    setTesting((x) => ({ ...x, [c.name]: false }));
    setOpen((o) => ({ ...o, [c.name]: true }));
    if (r) toast(r.status === "connected" ? `${r.label} works${r.server ? ` through ${r.server}` : ""}.` : `${r.label} is ${r.status}: ${r.detail ?? ""}`, r.status === "connected" ? "info" : "error");
  };
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
            <div class="grow">
              <b>
                {alert.label} is {alert.status}
                {alert.lastOkAt ? ` (last worked ${ago(alert.lastOkAt)})` : ""}.
              </b>{" "}
              {alert.detail} Work that needs it waits and catches up from its last cursor once fixed.
            </div>
            <Btn kind="btn-primary" onClick={() => fix(alert)}>
              <Ic n="wrench" s={14} />
              Fix {alert.label}
            </Btn>
            <Btn kind="btn-ghost" onClick={() => act("connections.snooze", { name: alert.name, hours: 1 }, ["connections"])}>
              Snooze 1h
            </Btn>
          </div>
        )}
        <div class="main-h">
          <h2>Connections</h2>
          <span class="grow" />
          <span class="small dim">Checks Claude's connectors every 5 min, no model calls</span>
          <Btn onClick={() => act("connections.test", {}, ["connections"])}>
            <Ic n="heart-pulse" s={14} />
            Test all
          </Btn>
        </div>
        <div class="list conn">
          <div class="cn-row cn-head">
            <span />
            <span>Connection</span>
            <span>Used for</span>
            <span>Status</span>
            <span>Last worked</span>
            <span />
          </div>
          {app.connections.map((c) => {
            const isOpen = open[c.name] ?? (c.used && c.status !== "connected");
            const st = c.used ? ST[c.status] : (["dot off", "Not used", "chip"] as const);
            return (
              <div key={c.name} class={`cn ${isOpen ? "open" : ""} ${c.status === "connected" ? "ok" : c.status}`}>
                <div class="cn-row" onClick={() => setOpen({ ...open, [c.name]: !isOpen })}>
                  <Brand n={c.name} s={28} />
                  <span>
                    <b>{c.label}</b>
                    <div class="xs faint">{c.required ? "Required" : "Optional"}</div>
                  </span>
                  <span class="small dim">{c.neededFor}</span>
                  <span>
                    <span class={st[2]}>{c.status === "missing" && c.used ? "Not set up" : st[1]}</span>
                  </span>
                  <span class="small dim">{c.lastOkAt ? ago(c.lastOkAt) : "never"}</span>
                  <span class="cn-chev">
                    <Ic n={isOpen ? "chevron-up" : "chevron-down"} s={16} />
                  </span>
                </div>
                {isOpen && (
                  <div class="cn-body">
                    <div class="cn-meta">
                      <span class="label">Through</span>
                      <span class="small">
                        {c.through ? (
                          <>
                            <b>{c.through.name}</b> · {KIND[c.through.kind]}
                            {c.through.target ? <span class="faint"> · {c.through.target}</span> : null}
                            <div class="xs faint">Claude Code reports it as {c.through.state}. The factory holds no token; it uses Claude's access.</div>
                          </>
                        ) : (
                          <>
                            {c.via}
                            {c.name !== "claude" && c.name !== "github" ? ". The factory holds no token; it uses Claude's access." : ""}
                          </>
                        )}
                      </span>
                    </div>
                    {c.name !== "claude" && c.name !== "github" && (
                      <div class="cn-meta">
                        <span class="label">Use</span>
                        <ServerPick c={c} />
                      </div>
                    )}
                    {c.lastCall && (
                      <div class="cn-meta">
                        <span class="label">Last read</span>
                        <span class="small">
                          {c.lastCall.ok ? (
                            <>
                              Worked {ago(c.lastCall.at)} through {c.lastCall.server}
                            </>
                          ) : (
                            <>
                              <span class="err-line">
                                Failed {ago(c.lastCall.at)} through {c.lastCall.server}: {c.lastCall.error}
                              </span>
                              <div class="xs faint">{c.lastCall.lastOkAt ? `Last worked ${ago(c.lastCall.lastOkAt)}` : "Hasn't worked yet"}</div>
                            </>
                          )}
                        </span>
                      </div>
                    )}
                    {!!c.tools?.length && (
                      <div class="cn-meta">
                        <span class="label">Tools</span>
                        <span class="small">
                          <details>
                            <summary>{c.tools.length} tools the factory may use to read</summary>
                            <div class="xs faint" style={{ marginTop: 4 }}>
                              {c.tools.map((t) => t.split("__").slice(2).join("__") || t).join(", ")}
                            </div>
                          </details>
                        </span>
                      </div>
                    )}
                    {c.status === "connected" ? (
                      <div class="cn-meta">
                        <span class="label">Last test</span>
                        <span class="small">
                          {ago(c.checkedAt)}: {c.detail}
                        </span>
                      </div>
                    ) : (
                      <div class="cn-meta">
                        <span class="label">{c.status === "missing" ? "To set it up" : "To fix it"}</span>
                        <div>
                          {c.detail && c.status !== "missing" && (
                            <div class="small err-line" style={{ marginBottom: 4 }}>
                              {c.detail}
                            </div>
                          )}
                          <ol class="fix-steps">
                            {c.fix.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    )}
                    <div class="row" style={{ gap: 6, marginTop: 4 }}>
                      {(c.status !== "connected" || !c.used) && (
                        <Btn kind="btn-primary" onClick={() => fix(c)}>
                          <Ic n="wrench" s={14} />
                          {!c.used ? "Turn on" : c.status === "missing" ? "Set up" : "Fix"}
                        </Btn>
                      )}
                      <Btn onClick={() => test(c)} disabled={!!testing[c.name]}>
                        <Ic n="heart-pulse" s={14} />
                        {testing[c.name] ? "Testing…" : "Test now"}
                      </Btn>
                      {testing[c.name] && c.name !== "claude" && c.name !== "github" && <span class="xs dim">One small read through Claude; up to a minute.</span>}
                      {c.status !== "connected" && c.used && (
                        <Btn kind="btn-ghost" onClick={() => act("connections.snooze", { name: c.name, hours: 4 }, ["connections"])}>
                          Snooze 4h
                        </Btn>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div class="card">
            <div class="card-h">
              Setup checks{" "}
              <span class="faint small" style={{ fontWeight: 400 }}>
                factory doctor
              </span>
              <span class="grow" />
              {doctor.data && <Btn onClick={doctor.reload}>Run again</Btn>}
            </div>
            <div class="card-b layers">
              {doctor.data ? (
                doctor.data.checks.map((c) => (
                  <div key={c.name} title={c.fix ? `Fix: ${c.fix}` : undefined}>
                    <span class={`dot ${c.status === "warn" ? "needs" : c.status}`} />
                    {c.name}
                    <span class="grow" />
                    <span class="faint xs">{c.detail}</span>
                  </div>
                ))
              ) : (
                <div class="small dim">{doctor.error ? "Running the checks…" : "Loading…"}</div>
              )}
            </div>
          </div>
          <div class="card">
            <div class="card-h">
              Skills{" "}
              <span class="faint small" style={{ fontWeight: 400 }}>
                factory skills
              </span>
              <span class="grow" />
              {skills.data?.some((x) => x.status === "missing") && (
                <Btn kind="btn-primary" onClick={async () => (await act("skills.install", {}), skills.reload())}>
                  Install missing
                </Btn>
              )}
            </div>
            <div class="card-b layers">
              {(skills.data ?? []).map((k) => (
                <div key={k.name}>
                  <span class={`dot ${k.status === "ok" ? "ok" : k.status === "missing" ? "needs" : "off"}`} />
                  <b style={{ fontWeight: 500 }}>{k.name}</b>
                  <span class="faint xs">{k.description}</span>
                  <span class="grow" />
                  <span class={`xs ${k.status === "ok" ? "faint" : ""}`}>{k.status === "ok" ? k.version : k.status === "missing" ? "missing" : "no source"}</span>
                </div>
              ))}
              <div class="xs faint" style={{ marginTop: 4 }}>
                Installed into the factory's own skills folder. Your ~/.claude/skills is never touched. Add a source with <code>factory skills add NAME URL</code>.
              </div>
            </div>
          </div>
        </div>
        <div class="grid2 top" style={{ marginTop: 16 }}>
          {notion.data ? (
            <>
              <FactoryBoard s={notion.data} connected={notionOk} reload={notion.reload} />
              <IntakeBoard s={notion.data} connected={notionOk} reload={notion.reload} />
            </>
          ) : (
            <div class="small dim">{notion.error ?? "Loading…"}</div>
          )}
        </div>
      </main>
    </div>
  );
}

interface WatchedBoard {
  url: string;
  name?: string;
  server?: string;
  status: string;
  folder?: string;
}

const home = (p?: string) => p?.replace(/^\/Users\/[^/]+/, "~");

interface NotionStatus {
  ready: boolean;
  pending: number;
  parentPageId?: string;
  boards: WatchedBoard[];
}

const Step = ({ done, n, children }: { done: boolean; n: number; children: preact.ComponentChildren }) => (
  <div class="step">
    <span class={`dot ${done ? "ok" : "off"}`} />
    <span>
      <b>{n}.</b> {children}
    </span>
  </div>
);

const Field = ({ label, wide, children }: { label: string; wide?: boolean; children: preact.ComponentChildren }) => (
  <label class={`field ${wide ? "wide" : ""}`}>
    <span>{label}</span>
    {children}
  </label>
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
      <div class="card-h">
        Factory board{" "}
        <span class="faint small" style={{ fontWeight: 400 }}>
          where research and plans are reviewed
        </span>
        <span class="grow" />
        {s.parentPageId && (
          <a href="#" class="xs" onClick={(e) => (e.preventDefault(), openUrl(`https://www.notion.so/${s.parentPageId!.replace(/-/g, "")}`))}>
            Open
          </a>
        )}
      </div>
      <div class="card-b setup">
        <div class="steps">
          <Step n={1} done={connected}>
            Connect Notion in Claude{" "}
            {connected ? (
              ""
            ) : (
              <>
                (the Notion row above, or <code>factory connect notion</code>)
              </>
            )}
          </Step>
          <Step n={2} done={s.ready}>
            In Notion, make an empty page you can edit, for example "Factory"
          </Step>
          <Step n={3} done={s.ready}>
            {s.ready ? "Jobs, Tickets and Reviews were created on it" : "Give its name below. The factory creates three databases on it: Jobs, Tickets and Reviews"}
          </Step>
        </div>
        {s.ready ? (
          <div class="setup-sec">
            <div class="step">
              <span class={`dot ${s.pending ? "needs" : "ok"}`} />
              <span>{s.pending ? `${s.pending} changes waiting to sync` : "Everything synced"}</span>
            </div>
          </div>
        ) : (
          <div class="setup-sec">
            <div class="fields">
              <Field label="Page name" wide>
                <input class="in" placeholder="Factory" value={page} onInput={(e) => setPage(e.currentTarget.value)} disabled={!connected || busy} />
              </Field>
            </div>
            <div class="form-end">
              <span class="xs dim">{busy ? "Finding the page and creating the databases. This takes a minute or two." : ""}</span>
              <Btn kind="btn-primary" onClick={create} disabled={!connected || !page.trim() || busy}>
                {busy ? "Creating…" : "Create board"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const STALE_MS = 11 * 60_000;

function IntakeBoard({ s, connected, reload }: { s: NotionStatus; connected: boolean; reload: () => void }) {
  const app = useApp();
  const [board, setBoard] = useState("");
  const [status, setStatus] = useState("Ready for agent");
  const [server, setServer] = useState("");
  const [folder, setFolder] = useState("");
  const choices = useCall<ServerChoice[]>("connections.choices", { name: "notion" });
  const [saving, setSaving] = useState(false);
  const r = app.routines.find((x) => x.id === "intake-notion");
  const reading = r?.lastResult === "running" && !!r.lastRunAt && Date.now() - Date.parse(r.lastRunAt) < STALE_MS;
  const watched = s.boards ?? [];
  const save = async () => {
    setSaving(true);
    const ok = await act("notion.intake", { board: board.trim(), status: status.trim(), server: server || undefined, folder: folder.trim() || undefined }, ["routines"]);
    setSaving(false);
    if (ok) {
      setBoard("");
      setFolder("");
    }
    reload();
  };
  const choose = async (b?: WatchedBoard) => {
    const picked = await pickFolder(b ? `Where does the work on ${b.name ?? "this board"} live?` : "Where does this board's work live?");
    if (!picked) return;
    if (!b) return setFolder(picked);
    await act("notion.folder", { board: b.url, folder: picked });
    reload();
  };
  const unwatch = async (b: WatchedBoard) => {
    await act("notion.unwatch", { board: b.url }, ["routines"]);
    reload();
  };
  const note = saving ? (
    <span class="xs dim">Looking for the board in Notion…</span>
  ) : reading ? (
    <span class="xs dim">Reading your boards, started {ago(r!.lastRunAt!)}. You can leave this page.</span>
  ) : watched.length && r?.lastRunAt ? (
    <span class={`xs ${r.lastResult === "failed" || r.lastResult === "skipped" ? "err-line" : "dim"}`}>
      {r.lastResult === "failed" ? "The last check failed: " : r.lastResult === "skipped" ? "The last check didn't run: " : "Last check: "}
      {r.lastDetail} · {ago(r.lastRunAt)}
    </span>
  ) : (
    <span />
  );
  const workspace = (name?: string) => {
    const c = choices.data?.find((x) => x.name === name);
    return name ? `${name}${c?.workspace ? ` · ${c.workspace}` : ""}` : "the Notion connection's server";
  };
  return (
    <div class="card">
      <div class="card-h">
        Your Notion boards{" "}
        <span class="faint small" style={{ fontWeight: 400 }}>
          sources of work, like Slack and Jira
        </span>
      </div>
      <div class="card-b setup">
        <div class="steps">
          <Step n={1} done={connected}>
            Connect Notion in Claude
          </Step>
          <Step n={2} done={watched.length > 0}>
            In each personal kanban board, add a "{status || "Ready for agent"}" option to its status column if it doesn't have one
          </Step>
          <Step n={3} done={watched.length > 0}>
            Add each board below. Every 15 minutes, cards in its ready column go straight to the queue (you already chose them, so they skip triage), and each card then moves with its task
          </Step>
        </div>
        {watched.length > 0 && (
          <div class="setup-sec">
            <div class="label">Watching</div>
            {watched.map((b) => (
              <div key={b.url} class="watch">
                <span class="dot ok" />
                <span class="watch-text">
                  <b title={b.name ?? b.url}>{b.name ?? b.url}</b>
                  <span class="xs dim" title={workspace(b.server)}>
                    "{b.status}" column · {workspace(b.server)}
                  </span>
                  <span class={`xs ${b.folder ? "dim" : "warn-text"}`} title={b.folder}>
                    {b.folder ? `Work lives in ${home(b.folder)}` : "No folder: cards use the repo they name, else your default repo"}
                  </span>
                </span>
                <span class="watch-acts">
                  {inApp && (
                    <Btn kind="btn-ghost" onClick={() => choose(b)}>
                      {b.folder ? "Change folder" : "Set folder"}
                    </Btn>
                  )}
                  <Btn kind="btn-ghost" onClick={() => unwatch(b)}>
                    Stop watching
                  </Btn>
                </span>
              </div>
            ))}
          </div>
        )}
        <div class="setup-sec">
          <div class="label">{watched.length ? "Add another board" : "Add a board"}</div>
          <div class="fields">
            <Field label="Board name, as it shows in Notion">
              <input class="in" placeholder="Side Projects Board" value={board} onInput={(e) => setBoard(e.currentTarget.value)} disabled={!connected || saving} />
            </Field>
            <Field label="Ready column">
              <input class="in" placeholder="Ready for agent" value={status} onInput={(e) => setStatus(e.currentTarget.value)} disabled={!connected || saving} />
            </Field>
            <Field label="Its work lives in (one repo, or a folder of repos the card names)" wide>
              <span class="row">
                <input class="in" placeholder="~/code/side-projects" value={folder} onInput={(e) => setFolder(e.currentTarget.value)} disabled={!connected || saving} />
                {inApp && (
                  <Btn onClick={() => choose()} disabled={!connected || saving}>
                    Choose…
                  </Btn>
                )}
              </span>
            </Field>
            {(choices.data?.length ?? 0) > 1 && (
              <Field label="It's in this Notion" wide>
                <select class="in" value={server} onChange={(e) => setServer(e.currentTarget.value)} disabled={!connected || saving}>
                  <option value="">the same Notion as the factory board</option>
                  {choices.data!.map((x) => (
                    <option key={x.name} value={x.name}>
                      {choiceLabel(x)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div class="form-end">
            {note}
            <Btn kind="btn-primary" onClick={save} disabled={!connected || !board.trim() || saving}>
              {saving ? "Adding…" : "Watch board"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const choiceLabel = (x: ServerChoice) => `${x.name}${x.workspace ? ` · ${x.workspace}` : ""}${x.status === "needs-auth" ? " (needs sign-in)" : x.status === "failed" ? " (not working)" : ""}`;

function ServerPick({ c }: { c: Connection }) {
  const choices = useCall<ServerChoice[]>("connections.choices", { name: c.name }, [c.name]);
  const [checking, setChecking] = useState<string>();
  const list = choices.data ?? [];
  const pinned = list.find((x) => x.pinned)?.name ?? "";
  const pick = async (server: string) => {
    const r = await act<Connection>("connections.connect", { name: c.name, server: server || undefined }, ["connections"]);
    choices.reload();
    if (r) toast(r.status === "connected" ? `${c.label}: ${r.detail ?? "connected"}` : `${c.label} is ${r.status}: ${r.detail ?? ""}`, r.status === "connected" ? "info" : "error");
  };
  const check = async (server: string) => {
    setChecking(server);
    const r = await act<ServerChoice & { who: string }>("connections.check", { name: c.name, server });
    setChecking(undefined);
    choices.reload();
    if (r) toast(`${server}: ${r.who}${r.workspace ? ` in ${r.workspace}` : ""}`, "info");
  };
  return (
    <div class="small">
      {c.workspace && (
        <div>
          Signed in to <b>{c.workspace}</b>
        </div>
      )}
      <div class="row" style={{ gap: 6 }}>
        <select class="in xs" style={{ width: "auto" }} value={pinned} onChange={(e) => void pick(e.currentTarget.value)} disabled={!list.length}>
          <option value="">Automatic: Claude's own connector first</option>
          {list.map((x) => (
            <option key={x.name} value={x.name}>
              {choiceLabel(x)}
            </option>
          ))}
        </select>
        {list
          .filter((x) => !x.workspace && x.status === "connected")
          .slice(0, 3)
          .map((x) => (
            <Btn key={x.name} kind="btn-ghost" onClick={() => check(x.name)} disabled={!!checking}>
              {checking === x.name ? "Checking…" : `Which workspace is ${x.name}?`}
            </Btn>
          ))}
      </div>
      <div class="xs faint">A server you pick is the only one used, so work never lands in another workspace by accident.</div>
    </div>
  );
}
