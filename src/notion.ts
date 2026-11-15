import { HttpError, json } from "./http.js";
import { getSecret } from "./secrets.js";

/*
 * Notion through its public API with an internal integration token: the engine publishes review docs,
 * mirrors the Jobs and Tickets boards, and reads your comments back. Plain API calls, no Claude.
 */

const VERSION = "2022-06-28";
const BASE = "https://api.notion.com/v1";

async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getSecret("notion");
  if (!token) throw new HttpError(401, "no Notion token (run factory connect notion)");
  return json<T>(`${BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, "notion-version": VERSION, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

export const pageUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;

// ---------- markdown to blocks ----------

type RichText = { type: "text"; text: { content: string; link?: { url: string } | null }; annotations?: Record<string, boolean> };

/** Inline **bold**, `code` and [links](url); everything else plain. Notion caps a text run at 2000 chars. */
export function rich(text: string): RichText[] {
  const out: RichText[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  const push = (content: string, extra: Partial<RichText> = {}) => {
    for (let i = 0; i < content.length; i += 2000) out.push({ type: "text", text: { content: content.slice(i, i + 2000), ...(extra.text ?? {}) }, ...(extra.annotations ? { annotations: extra.annotations } : {}) });
  };
  for (const m of text.matchAll(re)) {
    if (m.index! > last) push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) push(t.slice(2, -2), { annotations: { bold: true } });
    else if (t.startsWith("`")) push(t.slice(1, -1), { annotations: { code: true } });
    else {
      const [, label, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push({ type: "text", text: { content: label!, link: /^https?:/.test(url!) ? { url: url! } : null } });
    }
    last = m.index! + t.length;
  }
  if (last < text.length) push(text.slice(last));
  return out.length ? out : [{ type: "text", text: { content: "" } }];
}

const LANGS = new Set(["mermaid", "typescript", "javascript", "json", "bash", "shell", "python", "rust", "go", "sql", "yaml", "markdown", "plain text"]);

/** Enough markdown for research and plan docs: headings, lists, quotes, code (mermaid renders as a diagram), tables as code. */
export function blocks(md: string): any[] {
  const out: any[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^```\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) body.push(lines[i]!);
      const lang = fence[1]?.toLowerCase() || "plain text";
      out.push({ type: "code", code: { language: LANGS.has(lang) ? lang : lang === "tla" ? "plain text" : "plain text", rich_text: rich(body.join("\n")).map((r) => ({ ...r, annotations: undefined })) } });
      continue;
    }
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const type = `heading_${h[1]!.length}`;
      out.push({ type, [type]: { rich_text: rich(h[2]!) } });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      out.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(line.replace(/^\s*[-*]\s+/, "")) } });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      out.push({ type: "numbered_list_item", numbered_list_item: { rich_text: rich(line.replace(/^\s*\d+[.)]\s+/, "")) } });
      continue;
    }
    if (line.startsWith(">")) {
      out.push({ type: "quote", quote: { rich_text: rich(line.replace(/^>\s?/, "")) } });
      continue;
    }
    if (line.startsWith("|")) {
      const table: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith("|"); i++) table.push(lines[i]!);
      i--;
      out.push({ type: "code", code: { language: "plain text", rich_text: rich(table.join("\n")).map((r) => ({ ...r, annotations: undefined })) } });
      continue;
    }
    // Join a paragraph's wrapped lines.
    const para = [line];
    while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^(#|```|\s*[-*]\s|\s*\d+[.)]\s|>|\|)/.test(lines[i + 1]!)) para.push(lines[++i]!);
    out.push({ type: "paragraph", paragraph: { rich_text: rich(para.join(" ")) } });
  }
  return out;
}

// ---------- pages, databases, comments ----------

export async function createDatabase(parentPageId: string, title: string, properties: Record<string, unknown>) {
  return api<{ id: string; url: string }>("/databases", { body: { parent: { type: "page_id", page_id: parentPageId }, title: [{ type: "text", text: { content: title } }], is_inline: false, properties } });
}

export async function createPage(parent: { database_id: string } | { page_id: string }, properties: Record<string, unknown>, children: any[] = []) {
  const page = await api<{ id: string; url: string }>("/pages", { body: { parent, properties, children: children.slice(0, 100) } });
  await appendBlocks(page.id, children.slice(100));
  return page;
}

export async function appendBlocks(blockId: string, children: any[]) {
  for (let i = 0; i < children.length; i += 100) await api(`/blocks/${blockId}/children`, { method: "PATCH", body: { children: children.slice(i, i + 100) } });
}

export async function updatePage(pageId: string, properties: Record<string, unknown>) {
  return api(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
}

export async function children(blockId: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await api<{ results: any[]; has_more: boolean; next_cursor?: string }>(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    all.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return all;
}

export async function queryDatabase(databaseId: string, filter?: unknown): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await api<{ results: any[]; has_more: boolean; next_cursor?: string }>(`/databases/${databaseId}/query`, { body: { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) } });
    all.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return all;
}

export interface NotionComment {
  id: string;
  discussionId: string;
  text: string;
  author: string;
  createdAt: string;
  /** The block the comment is anchored to (inline comments); the page itself for page comments. */
  blockId: string;
  /** That block's text: the words the comment is about. */
  anchor?: string;
}

const plain = (rt: any[] = []) => rt.map((r) => r.plain_text ?? r.text?.content ?? "").join("");

/** Every comment on a page, page-level and inline, with the text of the block each is anchored to. */
export async function comments(pageId: string): Promise<NotionComment[]> {
  const blocksOnPage = await children(pageId);
  const out: NotionComment[] = [];
  for (const id of [pageId, ...blocksOnPage.map((b) => b.id)]) {
    const r = await api<{ results: any[] }>(`/comments?block_id=${id}&page_size=100`);
    const block = blocksOnPage.find((b) => b.id === id);
    for (const c of r.results)
      out.push({
        id: c.id,
        discussionId: c.discussion_id,
        text: plain(c.rich_text),
        author: c.created_by?.name ?? c.created_by?.id ?? "",
        createdAt: c.created_time,
        blockId: id,
        anchor: block ? plain(block[block.type]?.rich_text) : undefined,
      });
  }
  return out;
}

export async function replyToDiscussion(discussionId: string, text: string) {
  await api("/comments", { body: { discussion_id: discussionId, rich_text: rich(text) } });
}

export async function test(): Promise<string> {
  const me = await api<{ name?: string; bot?: { workspace_name?: string } }>("/users/me");
  return `connected to ${me.bot?.workspace_name ?? me.name ?? "Notion"}`;
}

// ---------- property helpers ----------

export const prop = {
  title: (s: string) => ({ title: [{ type: "text", text: { content: s.slice(0, 2000) } }] }),
  text: (s: string) => ({ rich_text: s ? [{ type: "text", text: { content: s.slice(0, 2000) } }] : [] }),
  select: (s?: string) => ({ select: s ? { name: s } : null }),
  multi: (xs: string[]) => ({ multi_select: xs.map((name) => ({ name })) }),
  url: (u?: string) => ({ url: u ?? null }),
  number: (n: number) => ({ number: n }),
  relation: (ids: string[]) => ({ relation: ids.map((id) => ({ id })) }),
};
export const read = {
  title: (p: any) => plain(p?.title),
  text: (p: any) => plain(p?.rich_text),
  select: (p: any) => p?.select?.name as string | undefined,
};
