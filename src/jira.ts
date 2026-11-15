import { HttpError, json } from "./http.js";
import { getSecret } from "./secrets.js";

/*
 * Jira Cloud, read with your API token straight from the engine: tickets assigned to you that changed
 * since the cursor. Comments go back only on a gate decision or when you press Send.
 */

export interface JiraConfig {
  site?: string;
  email?: string;
}

export interface JiraItem {
  sourceId: string;
  key: string;
  summary: string;
  text: string;
  url: string;
  updated: string;
  reporter: string;
  priority?: string;
  due?: string;
}

function auth(cfg: JiraConfig) {
  const token = getSecret("jira");
  if (!token || !cfg.site || !cfg.email) throw new HttpError(401, "Jira isn't connected (run factory connect jira)");
  return { base: `https://${cfg.site.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`, header: `Basic ${Buffer.from(`${cfg.email}:${token}`).toString("base64")}` };
}

export async function poll(cfg: JiraConfig, since: string): Promise<{ items: JiraItem[]; cursor: string }> {
  const { base, header } = auth(cfg);
  const after = since ? new Date(since) : new Date(Date.now() - 7 * 86_400_000);
  const stamp = `${after.getFullYear()}-${String(after.getMonth() + 1).padStart(2, "0")}-${String(after.getDate()).padStart(2, "0")} ${String(after.getHours()).padStart(2, "0")}:${String(after.getMinutes()).padStart(2, "0")}`;
  const jql = `assignee = currentUser() AND updated >= "${stamp}" AND statusCategory != Done ORDER BY updated ASC`;
  const r = await json<{ issues?: any[] }>(`${base}/rest/api/3/search/jql?${new URLSearchParams({ jql, fields: "summary,description,updated,reporter,priority,duedate", maxResults: "50" })}`, {
    headers: { authorization: header, accept: "application/json" },
  });
  const items = (r.issues ?? []).map(
    (i): JiraItem => ({
      sourceId: `${i.key}@${i.fields.updated}`,
      key: i.key,
      summary: i.fields.summary ?? i.key,
      text: adfText(i.fields.description),
      url: `${base}/browse/${i.key}`,
      updated: i.fields.updated,
      reporter: i.fields.reporter?.displayName ?? "",
      priority: i.fields.priority?.name,
      due: i.fields.duedate ?? undefined,
    }),
  );
  const cursor = items.reduce((max, i) => (Date.parse(i.updated) > Date.parse(max) ? i.updated : max), after.toISOString());
  return { items, cursor };
}

/** Atlassian Document Format to plain text. */
export function adfText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(adfText).join(node.type === "doc" || node.type === "bulletList" ? "\n" : "");
  return ["paragraph", "heading", "listItem"].includes(node.type) ? `${inner}\n` : inner;
}

export async function comment(cfg: JiraConfig, key: string, text: string) {
  const { base, header } = auth(cfg);
  await json(`${base}/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ body: { type: "doc", version: 1, content: text.split("\n\n").map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) } }),
  });
}

export async function test(cfg: JiraConfig): Promise<string> {
  const { base, header } = auth(cfg);
  const me = await json<{ displayName: string }>(`${base}/rest/api/3/myself`, { headers: { authorization: header, accept: "application/json" } });
  return `signed in as ${me.displayName}`;
}
