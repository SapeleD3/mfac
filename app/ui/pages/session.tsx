import { useEffect, useRef, useState } from "preact/hooks";
import { ansiToHtml } from "../ansi";
import { call, openInVSCode, openTerminal } from "../bridge";
import { Btn, Ic, clock } from "../kit";
import { act, useApp, useCall } from "../store";
import type { Stage } from "../types";

const ROLE: Record<string, string> = {
  coordinator: "Coordinator",
  researcher: "Researcher",
  planner: "Planner",
  builder: "Builder",
  code_review: "Code review",
  security_review: "Security review",
  ui_review: "UI review",
  confirm: "Confirm",
};

export function Session({ id, stage }: { id: string; stage?: string }) {
  const app = useApp();
  const t = app.tasks.find((x) => x.id === id);
  const stages = useCall<Stage[]>("stage.list", { task: id }, [id]).data ?? [];
  const pick = stage ?? [...stages].reverse().find((s) => s.status === "running" && s.role !== "coordinator")?.id ?? [...stages].reverse().find((s) => s.status === "running")?.id ?? stages.at(-1)?.id;
  const cur = stages.find((s) => s.id === pick);
  const [screen, setScreen] = useState("");
  const [live, setLive] = useState(false);
  const [text, setText] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const taken = !!t?.takenOver;

  useEffect(() => {
    if (!pick) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await call<{ live: boolean; screen: string }>("session.capture", { stage: pick, lines: 2000, escapes: true });
        if (stop) return;
        const atBottom = !pre.current || pre.current.scrollHeight - pre.current.scrollTop - pre.current.clientHeight < 40;
        setScreen(r.screen);
        setLive(r.live);
        if (atBottom) requestAnimationFrame(() => pre.current && (pre.current.scrollTop = pre.current.scrollHeight));
        if (r.live) setTimeout(poll, taken ? 400 : 1000);
      } catch {
        if (!stop) setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => void (stop = true);
  }, [pick, taken]);

  const send = async () => {
    if (!text.trim() || !pick) return;
    const r = await act("session.send", { stage: pick, text });
    if (r) setText("");
  };

  return (
    <div class="pane-body session-body" style={{ display: "flex" }}>
      <div class="live" style={{ flex: 1, minHeight: 0 }}>
        <aside class="live-side">
          <a class="ls back" href={`#task/${id}`} title="Esc">
            <Ic n="arrow-left" s={14} />
            <span>
              Back to {id}
              {t?.title ? <div class="xs dim ellip">{t.title}</div> : null}
            </span>
          </a>
          <div class="label" style={{ padding: "4px 8px" }}>
            Sessions in {id}
          </div>
          {stages.map((s) => (
            <a key={s.id} class={`ls ${s.id === pick ? "on" : ""}`} href={`#session/${id}?stage=${s.id}`}>
              <span class={`dot ${s.status === "running" ? "working" : s.status === "failed" ? "err" : "ok"}`} />
              <span>
                <b>{ROLE[s.role] ?? s.role}</b>{" "}
                <span class="faint xs">
                  {s.model}
                  {s.round > 1 ? ` · r${s.round}` : ""}
                </span>
                <div class="xs dim">{s.status === "running" ? `live since ${clock(s.startedAt)}` : `${s.status} ${clock(s.endedAt)}`}</div>
              </span>
            </a>
          ))}
          {stages.length === 0 && (
            <div class="xs faint" style={{ padding: "10px 8px" }}>
              No sessions yet. They start when the task leaves the queue.
            </div>
          )}
          <div class="xs faint" style={{ padding: "10px 8px" }}>
            Finished sessions show their saved screen. Live ones stream.
          </div>
        </aside>
        <section class="live-main">
          <div class="live-bar">
            <Ic n="square-terminal" s={15} />
            <b>{cur ? (ROLE[cur.role] ?? cur.role) : "No session"}</b>
            <span class="faint small">
              {cur ? `tmux factory-${cur.id}` : ""}
              {t?.worktree ? ` · ${t.worktree}` : ""}
            </span>
            <span class="grow" />
            {!live ? (
              <span class="chip">Ended · saved screen</span>
            ) : taken ? (
              <span class="chip warn">
                <Ic n="keyboard" s={12} /> You're typing · coordinator waits
              </span>
            ) : (
              <span class="chip work">
                <Ic n="eye" s={12} /> Watching · read only
              </span>
            )}
          </div>
          <pre class="tui" ref={pre} dangerouslySetInnerHTML={{ __html: ansiToHtml(screen) || '<span class="d">Nothing on screen yet.</span>' }} />
          {taken && live && (
            <div class="tui-input">
              <span class="faint" style={{ fontFamily: "var(--font-mono)" }}>
                &gt;
              </span>
              <input
                class="in"
                placeholder="Type into the session, Enter to send"
                value={text}
                onInput={(e) => setText(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                autoFocus
              />
            </div>
          )}
          <div class="live-acts">
            {t &&
              (taken ? (
                <Btn kind="btn-primary" onClick={() => act("session.takeover", { task: id, on: false }, ["tasks"])}>
                  <Ic n="log-out" s={14} />
                  Hand back to the factory
                </Btn>
              ) : (
                <Btn kind="btn-primary" disabled={!live} onClick={() => act("session.takeover", { task: id, on: true }, ["tasks"])}>
                  <Ic n="keyboard" s={14} />
                  Take over
                </Btn>
              ))}
            {cur && (
              <Btn onClick={() => openTerminal(`factory attach ${cur.id}`)}>
                <Ic n="square-terminal" s={14} />
                Open in Terminal
              </Btn>
            )}
            {t?.worktree && (
              <Btn onClick={() => openInVSCode(t.worktree!)}>
                <Ic n="code" s={14} />
                Open worktree in VS Code
              </Btn>
            )}
            {t?.column === "Running" && (
              <Btn kind="btn-ghost" onClick={() => act("task.interrupt", { id, note: "paused from the live session" }, ["tasks"])}>
                <Ic n="pause" s={14} />
                Stop this task
              </Btn>
            )}
            <span class="grow" />
            <span class="xs faint">{t ? `${Math.round(t.tokens / 1000)}k tokens` : ""}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
