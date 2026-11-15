import type { Row, Store } from "../workflow/store.js";
import type { Digest } from "./digest.js";

export type Node = `${"task" | "file" | "area" | "pr" | "ticket" | "thread" | "repo"}:${string}`;

const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

export function link(store: Store, src: Node, rel: string, dst: Node) {
  store.db.prepare("INSERT OR IGNORE INTO edges (src, rel, dst) VALUES (?, ?, ?)").run(src, rel, dst);
}

/** What a finished task touched, as edges: the files and area it changed, its PR, tickets, thread, repo and the task it continued. */
export function linkDigest(store: Store, d: Digest, sourceRef?: string) {
  const t: Node = `task:${d.taskId}`;
  store.db.prepare("DELETE FROM edges WHERE src = ?").run(t);
  for (const f of d.files) link(store, t, "touched", `file:${f}`);
  if (d.area) link(store, t, "in", `area:${d.area}`);
  if (d.repo) link(store, t, "in_repo", `repo:${d.repo}`);
  if (d.prUrl) link(store, t, "opened", `pr:${d.prUrl}`);
  if (d.sourceUrl) link(store, t, "from", `thread:${d.sourceUrl}`);
  if (d.parent) link(store, t, "continues", `task:${d.parent}`);
  const keys = new Set([...(d.ask.match(JIRA_KEY) ?? []), ...(sourceRef ? [sourceRef.split("@")[0]!].filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)) : [])]);
  for (const k of keys) link(store, t, "for", `ticket:${k}`);
}

export const nodesOf = (store: Store, task: string): Node[] => (store.db.prepare("SELECT dst FROM edges WHERE src = ?").all(`task:${task}`) as Row[]).map((r) => String(r.dst) as Node);

export const tasksAt = (store: Store, node: Node): string[] => (store.db.prepare("SELECT src FROM edges WHERE dst = ? AND src LIKE 'task:%'").all(node) as Row[]).map((r) => String(r.src).slice(5));

const WEIGHT: Record<string, number> = { task: 1, ticket: 0.9, pr: 0.9, thread: 0.8, file: 0.6, area: 0.35, repo: 0 };

/**
 * Tasks one shared node away from the seeds, scored by how specific the shared node is: a ticket or a
 * rarely touched file counts for a lot, an area half the repo lives in for little.
 */
export function neighbours(store: Store, seeds: Node[], exclude: string[] = []): Map<string, { score: number; via: Node }> {
  const out = new Map<string, { score: number; via: Node }>();
  for (const node of new Set(seeds)) {
    const kind = node.split(":")[0]!;
    const w = WEIGHT[kind] ?? 0.3;
    if (!w) continue;
    const at = kind === "task" ? [node.slice(5), ...tasksAt(store, node)] : tasksAt(store, node);
    const spread = 1 / Math.log2(2 + at.length);
    for (const id of at) {
      if (exclude.includes(id)) continue;
      const prev = out.get(id);
      const score = (prev?.score ?? 0) + w * spread;
      out.set(id, { score, via: !prev || w * spread > (WEIGHT[prev.via.split(":")[0]!] ?? 0) * spread ? node : prev.via });
    }
  }
  return out;
}
