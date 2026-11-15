import type { Row, Store, Task } from "./store.js";
import { opt } from "./store.js";

export interface Link {
  taskId: string;
  why: string;
}

const PR_URL = /https?:\/\/[^\s<>()[\]"'`]+\/(?:pull|pulls|merge_requests)\/\d+/gi;
const TASK_ID = /\bF-\d{3,}\b/g;
const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

const normalUrl = (u: string) =>
  u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[#?].*$/, "")
    .replace(/\/(files|commits|checks)$/, "")
    .replace(/\/+$/, "");

/**
 * Tasks a piece of text points at on purpose: a factory task id, a pull request a task opened, the
 * branch it worked on, the Slack thread or Notion page it came from, or the Jira issue it was for.
 * Strongest evidence first; the text's own source is the caller's to exclude.
 */
export function linksIn(store: Store, text: string, exclude: string[] = []): Link[] {
  const found = new Map<string, string>();
  const add = (id: string | undefined, why: string) => {
    if (id && !exclude.includes(id) && !found.has(id)) found.set(id, why);
  };
  for (const m of text.match(TASK_ID) ?? []) add(store.task(m)?.id, `it names ${m}`);
  const rows = store.db.prepare("SELECT id, pr_url, branch, source, source_ref, source_url FROM tasks").all() as Row[];
  const prs = new Set((text.match(PR_URL) ?? []).map(normalUrl));
  for (const r of rows) {
    const pr = opt(r.pr_url);
    if (pr && prs.has(normalUrl(pr))) add(String(r.id), `it links ${String(r.id)}'s pull request`);
  }
  const lower = text.toLowerCase();
  for (const r of rows) {
    const branch = opt(r.branch);
    if (branch && branch.length >= 8 && branch.includes("/") && lower.includes(branch.toLowerCase())) add(String(r.id), `it names ${String(r.id)}'s branch ${branch}`);
  }
  for (const r of rows) {
    const url = opt(r.source_url);
    if (url && url.length >= 16 && lower.includes(normalUrl(url))) add(String(r.id), `it links the ${String(r.source)} item ${String(r.id)} came from`);
  }
  const keys = new Set(text.match(JIRA_KEY) ?? []);
  for (const r of rows) {
    const key = r.source === "jira" ? opt(r.source_ref)?.split("@")[0] : undefined;
    if (key && keys.has(key)) add(String(r.id), `it names ${key}, which ${String(r.id)} was for`);
  }
  return [...found].map(([taskId, why]) => ({ taskId, why }));
}

/** The task itself and the ones it continues, oldest last, so lineage reads from the newest back. */
export function ancestors(store: Store, task: Task, max = 5): Task[] {
  const out: Task[] = [];
  let at: Task | undefined = task.parent ? store.task(task.parent) : undefined;
  while (at && out.length < max && !out.some((t) => t.id === at!.id)) {
    out.push(at);
    at = at.parent ? store.task(at.parent) : undefined;
  }
  return out;
}
