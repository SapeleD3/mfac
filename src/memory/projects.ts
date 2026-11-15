import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "../repo/registry.js";
import { paths } from "../shared/paths.js";
import type { TaskView } from "../workflow/engine.js";
import type { Store } from "../workflow/store.js";
import { areaOf, digests } from "./digest.js";

export interface ProjectSummary {
  name: string;
  path: string;
  about: string;
  isDefault: boolean;
  registered: boolean;
  counts: { active: number; waiting: number; queued: number; done: number; dropped: number; total: number };
  lastActivity?: string;
}

export interface TimelineItem {
  id: string;
  title: string;
  state: string;
  column: string;
  kind: "change" | "research";
  recipe: string;
  source: string;
  sourceUrl?: string;
  prUrl?: string;
  branch?: string;
  parent?: string;
  children: string[];
  area?: string;
  summary?: string;
  files: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  areas: { name: string; count: number }[];
  tasks: TimelineItem[];
}

const NO_REPO = "";

const keyOf = (t: TaskView) => t.repo?.replace(/\/+$/, "") ?? NO_REPO;

function summarize(name: string, path: string, repo: Repo | undefined, tasks: TaskView[]): ProjectSummary {
  const col = (c: string) => tasks.filter((t) => t.column === c).length;
  return {
    name,
    path,
    about: repo?.about ?? "",
    isDefault: !!repo?.isDefault,
    registered: !!repo,
    counts: {
      active: col("Running"),
      waiting: col("Needs you") + col("PR ready"),
      queued: col("Queued") + col("Backlog"),
      done: tasks.filter((t) => t.machine.state === "Done").length,
      dropped: tasks.filter((t) => t.machine.state === "Dropped").length,
      total: tasks.length,
    },
    lastActivity: tasks
      .map((t) => t.updatedAt)
      .sort()
      .pop(),
  };
}

const userTasks = (tasks: TaskView[]) => tasks.filter((t) => !["Ignored", "Replied"].includes(t.machine.state));

/** One project per registered repo, then any folder tasks ran in that isn't registered, then tasks with no repo. */
export function projectList(repos: Repo[], tasks: TaskView[]): ProjectSummary[] {
  const by = new Map<string, TaskView[]>();
  for (const t of userTasks(tasks)) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  const out = repos.map((r) => summarize(r.name, r.path, r, by.get(r.path) ?? []));
  for (const [path, ts] of by) {
    if (repos.some((r) => r.path === path)) continue;
    out.push(summarize(path === NO_REPO ? "No repo" : (path.split("/").pop() ?? path), path, undefined, ts));
  }
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.name.localeCompare(b.name));
}

/** Where an unfinished task will likely land: an area the repo already has whose name its ask uses, when exactly one does. */
export function guessArea(text: string, known: string[]): string | undefined {
  const hits = known.filter((a) => {
    const leaf = a.split("/").pop()!;
    return leaf.length >= 3 && leaf !== "src" && new RegExp(`(^|[^\\w-])${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "i").test(text);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

const filesOf = (id: string) => {
  const f = join(paths.job(id), "files.txt");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
};

export function project(store: Store, repos: Repo[], tasks: TaskView[], path: string): Project | undefined {
  const key = path.replace(/\/+$/, "");
  const summary = projectList(repos, tasks).find((p) => p.path === key);
  if (!summary) return undefined;
  const mine = userTasks(tasks).filter((t) => keyOf(t) === key);
  const ds = new Map(digests(store, key || undefined).map((d) => [d.taskId, d]));
  const known = [...new Set([...ds.values()].map((d) => d.area).filter((a): a is string => !!a))];
  const items: TimelineItem[] = mine.map((t) => {
    const d = ds.get(t.id);
    const files = d?.files ?? filesOf(t.id);
    return {
      id: t.id,
      title: t.title,
      state: t.machine.state,
      column: t.column,
      kind: t.machine.kind,
      recipe: t.recipe,
      source: t.source,
      sourceUrl: t.sourceUrl,
      prUrl: t.prUrl,
      branch: t.branch,
      parent: t.parent,
      children: mine.filter((c) => c.parent === t.id).map((c) => c.id),
      area: d?.area ?? areaOf(files) ?? guessArea(`${t.title}\n${t.body}`, known) ?? (t.parent ? ds.get(t.parent)?.area : undefined),
      summary: (d?.summary ?? d?.approach)?.slice(0, 280) || undefined,
      files: files.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const areas = new Map<string, number>();
  for (const i of items) if (i.area) areas.set(i.area, (areas.get(i.area) ?? 0) + 1);
  return {
    ...summary,
    areas: [...areas].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    tasks: items,
  };
}
