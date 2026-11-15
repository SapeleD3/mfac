import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Row, type Store, type Task, type TaskEvent, now, parseJson } from "../workflow/store.js";

export interface Digest {
  taskId: string;
  title: string;
  repo?: string;
  area?: string;
  kind: "change" | "research";
  outcome: "Done" | "Dropped";
  ask: string;
  requirements: string[];
  approach: string;
  lessons: string;
  files: string[];
  notes: string[];
  prUrl?: string;
  sourceUrl?: string;
  parent?: string;
  finishedAt: string;
  summary?: string;
  decisions?: string[];
}

const WORKSPACES = new Set(["packages", "apps", "services", "libs", "modules", "crates", "plugins", "projects", "tools", "src"]);

/** The package or folder most of a change lives in: packages/billing in a monorepo, the top folder otherwise. */
export function areaOf(files: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const f of files) {
    const segs = f.split("/");
    const area = segs.length > 2 && WORKSPACES.has(segs[0]!) ? `${segs[0]}/${segs[1]}` : segs.length > 1 ? segs[0]! : "(root)";
    count.set(area, (count.get(area) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

const read = (dir: string, file: string) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "");

const clip = (text: string, max: number) => {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t;
};

/** The part of research.md that says what was decided, or its opening when it has no such heading. */
export function approachOf(research: string): string {
  const sections = research.split(/^#{1,3}\s+/m);
  const pick = sections.find((s) => /^(recommend|approach|decision|conclusion|summary|answer)/i.test(s));
  if (pick) return clip(pick.replace(/^[^\n]*\n/, ""), 700);
  return clip(research.replace(/^#[^\n]*\n/, ""), 500);
}

export function buildDigest(task: Task, events: Pick<TaskEvent, "actor" | "data">[], jobDir: string): Digest {
  const files = read(jobDir, "files.txt").split("\n").filter(Boolean);
  return {
    taskId: task.id,
    title: task.title,
    repo: task.repo,
    area: areaOf(files),
    kind: task.machine.kind,
    outcome: task.machine.state === "Done" ? "Done" : "Dropped",
    ask: clip(task.body || task.title, 400),
    requirements: [...read(jobDir, "requirements.md").matchAll(/^###\s+(R\d+:?.*)$/gm)].map((m) => m[1]!.trim()).slice(0, 12),
    approach: approachOf(read(jobDir, "research.md")),
    lessons: clip(read(jobDir, "lessons.md").replace(/^#[^\n]*\n/, ""), 900),
    files: files.slice(0, 60),
    notes: events
      .filter((e) => e.actor === "human" && typeof e.data.note === "string" && e.data.note)
      .map((e) => clip(String(e.data.note), 240))
      .slice(-5),
    prUrl: task.prUrl,
    sourceUrl: task.sourceUrl,
    parent: task.parent,
    finishedAt: now(),
  };
}

export function saveDigest(store: Store, d: Digest) {
  store.db.prepare("INSERT OR REPLACE INTO digests (task_id, repo, area, at, data) VALUES (?, ?, ?, ?, ?)").run(d.taskId, d.repo ?? null, d.area ?? null, d.finishedAt, JSON.stringify(d));
}

export function digest(store: Store, taskId: string): Digest | undefined {
  const r = store.db.prepare("SELECT data FROM digests WHERE task_id = ?").get(taskId) as Row | undefined;
  return r ? parseJson<Digest | undefined>(r.data, undefined) : undefined;
}

export function digests(store: Store, repo?: string): Digest[] {
  const rows = (repo ? store.db.prepare("SELECT data FROM digests WHERE repo = ? ORDER BY at DESC").all(repo) : store.db.prepare("SELECT data FROM digests ORDER BY at DESC").all()) as Row[];
  return rows.map((r) => parseJson<Digest | undefined>(r.data, undefined)).filter((d): d is Digest => !!d);
}

export function digestMarkdown(d: Digest, why?: string): string {
  const lines = [
    `### ${d.taskId}: ${d.title} (${d.kind === "research" ? "research, " : ""}${d.outcome === "Done" ? "done" : "dropped"} ${d.finishedAt.slice(0, 10)})`,
    why ? `Why it's here: ${why}.` : "",
    d.area ? `Area: ${d.area}.` : "",
    d.prUrl ? `Pull request: ${d.prUrl}` : "",
    d.parent ? `Continued ${d.parent}.` : "",
    d.summary ? `Summary: ${d.summary}` : "",
    d.decisions?.length ? `Decisions:\n${d.decisions.map((x) => `- ${x}`).join("\n")}` : "",
    `Ask: ${d.ask}`,
    d.requirements.length ? `Requirements: ${d.requirements.join("; ")}` : "",
    d.approach && !d.summary ? `\nWhat was decided:\n${d.approach}` : "",
    d.lessons ? `\nLessons:\n${d.lessons}` : "",
    d.notes.length ? `\nThe person's notes at the gates:\n${d.notes.map((n) => `- ${n}`).join("\n")}` : "",
    d.files.length ? `\nFiles changed (${d.files.length}): ${d.files.slice(0, 20).join(", ")}${d.files.length > 20 ? ", …" : ""}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** One line per past task: what the brief carries instead of the whole summary. */
export function digestLine(d: Digest, why: string): string {
  const gist = (d.summary ?? d.approach ?? d.ask).replace(/\s+/g, " ");
  const first = gist.match(/^.{20,180}?[.!?](\s|$)/)?.[0]?.trim() ?? clip(gist, 160);
  const facts = [`${d.outcome === "Done" ? "done" : "dropped"} ${d.finishedAt.slice(0, 10)}`, d.kind === "research" ? "research" : "", d.area ?? "", d.prUrl ?? ""].filter(Boolean).join(", ");
  return `- ${d.taskId} ${d.title} (${facts}). ${first} Why: ${why}.`;
}

/** The text a digest is embedded and keyword-matched by. */
export const digestText = (d: Digest) =>
  [d.title, d.summary ?? "", (d.decisions ?? []).join(" "), d.ask, d.requirements.join(" "), d.summary ? "" : d.approach, d.area ?? "", d.files.slice(0, 20).join(" ")].join("\n");
