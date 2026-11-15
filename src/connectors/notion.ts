import { ask } from "./mcp.js";
import type { Store } from "../workflow/store.js";

export const pageUrl = (id: string) => (id.startsWith("http") ? id : `https://www.notion.so/${id.replace(/-/g, "")}`);

export interface BoardIds {
  jobsDb: string;
  ticketsDb: string;
  reviewsDb: string;
}

export type Value = string | number | string[] | null | undefined;

export interface RowUpdate {
  db: keyof BoardIds;
  key: string;
  pageId?: string;
  properties: Record<string, Value>;
}

export interface NotionComment {
  discussionId: string;
  text: string;
  author: string;
  createdAt: string;
  anchor?: string;
}

const SCHEMA = `Jobs: Name (title), Task (text), State (select), Column (select), Rounds (text), Tags (multi-select: learn, urgent, ui, sensitive, harden), Source (url), PR (url).
Tickets: Name (title), Ticket (text), Job (relation to Jobs), Created by (select), Picked up by (select), Status (select: Backlog, In progress, In review, Blocked, Done), Tags (multi-select, as in Jobs), Check (text), Links (text).
Reviews: Name (title), Job (relation to Jobs), Gate (select: Research, Plan), Round (number), Verdict (select: Waiting, Approved, Sent back, Dropped).`;

export async function setupBoard(store: Store, parentPage: string): Promise<BoardIds> {
  const r = await ask<Partial<BoardIds>>(
    store,
    "notion",
    `On the Notion page ${parentPage}, create three databases with exactly these names and properties:\n${SCHEMA}\nAnswer {"jobsDb": "<id>", "ticketsDb": "<id>", "reviewsDb": "<id>"} with the id (or data source id) you'd use to add rows to each.`,
    { write: true, model: "sonnet" },
  );
  if (!r.jobsDb || !r.ticketsDb || !r.reviewsDb) throw new Error("Notion didn't return the three database ids");
  return r as BoardIds;
}

export async function upsertRows(store: Store, ids: BoardIds, rows: RowUpdate[]): Promise<{ key: string; pageId: string }[]> {
  if (!rows.length) return [];
  const r = await ask<{ rows?: { key: string; pageId: string }[] }>(
    store,
    "notion",
    [
      `Update the factory board in Notion. Databases: Jobs ${ids.jobsDb}, Tickets ${ids.ticketsDb}, Reviews ${ids.reviewsDb}.`,
      `Their properties:\n${SCHEMA}`,
      "For each row below: if it has a pageId, update that page's properties; otherwise create a page in its database. Set only the properties given; null clears one. A Job value is the page id of the job to relate to.",
      JSON.stringify(rows),
      'Answer {"rows": [{"key", "pageId"}]} for every row.',
    ].join("\n\n"),
    { write: true },
  );
  return (r.rows ?? []).filter((x) => x.key && x.pageId);
}

export async function createReview(store: Store, ids: BoardIds, properties: Record<string, Value>, markdown: string): Promise<string> {
  const r = await ask<{ pageId?: string }>(
    store,
    "notion",
    `Create a page in the Reviews database ${ids.reviewsDb} with these properties:\n${JSON.stringify(properties)}\n\nIts content is this markdown, exactly as written (keep mermaid code blocks as code blocks with language mermaid):\n\n${markdown}\n\nAnswer {"pageId": "<id>"}.`,
    { write: true },
  );
  if (!r.pageId) throw new Error("Notion didn't return the review page");
  return r.pageId;
}

export async function addRound(store: Store, pageId: string, properties: Record<string, Value>, markdown: string, reply: string) {
  await ask(
    store,
    "notion",
    `On the Notion page ${pageId}: set these properties ${JSON.stringify(properties)}; add a divider and then this markdown at the end of the page, exactly as written:\n\n${markdown}\n\nThen reply to every open comment discussion on the page with: "${reply}". Answer {"ok": true}.`,
    { write: true },
  );
}

export async function comments(store: Store, pageId: string): Promise<NotionComment[]> {
  const r = await ask<{ comments?: NotionComment[] }>(
    store,
    "notion",
    `List every comment on the Notion page ${pageId}, page-level and inline. Answer {"comments": [{"discussionId", "author", "createdAt" (ISO), "anchor" (the exact text the comment is attached to, or "" for the whole page), "text"}]}.`,
  );
  return (r.comments ?? []).filter((c) => typeof c.text === "string");
}

export async function ticketRows(store: Store, ids: BoardIds): Promise<{ pageId: string; ticket?: string; title: string; check?: string; jobPageId?: string }[]> {
  const r = await ask<{ rows?: { pageId: string; ticket?: string; title: string; check?: string; jobPageId?: string }[] }>(
    store,
    "notion",
    `List every row of the Tickets database ${ids.ticketsDb}. Answer {"rows": [{"pageId", "ticket" (its Ticket property, or ""), "title" (its Name), "check" (its Check property), "jobPageId" (the page id its Job relation points to, or "")}]}.`,
  );
  return (r.rows ?? []).filter((x) => x.pageId);
}
