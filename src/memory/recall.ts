import { ancestors, linksIn } from "../workflow/links.js";
import type { Store, Task } from "../workflow/store.js";
import { type Digest, digest, digestLine, digestText, digests } from "./digest.js";
import { embedder } from "./embed.js";
import { type Node, neighbours, nodesOf } from "./graph.js";
import { meetingLine, relatedMeetings } from "./meetings.js";
import { guessArea } from "./projects.js";
import { ensureVectors, nearest } from "./vectors.js";

export { rank, words } from "./rank.js";
import { rank } from "./rank.js";

const queryOf = (t: Pick<Task, "title" | "body">) => `${t.title}\n${t.title}\n${t.body.slice(0, 1500)}`;

/** Vector and keyword scores for each digest, each scaled to 0..1. */
async function similarity(store: Store, query: string, pool: Digest[]): Promise<{ vec: Map<string, number>; kw: Map<string, number>; embedded: boolean }> {
  const kwRanked = rank(
    query,
    pool.map((d) => ({ item: d.taskId, text: digestText(d) })),
  );
  const top = kwRanked[0]?.score ?? 0;
  const kw = new Map(kwRanked.map((r) => [r.item, top ? r.score / top : 0]));
  const vec = new Map<string, number>();
  const e = await embedder();
  if (!e || !pool.length) return { vec, kw, embedded: false };
  await ensureVectors(
    store,
    e,
    pool.map((d) => ({ kind: "digest", ref: d.taskId, text: digestText(d) })),
  );
  const [q] = await e.embed([query]);
  for (const r of nearest(
    store,
    e.model,
    q!,
    "digest",
    pool.map((d) => d.taskId),
  ))
    vec.set(r.ref, Math.max(0, Math.min(1, (r.score - 0.3) / 0.45)));
  return { vec, kw, embedded: true };
}

export interface Related {
  taskId: string;
  why: string;
  score: number;
}

const viaWhy = (via: Node, from: string[]) => {
  const [kind, ...rest] = via.split(":");
  const what = rest.join(":");
  if (kind === "file") return `changed ${what}, which this task's ask or lineage also touches`;
  if (kind === "area") return `worked in ${what}`;
  if (kind === "ticket") return `was for ${what} too`;
  if (kind === "pr" || kind === "thread") return `shares a link with ${from.join(", ") || "this task"}`;
  return `close to ${what}`;
};

/**
 * Past tasks in the same repo ranked by graph neighbourhood (lineage, links, shared files, tickets
 * and areas), embedding similarity and keywords together.
 */
export async function related(store: Store, task: Task, limit = 6): Promise<Related[]> {
  const pool = digests(store, task.repo).filter((d) => d.taskId !== task.id);
  const picks = new Map<string, Related>();
  const direct = (id: string, why: string) => {
    if (id !== task.id && !picks.has(id)) picks.set(id, { taskId: id, why, score: 10 - picks.size * 0.01 });
  };
  const lineage = ancestors(store, task);
  for (const a of lineage) direct(a.id, a.id === task.parent ? "this task continues it" : "earlier in the same line of work");
  const linked = linksIn(store, `${task.title}\n${task.body}`, [task.id]).filter((l) => {
    const t = store.task(l.taskId);
    return t && (!task.repo || !t.repo || t.repo === task.repo);
  });
  for (const l of linked) direct(l.taskId, l.why);

  const known = [...new Set(pool.map((d) => d.area).filter((a): a is string => !!a))];
  const seeds: Node[] = [...picks.keys()].flatMap((id) => [`task:${id}` as Node, ...nodesOf(store, id)]);
  const area = guessArea(`${task.title}\n${task.body}`, known);
  if (area) seeds.push(`area:${area}`);
  for (const f of new Set(task.body.match(/[\w@.-]+(?:\/[\w@.-]+)+\.\w+/g) ?? [])) seeds.push(`file:${f}`);
  const graph = neighbours(store, seeds, [task.id]);
  const gTop = Math.max(0, ...[...graph.values()].map((g) => g.score));
  const sim = await similarity(store, queryOf(task), pool);
  const inPool = new Set(pool.map((d) => d.taskId));
  const ids = new Set([...graph.keys(), ...sim.vec.keys(), ...sim.kw.keys()].filter((id) => inPool.has(id) && !picks.has(id)));
  const w = sim.embedded ? { vec: 0.45, graph: 0.35, kw: 0.2 } : { vec: 0, graph: 0.55, kw: 0.45 };
  const scored = [...ids]
    .map((id) => {
      const g = graph.get(id);
      const gs = g && gTop ? g.score / gTop : 0;
      const vs = sim.vec.get(id) ?? 0;
      const ks = sim.kw.get(id) ?? 0;
      const score = w.vec * vs + w.graph * gs + w.kw * ks;
      const why = g && w.graph * gs >= Math.max(w.vec * vs, w.kw * ks) ? viaWhy(g.via, [...picks.keys()]) : "a similar ask in this repo";
      return { taskId: id, why, score };
    })
    .filter((p) => p.score >= 0.3)
    .sort((a, b) => b.score - a.score);
  return [...picks.values(), ...scored].slice(0, limit);
}

const IN_FLIGHT = ["Researching", "ResearchCheck", "ResearchGate", "Planning", "RequirementsReview", "PlanGate", "Building", "Reviewing", "Confirming", "PRGate", "NeedsYou"];

export interface Recall {
  markdown: string;
  picks: { taskId: string; why: string }[];
}

export const DEFAULT_BUDGET_TOKENS = 600;

