/*
 * Rules and learning: the self-improving loop at three levels. Your repos (corrections become checks,
 * as harden tasks), triage (your overrides become rules you approve), and the factory itself (a weekly
 * improve-factory task from the retros). Every change goes through the same gates.
 */
import { go } from "../app";
import { Btn, StateChip } from "../kit";
import { act, useApp } from "../store";
import { CAP } from "../types";

export function Improve() {
  const app = useApp();
  const finished = app.tasks.filter((t) => t.machine.state === "Done");
  const reviewed = app.tasks.filter((t) => t.machine.approved.length > 0);
  const firstPass = finished.length ? Math.round((100 * finished.filter((t) => t.machine.tries.ResearchGate + t.machine.tries.PlanGate + t.machine.tries.PRGate === 0).length) / finished.length) : undefined;
  const perGate = reviewed.length ? reviewed.reduce((a, t) => a + t.machine.tries.ResearchGate + t.machine.tries.PlanGate + t.machine.tries.PRGate, 0) / reviewed.reduce((a, t) => a + t.machine.approved.length, 0) : undefined;
  const escal = app.tasks.length ? Math.round((100 * app.tasks.filter((t) => t.machine.tries.NeedsYou > 0 || t.machine.state === "NeedsYou").length) / app.tasks.filter((t) => t.column !== "Inbox").length || 0) : undefined;
  const proposed = app.rules.filter((r) => r.status === "proposed");
  const active = app.rules.filter((r) => r.status === "active");
  const harden = app.tasks.filter((t) => t.tags.includes("harden"));
  return (
    <div class="pane-body">
      <main class="main">
        <div class="main-h"><h2>Rules and learning</h2></div>
        <div class="grid3">
          {([["First-pass approval", firstPass !== undefined ? `${firstPass}%` : "–", `of ${finished.length} finished tasks, no send-backs`], ["Send-backs per gate", perGate !== undefined ? perGate.toFixed(1) : "–", `cap is ${CAP}`], ["Escalation rate", escal !== undefined ? `${escal}%` : "–", "tasks that reached Needs you"]] as const).map(([n, v, d]) => (
            <div key={n} class="card metric"><div class="xs dim">{n}</div><div class="v">{v}</div><div class="d faint">{d}</div></div>
          ))}
        </div>
        <div class="grid2" style={{ marginTop: 16 }}>
          <div class="card">
            <div class="card-h">Triage rules waiting for your OK</div>
            <div class="card-b">
              {proposed.length ? (
                <table class="tbl"><tr><th>Proposed rule</th><th>Does</th><th /></tr>
                  {proposed.map((r) => (
                    <tr key={r.id}><td class="small">{r.description}</td><td><span class="chip">{r.action}</span></td>
                      <td class="row" style={{ gap: 4 }}><Btn kind="btn-primary" onClick={() => act("rules.set", { id: r.id, status: "active" }, ["rules"])}>OK</Btn><Btn kind="btn-ghost" onClick={() => act("rules.set", { id: r.id, status: "rejected" }, ["rules"])}>No</Btn></td></tr>
                  ))}
                </table>
              ) : <div class="small dim">None yet. Change a triage verdict the same way three times and it's proposed here.</div>}
            </div>
          </div>
          <div class="card">
            <div class="card-h">Rules in use</div>
            <div class="card-b">
              {active.length ? (
                <table class="tbl"><tr><th>Rule</th><th>Hits</th><th /></tr>
                  {active.map((r) => <tr key={r.id}><td class="small">{r.description} → <b>{r.action}</b></td><td class="small dim">{r.hits}</td><td><Btn kind="btn-ghost" onClick={() => act("rules.set", { id: r.id, status: "rejected" }, ["rules"])}>Turn off</Btn></td></tr>)}
                </table>
              ) : <div class="small dim">No rules yet; triage uses Haiku for everything.</div>}
            </div>
          </div>
        </div>
        <div class="card" style={{ marginTop: 16 }}>
          <div class="card-h">Corrections that became checks</div>
          <div class="card-b">
            {harden.length ? (
              <table class="tbl"><tr><th>Harden task</th><th>State</th></tr>
                {harden.map((t) => <tr key={t.id} onClick={() => go(`task/${t.id}`)} style={{ cursor: "pointer" }}><td class="small">{t.title}</td><td><StateChip t={t} /></td></tr>)}
              </table>
            ) : <div class="small dim">After a send-back the coordinator asks whether a lint rule, type or test could have caught it, and queues a <span class="tag harden">harden</span> task if so. They show up here.</div>}
          </div>
        </div>
        <div class="card" style={{ marginTop: 16 }}>
          <div class="card-h">improve-factory · weekly<span class="grow" /><span class="tag sensitive">sensitive</span></div>
          <div class="card-b small">
            Each week Opus reads the task retros and the numbers above and proposes changes to the factory's own prompts and settings, as a task that goes through research, plan and PR ready like any other.
            <div class="xs faint" style={{ marginTop: 6 }}>Locked: caps, gates and the research rule live in the engine and the TLA+ model. A change to them must update the statechart, pass TLC, and still needs your approval.</div>
          </div>
        </div>
      </main>
    </div>
  );
}
