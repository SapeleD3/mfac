import { ask } from "./connectors.js";
import type { Store } from "./store.js";

/*
 * Notion through the Notion connector you have in Claude (see connectors.ts). The engine never holds a
 * Notion token: each operation is one small Claude call that may use only Notion's tools and answers
 * in JSON. Board updates are batched into one call per sync, so a quiet factory makes no calls.
 */

export const pageUrl = (id: string) => (id.startsWith("http") ? id : `https://www.notion.so/${id.replace(/-/g, "")}`);

export interface BoardIds {
  jobsDb: string;
  ticketsDb: string;
  reviewsDb: string;
}

export type Value = string | number | string[] | null | undefined;

export interface RowUpdate {
  /** Which database, and the factory's own id for the row (task or ticket id). */
  db: keyof BoardIds;
  key: string;
  /** The row's Notion page, once it has one. */
  pageId?: string;
  properties: Record<string, Value>;
}

export interface NotionComment {
  discussionId: string;
  text: string;
  author: string;
  createdAt: string;
  /** The words the comment is anchored to; empty for a comment on the whole page. */
  anchor?: string;
}

const SCHEMA = `Jobs: Name (title), Task (text), State (select), Column (select), Rounds (text), Tags (multi-select: learn, urgent, ui, sensitive, harden), Source (url), PR (url).
Tickets: Name (title), Ticket (text), Job (relation to Jobs), Created by (select), Picked up by (select), Status (select: Backlog, In progress, In review, Blocked, Done), Tags (multi-select, as in Jobs), Check (text), Links (text).
Reviews: Name (title), Job (relation to Jobs), Gate (select: Research, Plan), Round (number), Verdict (select: Waiting, Approved, Sent back, Dropped).`;

/** First run: the three databases of the factory board, on a page you can edit. */
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

/** Creates or updates board rows, all in one call. Returns each row's page id. */
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

/** A review gate opened: a page in Reviews with the doc as its content. */
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

/** A sent-back stage reran: the new round goes at the end of the same page, and every open comment gets a reply. */
export async function addRound(store: Store, pageId: string, properties: Record<string, Value>, markdown: string, reply: string) {
  await ask(
    store,
    "notion",
    `On the Notion page ${pageId}: set these properties ${JSON.stringify(properties)}; add a divider and then this markdown at the end of the page, exactly as written:\n\n${markdown}\n\nThen reply to every open comment discussion on the page with: "${reply}". Answer {"ok": true}.`,
    { write: true },
  );
}

/** Every comment on a review page, with the words each one is anchored to. */
export async function comments(store: Store, pageId: string): Promise<NotionComment[]> {
  const r = await ask<{ comments?: NotionComment[] }>(
    store,
    "notion",
    `List every comment on the Notion page ${pageId}, page-level and inline. Answer {"comments": [{"discussionId", "author", "createdAt" (ISO), "anchor" (the exact text the comment is attached to, or "" for the whole page), "text"}]}.`,
  );
  return (r.comments ?? []).filter((c) => typeof c.text === "string");
}

/** The rows of the Tickets database, so tickets you add or edit in Notion come back. */
export async function ticketRows(store: Store, ids: BoardIds): Promise<{ pageId: string; ticket?: string; title: string; check?: string; jobPageId?: string }[]> {
  const r = await ask<{ rows?: { pageId: string; ticket?: string; title: string; check?: string; jobPageId?: string }[] }>(
    store,
    "notion",
    `List every row of the Tickets database ${ids.ticketsDb}. Answer {"rows": [{"pageId", "ticket" (its Ticket property, or ""), "title" (its Name), "check" (its Check property), "jobPageId" (the page id its Job relation points to, or "")}]}.`,
  );
  return (r.rows ?? []).filter((x) => x.pageId);
}