/**
 * history.md for a starting task: one line per related past task and pointers to pull more, inside
 * a fixed token budget (four characters a token), so earlier work costs the same few hundred tokens
 * whether the repo has ten finished tasks or ten thousand.
 */
export async function recall(store: Store, task: Task, budgetTokens = store.setting("memory_budget_tokens", DEFAULT_BUDGET_TOKENS)): Promise<Recall> {
  const picks = await related(store, task);
  const flying = task.repo ? store.tasks({ states: IN_FLIGHT as Task["machine"]["state"][] }).filter((t) => t.repo === task.repo && t.id !== task.id) : [];
  const talks = await relatedMeetings(store, task);
  if (!picks.length && !flying.length && !talks.length) return { markdown: "", picks: [] };
  const budget = budgetTokens * 4;
  const out = [
    "# Earlier work in this repo",
    "",
    'Related finished work, one line each. Pull more only when a line matters: `factory memory show <id>` (about 300 tokens), `factory memory search "<words>"`, `factory memory file <path>`.',
    "",
  ];
  let used = out.join("\n").length;
  const shown: Recall["picks"] = [];
  for (const p of picks) {
    const d = digest(store, p.taskId);
    const t = d ? undefined : store.task(p.taskId);
    const line = d ? digestLine(d, p.why) : `- ${p.taskId} ${t?.title ?? ""} (${t?.machine.state ?? "unknown"}, not finished). Why: ${p.why}.`;
    if (used + line.length + 1 > budget) break;
    out.push(line);
    used += line.length + 1;
    shown.push({ taskId: p.taskId, why: p.why });
  }
  const head = "\n## Also in progress in this repo\n";
  if (flying.length && used + head.length < budget) {
    out.push(head);
    used += head.length;
    for (const t of flying) {
      const line = `- ${t.id} [${t.machine.state}] ${t.title}${t.branch ? ` (branch ${t.branch})` : ""}`;
      if (used + line.length + 1 > budget) break;
      out.push(line);
      used += line.length + 1;
    }
  }
  const said =
    '\n## Meetings that may matter\n\nFrom Notion meeting summaries. For what was actually said, `factory memory meeting <id> "<what to look for>"` returns only the matching transcript lines.\n';
  if (talks.length && used + said.length < budget) {
    out.push(said);
    used += said.length;
    for (const m of talks) {
      const line = meetingLine(m);
      if (used + line.length + 1 > budget) break;
      out.push(line);
      used += line.length + 1;
    }
  }
  return { markdown: `${out.join("\n")}\n`, picks: shown };
}

/** `factory memory search`: past work for some words, across one repo or all. */
export async function search(store: Store, query: string, repo?: string, limit = 8): Promise<string[]> {
  const pool = digests(store, repo);
  const sim = await similarity(store, query, pool);
  const w = sim.embedded ? { vec: 0.7, kw: 0.3 } : { vec: 0, kw: 1 };
  return pool
    .map((d) => ({ d, score: w.vec * (sim.vec.get(d.taskId) ?? 0) + w.kw * (sim.kw.get(d.taskId) ?? 0) }))
    .filter((r) => r.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => digestLine(r.d, `match ${r.score.toFixed(2)}`));
}

export interface Candidate {
  taskId: string;
  score: number;
  finished: boolean;
}

/**
 * Which existing task a new message most likely belongs to, by embedding (keywords when there is no
 * embedder). sure means close enough to act on without asking a model; otherwise the top few go to
 * triage as the only tasks it is shown.
 */
export async function matchTask(store: Store, text: string, opts: { exclude?: string[] } = {}): Promise<{ candidates: Candidate[]; sure?: Candidate }> {
  const open = store.tasks().filter((t) => !opts.exclude?.includes(t.id) && !["Ignored", "Replied"].includes(t.machine.state));
  const half = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const done = digests(store).filter((d) => d.finishedAt > half && !opts.exclude?.includes(d.taskId));
  const docs = [
    ...open.map((t) => ({ id: t.id, text: `${t.title}\n${t.title}\n${t.body.slice(0, 1500)}`, finished: false })),
    ...done.map((d) => ({ id: d.taskId, text: digestText(d), finished: true })),
  ];
  if (!docs.length) return { candidates: [] };
  const e = await embedder();
  let ranked: Candidate[];
  if (e) {
    await ensureVectors(
      store,
      e,
      docs.map((d) => ({ kind: d.finished ? "digest" : "task", ref: d.id, text: d.text })),
    );
    const [q] = await e.embed([text.slice(0, 2000)]);
    const fin = new Set(done.map((d) => d.taskId));
    ranked = [
      ...nearest(
        store,
        e.model,
        q!,
        "task",
        open.map((t) => t.id),
      ),
      ...nearest(store, e.model, q!, "digest", [...fin]),
    ]
      .map((r) => ({ taskId: r.ref, score: r.score, finished: fin.has(r.ref) }))
      .sort((a, b) => b.score - a.score);
    const [a, b] = ranked;
    const candidates = ranked.filter((r) => r.score >= 0.55).slice(0, 3);
    return { candidates, sure: a && a.score >= 0.82 && (!b || a.score - b.score >= 0.05) ? a : undefined };
  }
  const kw = rank(
    text,
    docs.map((d) => ({ item: d, text: d.text })),
  );
  ranked = kw.map((r) => ({ taskId: r.item.id, score: r.score, finished: r.item.finished }));
  return { candidates: ranked.filter((r) => r.score >= 3).slice(0, 3) };
}
