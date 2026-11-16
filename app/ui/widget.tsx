import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { openInVSCode, openTerminal, openUrl, setWidgetOpen, showMain } from "./bridge";
import { Avatar, Btn, Ic, IconBtn, LOGO, MiniRail, Pips, RECIPE, StateDot, Tags, doing, position, taskSource, until } from "./kit";
import { act, useApp, useCall } from "./store";
import type { Prompt, Stage, Task } from "./types";

const notionUrl = (id?: string) => (id ? `https://www.notion.so/${id.replace(/-/g, "")}` : undefined);

export function Widget() {
  const app = useApp();
  const [open, setOpen] = useState(() => localStorage.getItem("factory.widget.open") !== "0");
  useEffect(() => {
    document.body.classList.add("widget");
    void setWidgetOpen(open);
    localStorage.setItem("factory.widget.open", open ? "1" : "0");
  }, [open]);

  const prompts = app.prompts;
  const askOf = (t: Task) => prompts.find((p) => p.taskId === t.id);
  const gates = app.tasks.filter((t) => t.column === "Needs you" || t.column === "PR ready");
  const running = app.tasks.filter((t) => t.column === "Running");
  const queued = app.tasks.filter((t) => t.column === "Queued");
  const needCount = gates.length + prompts.length;
  const alert = app.alerts[0];
  const st = app.status;

  const red = { borderColor: "var(--danger)" };
  let pill: { cls?: string; style?: Record<string, string>; body: ComponentChildren };
  if (!app.up && app.loaded)
    pill = {
      style: red,
      body: (
        <>
          <span class="dot err" />
          Engine not answering
        </>
      ),
    };
  else if (alert)
    pill = {
      style: red,
      body: (
        <>
          <span class="dot err" />
          {alert.label} {alert.status === "missing" ? "not set up" : alert.status}
          {needCount ? ` · ${needCount} need you` : ""}
        </>
      ),
    };
  else if (needCount)
    pill = {
      cls: "amber",
      body: (
        <>
          <span class="dot needs" />
          <b>
            {needCount} need{needCount === 1 ? "s" : ""} you
          </b>
          <span class="faint">· {running.length} running</span>
          <Pips used={st?.busy ?? running.length} of={st?.slots ?? 3} />
        </>
      ),
    };
  else if (st?.paused || st?.guard.blocked)
    pill = {
      cls: "amber",
      body: (
        <>
          <span class="dot needs" />
          {st.paused ? "Paused by you" : `Queue paused: ${st.guard.reason ?? "usage ceiling"}`}
        </>
      ),
    };
  else if (running.length)
    pill = {
      body: (
        <>
          <span class="dot working" />
          {running.length} running · nothing needs you
        </>
      ),
    };
  else
    pill = {
      body: (
        <>
          <span class="dot ok" />
          Idle{queued.length ? ` · ${queued.length} queued` : ""}
        </>
      ),
    };

  return (
    <>
      <span class={`p-pill ${pill.cls ?? ""}`} style={pill.style} onClick={() => setOpen(!open)}>
        {LOGO}
        {pill.body}
        <span class="chev">
          <Ic n={open ? "chevron-up" : "chevron-down"} s={14} />
        </span>
      </span>
      {open && (
        <div class="panel">
          <div class="p-head" data-tauri-drag-region>
            {LOGO}
            <b>Factory</b>
            <span class="p-slots">
              <Pips used={st?.busy ?? 0} of={st?.slots ?? 3} /> {st?.busy ?? 0} of {st?.slots ?? 3} slots
            </span>
            <span class="grow" />
            <IconBtn n="plus" title="New task" onClick={() => showMain("queue?new=1")} />
            <IconBtn
              n={st?.paused ? "play" : "pause"}
              title={st?.paused ? "Resume the queue" : "Pause the queue (running work carries on)"}
              onClick={() => act("factory.pause", { paused: !st?.paused }, ["status"])}
            />
            <IconBtn n="maximize-2" s={14} title="Open full app" onClick={() => showMain("queue")} />
            <IconBtn n="minus" title="Collapse" onClick={() => setOpen(false)} />
          </div>
          {alert && (
            <div class="p-alert">
              <span class="dot err" style={{ marginTop: 4 }} />
              <div class="grow">
                <b>{alert.status === "missing" ? `${alert.label} isn't set up.` : `${alert.label} is ${alert.status}.`}</b>{" "}
                <span class="dim">
                  {alert.status === "missing" ? "Work that needs it waits until it is." : `${alert.detail ?? ""}${alert.detail?.endsWith(".") ? "" : "."} Work that needs it waits; nothing is lost.`}
                </span>
              </div>
              <Btn kind="btn-primary" onClick={() => showMain("connections")}>
                <Ic n="wrench" s={14} />
                Fix
              </Btn>
            </div>
          )}
          {!app.up && app.loaded && (
            <div class="p-alert">
              <span class="dot err" style={{ marginTop: 4 }} />
              <div class="grow">
                <b>The engine isn't answering.</b> <span class="dim">The app is restarting it. Tasks pick up where they were.</span>
              </div>
            </div>
          )}
          <div class="p-sec">Needs you {needCount > 0 && <span class="chip warn">{needCount}</span>}</div>
          <div class="p-list">
            {gates.map((t) => (
              <GateRow key={t.id} t={t} />
            ))}
            {gates.length === 0 && prompts.filter((p) => !running.some((t) => t.id === p.taskId)).length === 0 && <div class="empty">Nothing needs you.</div>}
            {prompts
              .filter((p) => !running.some((t) => t.id === p.taskId))
              .map((p) => (
                <AskRow key={p.id} p={p} />
              ))}
          </div>
          <div class="p-sec">Running</div>
          <div class="p-list">
            {running.map((t) => (
              <RunRow key={t.id} t={t} ask={askOf(t)} />
            ))}
            {running.length === 0 && <div class="empty">Nothing running.</div>}
          </div>
          {queued.length > 0 && (
            <>
              <div class="p-sec">
                Up next{" "}
                <span class="faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  · {queued.length} queued
                </span>
              </div>
              {queued.slice(0, 3).map((t) => (
                <div key={t.id} class="p-row" style={{ opacity: 0.75 }} onClick={() => showMain(`task/${t.id}`)}>
                  <Avatar t={t} />
                  <div>
                    <div class="p-title">{t.title}</div>
                    <div class="p-meta">
                      {taskSource(t)}
                      <Tags ts={t.tags} />
                    </div>
                  </div>
                  <span class="dot off" />
                </div>
              ))}
            </>
          )}
          <Foot />
        </div>
      )}
    </>
  );
}

