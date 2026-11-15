import { useState } from "preact/hooks";
import { go } from "../app";
import { openUrl } from "../bridge";
import { Btn, Ic, Src, Tags, ago } from "../kit";
import { act, useApp } from "../store";
import type { IntakeItem } from "../types";

const V: Record<string, string> = { urgent: "chip err", task: "chip work", backlog: "chip", reply: "chip warn", ignore: "chip" };

export function Inbox() {
  const app = useApp();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const items = app.intake.filter((i) => filter === "all" || ["Inbox", "Triage", "ReplyDrafted"].includes(i.status));
  const slack = app.routines.find((r) => r.id === "intake-slack");
  const jira = app.routines.find((r) => r.id === "intake-jira");
  const poll = async () => {
    await act("intake.poll", { source: "slack" }, ["intake", "tasks"]);
    if (app.connections.find((c) => c.name === "jira")?.status === "connected") await act("intake.poll", { source: "jira" }, ["intake", "tasks"]);
    if (app.settings?.notion?.intakeBoard) await act("intake.poll", { source: "notion" }, ["intake", "tasks"]);
  };
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h">
          <h2>Inbox and triage</h2>
          <span class="grow" />
          <span class="small dim">
            {slack?.lastRunAt ? `Slack ${ago(slack.lastRunAt)}: ${slack.lastDetail ?? slack.lastResult}` : "Slack intake hasn't run yet"}
            {jira?.lastRunAt ? ` · Jira ${ago(jira.lastRunAt)}` : ""}
          </span>
          <div class="seg">
            <button class={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>
              Open
            </button>
            <button class={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
              All
            </button>
          </div>
          <Btn onClick={poll}>
            <Ic n="refresh-cw" s={14} />
            Run intake now
          </Btn>
        </div>
        <div class="list">
          {items.map((i) => (
            <Item key={i.id} i={i} />
          ))}
          {items.length === 0 && (
            <div class="empty">
              {filter === "open"
                ? "Nothing waiting. New Slack messages to you, Jira tickets assigned to you and cards you move to Ready for agent on your Notion board land here."
                : "Nothing taken in yet."}
            </div>
          )}
        </div>
        <p class="note" style={{ marginTop: 12 }}>
          <b>Overrides teach triage.</b> Changing a verdict here is logged; the same correction three times becomes a rule you approve on Rules and learning. It never posts as you without a click.
        </p>
      </main>
    </div>
  );
}

function Item({ i }: { i: IntakeItem }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(i.draft ?? "");
  const from = [i.author, i.channel].filter(Boolean).join(" in ");
  return (
    <div class="li" style={{ gridTemplateColumns: "1fr auto", alignItems: "start", cursor: "default" }}>
      <div>
        <div class="li-s" style={{ margin: "0 0 3px" }}>
          <Src s={i.source} label={from || i.source} />
          <span class="faint">{ago(i.receivedAt)}</span>
          {i.url && (
            <a href="#" onClick={(e) => (e.preventDefault(), openUrl(i.url!))} class="faint">
              <Ic n="external-link" s={12} />
            </a>
          )}
        </div>
        <div style={{ whiteSpace: "pre-wrap" }}>{i.text.length > 600 ? `${i.text.slice(0, 600)}…` : i.text}</div>
        <div class="xs faint" style={{ marginTop: 3 }}>
          {i.reason ?? (i.triage ? "" : "Waiting for triage")}
          {i.overridden ? " · changed by you" : ""}
          {i.taskId && (
            <>
              {" "}
              · became{" "}
              <a href={`#task/${i.taskId}`}>
                <b>{i.taskId}</b>
              </a>
            </>
          )}
          {i.tags.length > 0 && (
            <>
              {" "}
              · <Tags ts={i.tags} />
            </>
          )}
        </div>
        {i.meta.relatedTask && i.meta.relatedTask !== i.taskId && (
          <div class="row" style={{ marginTop: 6, gap: 6 }}>
            <span class="xs dim">
              Looks like more for{" "}
              <a href={`#task/${i.meta.relatedTask}`}>
                <b>{i.meta.relatedTask}</b>
              </a>
              {i.taskId ? `, not a new task (${i.taskId})` : ""}.
            </span>
            <Btn kind="btn-ghost" onClick={() => act("intake.attach", { id: i.id, task: i.meta.relatedTask }, ["intake", "tasks"])}>
              Add it to {i.meta.relatedTask}
            </Btn>
          </div>
        )}
        {i.status === "ReplyDrafted" && (
          <div class="coord" style={{ marginTop: 6 }}>
            <div class="label" style={{ marginBottom: 4 }}>
              Draft reply
            </div>
            {editing ? <textarea class="in" rows={4} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} /> : <div style={{ whiteSpace: "pre-wrap" }}>{draft}</div>}
            <div class="row" style={{ marginTop: 6 }}>
              <Btn kind="btn-primary" onClick={() => act("intake.send", { id: i.id, text: draft }, ["intake"])}>
                <Ic n="message-square" s={14} />
                Send to thread
              </Btn>
              <Btn onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</Btn>
              <Btn kind="btn-ghost" onClick={() => act("intake.override", { id: i.id, action: "task" }, ["intake", "tasks"])}>
                Make it a task
              </Btn>
            </div>
          </div>
        )}
      </div>
      <div class="col" style={{ alignItems: "flex-end" }}>
        {i.triage ? <span class={V[i.triage]}>{i.triage}</span> : <span class="chip">new</span>}
        {!i.taskId && i.status !== "Replied" && (
          <select
            class="in xs"
            style={{ width: "auto", padding: "2px 4px" }}
            value=""
            onChange={(e) => e.currentTarget.value && act("intake.override", { id: i.id, action: e.currentTarget.value }, ["intake", "tasks", "rules"])}
          >
            <option value="">Change…</option>
            {["ignore", "reply", "backlog", "task", "urgent"]
              .filter((x) => x !== i.triage)
              .map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
          </select>
        )}
        {i.taskId && (
          <Btn kind="btn-ghost" onClick={() => go(`task/${i.taskId}`)}>
            Open
          </Btn>
        )}
      </div>
    </div>
  );
}
