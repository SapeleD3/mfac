import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doctor } from "./doctor.js";
import type { TaskView } from "../workflow/engine.js";
import type { PluginFactory } from "../daemon/host.js";
import { shared } from "../integrations/integrations.js";
import { paths } from "../shared/paths.js";
import { install as installSkills, status as skillStatus } from "../skills/skills.js";
import { type Row, now, parseJson } from "../workflow/store.js";
import { guard } from "../claude/usage.js";

export interface Retro {
  taskId: string;
  title: string;
  outcome: "Done" | "Dropped";
  minutes: number;
  tokens: number;
  sendBacks: { research: number; plan: number; pr: number };
  loops: { check: number; review: number; confirm: number };
  refusals: number;
  needsYou: number;
  tags: string[];
  notes: string[];
  sessions: Record<string, number>;
}

export function retroOf(t: TaskView, events: { kind: string; to?: string; actor: string; data: Record<string, unknown> }[], sessions: { role: string }[]): Retro {
  const notes = events.filter((e) => e.actor === "human" && typeof e.data.note === "string" && e.data.note).map((e) => String(e.data.note));
  const byRole: Record<string, number> = {};
  for (const s of sessions) byRole[s.role] = (byRole[s.role] ?? 0) + 1;
  return {
    taskId: t.id,
    title: t.title,
    outcome: t.machine.state === "Done" ? "Done" : "Dropped",
    minutes: Math.round((Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / 60000),
    tokens: t.tokens,
    sendBacks: { research: t.machine.tries.ResearchGate, plan: t.machine.tries.PlanGate, pr: t.machine.tries.PRGate },
    loops: { ...t.machine.loops },
    refusals: events.filter((e) => e.kind === "refused").length,
    needsYou: events.filter((e) => e.to === "NeedsYou").length,
    tags: t.tags,
    notes,
    sessions: byRole,
  };
}

export function retroMarkdown(r: Retro): string {
  return `# Retro: ${r.taskId} · ${r.title}

- Outcome: **${r.outcome}** after ${r.minutes} min, ${r.tokens.toLocaleString()} tokens
- Send-backs: research ${r.sendBacks.research}, plan ${r.sendBacks.plan}, PR ${r.sendBacks.pr}
- Loops: research check ${r.loops.check}, review to builder ${r.loops.review}, confirm ${r.loops.confirm}
- Engine refusals: ${r.refusals} · times in Needs you: ${r.needsYou}
- Sessions: ${Object.entries(r.sessions).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}
- Tags: ${r.tags.join(", ") || "none"}

## Your notes at the gates

${r.notes.length ? r.notes.map((n) => `- ${n}`).join("\n") : "- none"}
`;
}

export const factoryRepo = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const upkeepPart: PluginFactory = ({ engine, store }) => {
  const writeRetro = (t: TaskView) => {
    if (store.db.prepare("SELECT 1 FROM retros WHERE task_id = ?").get(t.id)) return;
    const stages = store.db.prepare("SELECT role FROM stages WHERE task_id = ?").all(t.id) as { role: string }[];
    const r = retroOf(t, engine.events(t.id), stages);
    store.db.prepare("INSERT OR REPLACE INTO retros (task_id, at, data) VALUES (?, ?, ?)").run(t.id, now(), JSON.stringify(r));
    mkdirSync(paths.job(t.id), { recursive: true });
    writeFileSync(join(paths.job(t.id), "retro.md"), retroMarkdown(r));
  };
  const onChange = (c: { kind: string; task?: TaskView }) => {
    if (c.kind === "task" && c.task && (c.task.machine.state === "Done" || c.task.machine.state === "Dropped")) writeRetro(c.task);
  };
  const savedSkills = () => store.setting<Record<string, string>>("skills", {});

  const improve = async (): Promise<string> => {
    const last = store.setting<string>("improve_factory_at", "1970-01-01T00:00:00.000Z");
    const rows = store.db.prepare("SELECT data FROM retros WHERE at > ? ORDER BY at").all(last) as Row[];
    if (rows.length < 3) return `skip: ${rows.length} retro${rows.length === 1 ? "" : "s"} since the last one (needs 3)`;
    const retros = rows.map((r) => parseJson<Retro>(r.data, {} as Retro));
    const n = retros.length;
    const sum = (f: (r: Retro) => number) => retros.reduce((a, r) => a + f(r), 0);
    const firstPass = retros.filter((r) => r.outcome === "Done" && r.sendBacks.research + r.sendBacks.plan + r.sendBacks.pr === 0).length;
    const body = `Read the retros below and the factory's prompts (prompts/), roles and settings. Propose at most three changes that would have avoided the send-backs and escalations. Caps, gates and the research rule are locked: changing them means updating spec/Factory.tla, passing TLC, and still getting approval.

Numbers for ${n} tasks: first-pass approval ${Math.round((100 * firstPass) / n)}%, send-backs ${sum((r) => r.sendBacks.research + r.sendBacks.plan + r.sendBacks.pr)}, review loops ${sum((r) => r.loops.review)}, Needs you ${sum((r) => r.needsYou)}, engine refusals ${sum((r) => r.refusals)}.

${retros.map(retroMarkdown).join("\n---\n\n")}`;
    const t = engine.add({ title: `Improve the factory: week of ${now().slice(0, 10)}`, body, repo: existsSync(join(factoryRepo(), "spec", "Factory.tla")) ? factoryRepo() : undefined, tags: ["sensitive"], source: "factory" });
    store.setSetting("improve_factory_at", now());
    return `${t.id} queued from ${n} retros`;
  };

  return {
    name: "upkeep",
    start: () => {
      engine.on("change", onChange);
      const routines = shared.routines;
      if (!routines) return;
      routines.register({ id: "usage-guard", name: "Usage guard", description: "Reads Claude Code's own usage logs; pauses new work above the ceiling", everySeconds: 120, run: async () => guard(engine, store) });
      routines.register({ id: "improve-factory", name: "improve-factory", description: "Weekly: Opus reads the retros and proposes changes to the factory itself, as a sensitive task", everySeconds: 7 * 86_400, run: improve });
      routines.register({
        id: "doctor",
        name: "Setup checks",
        description: "factory doctor once a day: tools, Claude login, engine, skills",
        everySeconds: 86_400,
        run: async () => {
          const checks = await doctor({ engineUp: true, connections: shared.connections?.list(), savedSkills: savedSkills() });
          const bad = checks.filter((c) => c.status !== "ok");
          return bad.length ? `${bad.map((c) => `${c.name}: ${c.detail}`).join("; ")}` : "all checks pass";
        },
      });
    },
    stop: () => void engine.off("change", onChange),
    api: {
      "doctor.run": async () => ({ checks: await doctor({ engineUp: true, connections: shared.connections?.list(), savedSkills: savedSkills() }) }),
      "skills.list": () => skillStatus(savedSkills()),
      "skills.add": async (p: { name: string; source: string }) => {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(p.name ?? "")) throw new Error("a skill name is lowercase letters, digits and dashes");
        store.setSetting("skills", { ...savedSkills(), [p.name]: p.source });
        return installSkills(savedSkills(), { only: p.name });
      },
      "skills.install": (p: { update?: boolean }) => installSkills(savedSkills(), { update: !!p.update }),
      "usage.get": () => store.setting("usage_guard", {}),
      "usage.limits": (p: { window5h?: number; weekly?: number }) => {
        store.setSetting("usage_limits", { window5h: p.window5h || undefined, weekly: p.weekly || undefined });
        return guard(engine, store);
      },
      "retro.list": (p: { limit?: number }) => (store.db.prepare("SELECT data FROM retros ORDER BY at DESC LIMIT ?").all(p.limit ?? 50) as Row[]).map((r) => parseJson<Retro>(r.data, {} as Retro)),
      "improve.run": () => improve(),
    },
  };
};
