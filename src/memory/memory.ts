import type { PluginFactory } from "../daemon/host.js";
import { Repos } from "../repo/registry.js";
import { paths } from "../shared/paths.js";
import type { TaskView } from "../workflow/engine.js";
import type { Row } from "../workflow/store.js";
import { buildDigest, digest, digestMarkdown, digestText, saveDigest } from "./digest.js";
import { MODEL, embedder, embedderInstalled, embedderProblem } from "./embed.js";
import { linkDigest, tasksAt } from "./graph.js";
import { project, projectList } from "./projects.js";
import { recall, search } from "./recall.js";
import { summarize } from "./summarize.js";
import { ensureVectors } from "./vectors.js";

const FINISHED = ["Done", "Dropped"];

export const memoryPart: PluginFactory = ({ engine, store }) => {
  const repos = new Repos(store, engine);
  const pending = new Set<Promise<void>>();

  /** The free part now, the summary and its vector after: a failed or slow model never loses the digest. */
  const remember = (t: TaskView, opts: { summarize: boolean }) => {
    const d = buildDigest(t, engine.events(t.id), paths.job(t.id));
    saveDigest(store, d);
    linkDigest(store, d, t.source === "jira" ? t.sourceRef : undefined);
    if (!opts.summarize) return;
    const work = (async () => {
      const s = engine.settings();
      const sum = await summarize(d, s.models.memory ?? "haiku", s.efforts.memory);
      const final = sum ? { ...d, ...sum } : d;
      if (sum) saveDigest(store, final);
      const e = await embedder();
      if (e) await ensureVectors(store, e, [{ kind: "digest", ref: d.taskId, text: digestText(final) }]);
      store.addEvent(t.id, "remembered", "engine", { summarized: !!sum, embedded: !!e });
    })()
      .catch((err) => void store.addEvent(t.id, "memory_failed", "engine", { error: String(err) }))
      .finally(() => pending.delete(work));
    pending.add(work);
  };

  const onChange = (c: { kind: string; task?: TaskView }) => {
    if (c.kind === "task" && c.task && FINISHED.includes(c.task.machine.state) && !digest(store, c.task.id)) remember(c.task, { summarize: true });
  };

  const all = () => engine.list({ all: true });
  return {
    name: "memory",
    start: () => {
      // Tasks that finished before memory existed get the free digest and graph, never a model call.
      const missing = store.db.prepare("SELECT id FROM tasks WHERE state IN ('Done', 'Dropped') AND id NOT IN (SELECT task_id FROM digests)").all() as Row[];
      for (const r of missing) {
        const t = engine.get(String(r.id));
        if (t) remember(t, { summarize: false });
      }
      engine.on("change", onChange);
    },
    stop: async () => {
      engine.off("change", onChange);
      await Promise.allSettled([...pending]);
    },
    api: {
      "projects.list": () => projectList(repos.list(), all()),
      "projects.get": (p: { path?: string; name?: string }) => {
        const path = p.name !== undefined ? projectList(repos.list(), all()).find((x) => x.name === p.name)?.path : p.path;
        if (path === undefined) throw new Error(`no project ${p.name ?? ""}`.trim());
        const found = project(store, repos.list(), all(), path);
        if (!found) throw new Error(`no project at ${path || "(no repo)"}`);
        return found;
      },
      "memory.recall": async (p: { task: string }) => {
        const t = store.task(p.task);
        if (!t) throw new Error(`no task ${p.task}`);
        return recall(store, t);
      },
      "memory.show": (p: { task: string }) => {
        const d = digest(store, p.task.toUpperCase());
        if (!d) throw new Error(`${p.task} has no memory yet: only finished tasks do`);
        return digestMarkdown(d);
      },
      "memory.search": (p: { query: string; repo?: string }) => {
        if (!p.query?.trim()) throw new Error('factory memory search "<words>"');
        return search(store, p.query, p.repo ? (repos.resolve(p.repo) ?? p.repo) : undefined);
      },
      "memory.file": (p: { path: string }) => {
        const exact = tasksAt(store, `file:${p.path}`);
        const ids = exact.length
          ? exact
          : (store.db.prepare("SELECT DISTINCT src FROM edges WHERE rel = 'touched' AND dst LIKE ?").all(`file:%${p.path}%`) as Row[]).map((r) => String(r.src).slice(5));
        return ids.slice(0, 20).map((id) => {
          const d = digest(store, id);
          return d ? `- ${d.taskId} ${d.title} (${d.outcome === "Done" ? "done" : "dropped"} ${d.finishedAt.slice(0, 10)}${d.prUrl ? `, ${d.prUrl}` : ""})` : `- ${id}`;
        });
      },
      "memory.status": async () => {
        const e = await embedder();
        const count = (sql: string) => Number((store.db.prepare(sql).get() as Row).n);
        return {
          embedder: e ? e.model : undefined,
          installed: embedderInstalled(),
          problem: e ? undefined : embedderProblem(),
          model: MODEL,
          digests: count("SELECT COUNT(*) AS n FROM digests"),
          summarized: count("SELECT COUNT(*) AS n FROM digests WHERE json_extract(data, '$.summary') IS NOT NULL"),
          vectors: count("SELECT COUNT(*) AS n FROM vectors"),
          edges: count("SELECT COUNT(*) AS n FROM edges"),
          budgetTokens: store.setting("memory_budget_tokens", 600),
        };
      },
    },
  };
};
