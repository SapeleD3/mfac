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

export interface BoardCard {
  pageId: string;
  title: string;
  url: string;
}

const INTAKE = { session: "factory-mcp-notion-intake", timeoutMs: 150_000 };

export const looksLikeLink = (s: string) => /^https?:\/\//i.test(s) || /^[0-9a-f]{32}$/i.test(s.replace(/-/g, ""));

/** Resolved once when the board is saved, so each poll reads the board by id instead of searching again. */
export async function findBoard(store: Store, name: string, server?: string): Promise<{ url: string; title: string }> {
  const r = await ask<{ boards?: { title?: string; url?: string }[] }>(
    store,
    "notion",
    `Search Notion for databases (boards) named "${name}". Answer {"boards": [{"title", "url"}]} with up to 5 databases whose title matches it best, closest first. If none, {"boards": []}.`,
    { ...INTAKE, server },
  );
  const boards = (r.boards ?? []).filter((b): b is { title: string; url: string } => !!b.title && !!b.url);
  const norm = (s: string) =>
    s
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const exact = boards.filter((b) => norm(b.title) === norm(name));
  if (exact.length === 1) return exact[0]!;
  if (!exact.length && boards.length === 1) return boards[0]!;
  if (!boards.length) throw new Error(`no Notion board called "${name}" that Claude's Notion connector can see`);
  throw new Error(`more than one Notion board matches "${name}": ${(exact.length ? exact : boards).map((b) => `"${b.title}"`).join(", ")}. Use the exact name, or paste its link`);
}

/** Lists only ids and titles in one filtered query; page bodies are read separately, and only for cards the factory hasn't seen. */
export async function readyCards(store: Store, board: string, status: string, server?: string): Promise<BoardCard[]> {
  const r = await ask<{ cards?: Partial<BoardCard>[] }>(
    store,
    "notion",
    [
      `${pageUrl(board)} is a Notion database (the link may point at one of its views). Fetch it once to learn its data source and its status property (a Status or Select property, usually called Status).`,
      `Then query it for the cards whose status is "${status}" (ignore case and any emoji). Use one filtered query; don't open the pages.`,
      'At most 30. Answer {"cards": [{"pageId", "title", "url"}]}. If none match, {"cards": []}.',
    ].join("\n"),
    { ...INTAKE, server },
  );
  return (r.cards ?? []).filter((c) => c.pageId && c.title).map((c) => ({ pageId: c.pageId!, title: c.title!, url: c.url ?? pageUrl(c.pageId!) }));
}

export async function cardText(store: Store, pageId: string, server?: string): Promise<string> {
  const r = await ask<{ text?: string }>(store, "notion", `Read the Notion page ${pageUrl(pageId)}. Answer {"text": "<its content as plain text, at most 3000 characters>"}.`, {
    ...INTAKE,
    server,
    timeoutMs: 90_000,
  });
  return typeof r.text === "string" ? r.text : "";
}

/** Sets the card's status column; with only a meaning, picks the board's closest option and says which, or leaves it when none fits. */
export async function moveCard(store: Store, pageId: string, to: { exact?: string; meaning?: string }, server?: string): Promise<{ status?: string }> {
  const target = to.exact ? `to "${to.exact}"` : `to the existing option that means ${to.meaning}. Look at the property's options first. If no option fits, change nothing and answer {"status": ""}`;
  const r = await ask<{ status?: string }>(
    store,
    "notion",
    `On the Notion page ${pageUrl(pageId)}, set its status property (a Status or Select property, usually called Status) ${target}. Change nothing else. Answer {"status": "<the option it now has>"}.`,
    {
      write: true,
      server,
      session: "factory-mcp-notion-intake",
    },
  );
  return { status: typeof r.status === "string" && r.status.trim() ? r.status.trim() : undefined };
}

export async function commentOn(store: Store, pageId: string, text: string, server?: string) {
  await ask(store, "notion", `Add this exact page-level comment to the Notion page ${pageUrl(pageId)}, and nothing else:\n\n---\n${text}\n---\n\nAnswer {"ok": true} once it's added.`, {
    write: true,
    server,
  });
}