function Foot() {
  const app = useApp();
  const intake = app.routines.find((r) => r.id === "intake-slack");
  const g = app.status?.guard;
  return (
    <div class="p-foot">
      <span class={`dot ${app.up ? "ok" : "err"}`} />
      Engine {app.up ? "up" : "down"}
      {intake?.enabled && intake.nextRunAt ? ` · next intake in ${until(intake.nextRunAt)}` : ""}
      <span class="grow" />
      {g?.share !== undefined ? `${Math.round(g.share * 100)}% of 5h usage` : ""}
    </div>
  );
}

function GateRow({ t }: { t: Task }) {
  const s = t.machine.state;
  const isPR = s === "PRGate";
  const tries = s === "NeedsYou" ? t.machine.tries.NeedsYou : s === "PlanGate" || s === "PRGate" ? t.machine.tries[s] : 0;
  const notion = notionUrl(t.notionReviewId);
  return (
    <div class="p-row ask" onClick={() => showMain(`task/${t.id}`)}>
      <Avatar t={t} />
      <div style={{ minWidth: 0 }}>
        <div class="p-title">{t.title}</div>
        <div class="p-doing">{doing(t)}</div>
        <div class="p-meta">
          <MiniRail t={t} />
          <Tags ts={t.tags} />
          {tries > 0 && (
            <span class="p-step">
              send-backs <Pips used={tries} />
            </span>
          )}
        </div>
      </div>
      <div>
        <StateDot t={t} />
      </div>
      <div class="p-detail" onClick={(e) => e.stopPropagation()}>
        <div class="p-acts">
          {s !== "NeedsYou" && (
            <Btn kind="btn-primary" onClick={() => act("task.decide", { id: t.id, verdict: "approve" }, ["tasks"])}>
              <Ic n="check" s={14} />
              {isPR ? "Approve and open PR" : "Approve"}
            </Btn>
          )}
          <Btn onClick={() => showMain(s === "NeedsYou" ? `needs/${t.id}` : `gate/${t.id}`)}>
            <Ic n="repeat" s={14} />
            {s === "NeedsYou" ? "Decide…" : "Send back…"}
          </Btn>
          <Btn kind="btn-ghost" onClick={() => act("task.decide", { id: t.id, verdict: "drop" }, ["tasks"])}>
            Drop
          </Btn>
          {isPR && t.worktree && (
            <Btn kind="btn-ghost" onClick={() => openInVSCode(t.worktree!)}>
              <Ic n="code" s={14} />
              Open diff in VS Code
            </Btn>
          )}
          {!isPR && notion && (
            <Btn kind="btn-ghost" onClick={() => openUrl(notion)}>
              <Ic n="external-link" s={14} />
              Open in Notion
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

export function AskBody({ p }: { p: Prompt }) {
  if (p.kind === "permission") {
    const input = p.payload.input as { command?: string; file_path?: string } | undefined;
    const cmd = input?.command ?? input?.file_path ?? JSON.stringify(p.payload.input ?? {}).slice(0, 300);
    return (
      <div class="p-detail" onClick={(e) => e.stopPropagation()}>
        <span class="p-kind">Permission</span>{" "}
        <span class="faint xs">
          {p.payload.tool} · {p.payload.role}
        </span>
        <div class="p-cmd">{cmd}</div>
        <div class="p-acts">
          <Btn kind="btn-primary" onClick={() => act("prompt.answer", { id: p.id, allow: true }, ["prompts"])}>
            <Ic n="check" s={14} />
            Allow
          </Btn>
          <Btn onClick={() => act("prompt.answer", { id: p.id, allow: false }, ["prompts"])}>
            <Ic n="x" s={14} />
            Deny
          </Btn>
          {p.taskId && (
            <Btn kind="btn-ghost" onClick={() => openTerminal(`factory attach ${p.taskId}`)}>
              In terminal
            </Btn>
          )}
        </div>
      </div>
    );
  }
  if (p.payload.menu)
    return (
      <div class="p-detail" onClick={(e) => e.stopPropagation()}>
        <span class="p-kind">Waiting in its terminal</span>
        <pre class="p-cmd" style={{ whiteSpace: "pre-wrap" }}>
          {p.payload.question}
        </pre>
        <div class="p-acts">
          {p.taskId && (
            <Btn kind="btn-primary" onClick={() => showMain(`session/${p.taskId}`)}>
              Open the live session
            </Btn>
          )}
        </div>
      </div>
    );
  return <QuestionBody p={p} />;
}

function QuestionBody({ p }: { p: Prompt }) {
  const qs = p.payload.questions ?? [{ question: p.payload.question ?? "", options: p.payload.options ?? [] }];
  const [picks, setPicks] = useState<number[]>(qs.map(() => 1));
  const [note, setNote] = useState("");
  const set = (i: number, n: number) => setPicks(picks.map((x, j) => (j === i ? n : x)));
  return (
    <div class="p-detail" onClick={(e) => e.stopPropagation()}>
      <span class="p-kind">{qs.length > 1 ? `${qs.length} questions` : "Question"}</span>
      {qs.map((q, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div class="small" style={{ marginBottom: 4 }}>
            {q.header && <span class="faint xs">{q.header} · </span>}
            <b>{q.question}</b>
          </div>
          {q.options.map((o, k) => {
            const [label, ...why] = o.split(": ");
            return (
              <div key={k} class={`p-opt ${picks[i] === k + 1 ? "on" : ""}`} onClick={() => set(i, k + 1)} style={{ cursor: "pointer" }}>
                <span class="rad" />
                <span>
                  {label}
                  {why.length > 0 && <span class="faint xs"> {why.join(": ")}</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <textarea class="in" rows={2} placeholder="Anything to add, or your own answer" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      <div class="p-acts">
        <Btn kind="btn-primary" onClick={() => act("prompt.answer", { id: p.id, options: picks, message: note }, ["prompts"])}>
          Send
        </Btn>
      </div>
    </div>
  );
}

function AskRow({ p }: { p: Prompt }) {
  return (
    <div class="p-row ask">
      <span class="avatar" style={{ background: "var(--needs-you)" }}>
        ?
      </span>
      <div style={{ minWidth: 0 }}>
        <div class="p-title">{p.payload.title ?? p.taskId ?? "A session"}</div>
        <div class="p-doing">{p.kind === "permission" ? "Asking permission" : "Asking a question"}</div>
      </div>
      <span class="dot needs" />
      <AskBody p={p} />
    </div>
  );
}

function RunRow({ t, ask }: { t: Task; ask?: Prompt }) {
  const [open, setOpen] = useState(false);
  const { at } = position(t.machine, t.ended);
  return (
    <div class={`p-row ${ask ? "ask" : ""} ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
      <Avatar t={t} />
      <div style={{ minWidth: 0 }}>
        <div class="p-title">{t.title}</div>
        <div class="p-doing">{ask ? (ask.kind === "permission" ? "Asking permission" : "Asking a question") : doing(t)}</div>
        <div class="p-meta">
          <MiniRail t={t} />
          <span class="p-step">
            {at + 1}/{RECIPE.length}
          </span>
          <Tags ts={t.tags} />
        </div>
      </div>
      <div class="row" style={{ gap: 2 }}>
        <StateDot t={t} asking={!!ask} />
        <IconBtn n="arrow-up-right" s={14} title="Open in app" onClick={() => showMain(`task/${t.id}`)} />
      </div>
      {ask ? <AskBody p={ask} /> : open && <RunDetail t={t} />}
    </div>
  );
}

function RunDetail({ t }: { t: Task }) {
  const { at } = position(t.machine, t.ended);
  const stages = useCall<Stage[]>("stage.list", { task: t.id }, [t.id]).data ?? [];
  const live = [...stages].reverse().find((s) => s.status === "running" && s.role !== "coordinator") ?? [...stages].reverse().find((s) => s.status === "running");
  const screen = useCall<{ screen: string }>(live ? "session.capture" : undefined, { stage: live?.id, lines: 8 }, [live?.id]).data?.screen ?? "";
  const loops = t.machine.loops;
  return (
    <div class="p-detail" onClick={(e) => e.stopPropagation()}>
      <ul class="p-checks">
        {RECIPE.slice(1).map((r, i0) => {
          const i = i0 + 1;
          const cls = i < at ? "done" : i === at ? "now" : "gate" in r && r.gate ? "gate" : "";
          const extra =
            r.id === "check" && loops.check ? (
              <>
                {" "}
                <Pips used={loops.check} />
              </>
            ) : r.id === "review" && loops.review ? (
              <>
                {" "}
                loop <Pips used={loops.review} />
              </>
            ) : null;
          return (
            <li key={r.id} class={cls}>
              <span class="ck">
                <Ic n={i < at ? "check" : i === at ? "circle-dot" : "gate" in r && r.gate ? "diamond" : "circle"} s={13} />
              </span>
              {r.name}
              {"gate" in r && r.gate ? " (you)" : ""}
              {extra}
            </li>
          );
        })}
      </ul>
      {screen.trim() && <div class="p-term">{screen.trimEnd().split("\n").slice(-6).join("\n")}</div>}
      <div class="p-acts">
        <Btn onClick={() => showMain(`session/${t.id}`)}>
          <Ic n="monitor-play" s={14} />
          Watch session
        </Btn>
        {t.worktree && (
          <Btn kind="btn-ghost" onClick={() => openInVSCode(t.worktree!)}>
            Open worktree in VS Code
          </Btn>
        )}
      </div>
    </div>
  );
}
