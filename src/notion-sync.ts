import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Connections } from "./connections.js";
import type { Engine, TaskView } from "./engine.js";
import * as notion from "./notion.js";
import { paths } from "./paths.js";
import type { Store } from "./store.js";
import type { Ticket, Tickets } from "./tickets.js";

/*
 * Your Notion factory board, and the research and plan reviews, through the Notion connector in Claude.
 *
 * On first run the factory makes three databases on a page you choose: Jobs (one per task), Tickets
 * (small units of work, tagged with their job, the stage that created them and the stage picking them
 * up) and Reviews (the research and plan docs you comment on).
 *
 * Comments live in Notion, not in the app. When you send work back, every comment on the review page,
 * with the words it's anchored to, goes to the stage as review-comments.md; the next round is added to
 * the same page, with a reply under each comment.
 *
 * factory.db stays the source of truth for status; Notion mirrors it and feeds back your comments and
 * any tickets you add there. Board changes queue up and go in one batched call per sync, so a quiet
 * factory makes no calls; review pages are published as soon as a gate opens.
 */

export interface NotionIds {
  parentPageId?: string;
  jobsDb?: string;
  ticketsDb?: string;
  reviewsDb?: string;
}

const STAGES = ["research", "plan", "build", "code review", "security review", "ui review", "confirm", "you"];
const stageName = (role?: string) => (role ? role.replace("_", " ").replace("researcher", "research").replace("planner", "plan").replace("builder", "build") : undefined);

/** A Notion page link or id to its id. */
export function pageIdFrom(link: string): string {
  const hex = link.replace(/-/g, "").match(/[0-9a-f]{32}(?=[^0-9a-f]*$|\?|#)/i)?.[0] ?? link.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
  if (!hex) throw new Error("that doesn't look like a Notion page link");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class NotionSync {
  /** Board rows waiting for the next sync: "job:<task id>", "ticket:<ticket id>", "review:<task id>". */
  private pending = new Set<string>();
  private refreshing = new Set<string>();

  constructor(
    private store: Store,
    private engine: Engine,
    private tickets: Tickets,
    private connections: Connections,
  ) {}

  ids(): NotionIds {
    return this.store.setting<NotionIds>("notion_ids", {});
  }

  ready(): boolean {
    const ids = this.ids();
    return !!(ids.jobsDb && ids.ticketsDb && ids.reviewsDb);
  }

  private board(): notion.BoardIds {
    const ids = this.ids();
    if (!ids.jobsDb || !ids.ticketsDb || !ids.reviewsDb) throw new Error("the Notion board isn't set up (factory notion setup <page link>)");
    return { jobsDb: ids.jobsDb, ticketsDb: ids.ticketsDb, reviewsDb: ids.reviewsDb };
  }

  /** First run: three linked databases on the page you chose, then every existing task queued for the board. */
  async setup(parentLink: string): Promise<NotionIds> {
    const parentPageId = pageIdFrom(parentLink);
    const existing = this.ids();
    if (existing.parentPageId === parentPageId && this.ready()) return existing;
    const board = await notion.setupBoard(this.store, parentLink);
    const ids = { parentPageId, ...board };
    this.store.setSetting("notion_ids", ids);
    for (const t of this.engine.list()) this.pending.add(`job:${t.id}`);
    return ids;
  }

  // ---------- mirror: engine to Notion, batched ----------

  private jobRow(t: TaskView): notion.RowUpdate {
    return {
      db: "jobsDb",
      key: `job:${t.id}`,
      pageId: t.notionJobId,
      properties: { Name: t.title, Task: t.id, State: t.machine.state, Column: t.column, Rounds: t.rounds ?? "", Tags: t.tags, Source: t.sourceUrl ?? null, PR: t.prUrl ?? null },
    };
  }

  private ticketRow(k: Ticket): notion.RowUpdate {
    return {
      db: "ticketsDb",
      key: `ticket:${k.id}`,
      pageId: k.notionPageId,
      properties: {
        Name: k.title,
        Ticket: k.id,
        Job: this.engine.get(k.taskId)?.notionJobId ?? null,
        "Created by": stageName(k.createdBy) ?? null,
        "Picked up by": stageName(k.pickedUpBy) ?? null,
        Status: k.status,
        Tags: k.tags,
        Check: k.check,
        Links: Object.entries(k.links).map(([a, b]) => `${a}: ${b}`).join("\n"),
      },
    };
  }

  /** Sends every queued board change in one call. Jobs go first so tickets can point at their pages. */
  async flush(): Promise<number> {
    if (!this.ready() || !this.connections.ok("notion") || !this.pending.size) return 0;
    let n = await this.retryPublish();
    const keys = [...this.pending].filter((k) => !k.startsWith("publish:"));
    const jobs = keys.filter((k) => k.startsWith("job:"));
    const rest = keys.filter((k) => !k.startsWith("job:"));
    for (const batch of [jobs, rest]) {
      const rows: notion.RowUpdate[] = [];
      for (const key of batch) {
        const [kind, id] = key.split(":") as [string, string];
        const t = kind === "job" || kind === "review" ? this.engine.get(id) : undefined;
        if (kind === "job" && t) rows.push(this.jobRow(t));
        else if (kind === "ticket" && this.tickets.get(id)) rows.push(this.ticketRow(this.tickets.get(id)!));
        else if (kind === "review" && t?.notionReviewId) rows.push({ db: "reviewsDb", key, pageId: t.notionReviewId, properties: { Verdict: this.store.setting<string>(`verdict_${id}`, "Waiting") } });
        else this.pending.delete(key);
      }
      if (!rows.length) continue;
      const saved = await notion.upsertRows(this.store, this.board(), rows);
      for (const { key, pageId } of saved) {
        const [kind, id] = key.split(":") as [string, string];
        if (kind === "job" && !this.engine.get(id)?.notionJobId) this.engine.store.updateTask(id, { notionJobId: pageId });
        if (kind === "ticket" && !this.tickets.get(id)?.notionPageId) this.tickets.update(id, { notionPageId: pageId });
        this.pending.delete(key);
        n++;
      }
    }
    return n;
  }

  // ---------- reviews ----------

  private publishing = new Set<string>();

  /** A research or plan gate opened: publish (or add a round to) the review page, right away. */
  async publishReview(t: TaskView): Promise<string | undefined> {
    if (!this.ready() || this.publishing.has(t.id)) return undefined;
    this.publishing.add(t.id);
    try {
      return await this.publish(t);
    } finally {
      this.publishing.delete(t.id);
    }
  }

  private async publish(t: TaskView): Promise<string | undefined> {
    const gate = t.machine.state === "ResearchGate" ? "Research" : t.machine.state === "PlanGate" ? "Plan" : undefined;
    if (!gate) return undefined;
    const job = paths.job(t.id);
    const read = (f: string) => (existsSync(join(job, f)) ? readFileSync(join(job, f), "utf8") : "");
    const round = (gate === "Research" ? t.machine.tries.ResearchGate : t.machine.tries.PlanGate) + 1;
    // Every task change while the gate is open lands here; each round is published once.
    const done = `published_${t.id}`;
    if (this.store.setting<string | undefined>(done, undefined) === `${gate}:${round}`) return t.notionReviewId;
    const md =
      gate === "Research"
        ? [read("research.md"), "## Statechart", read("statechart.md"), "## Formal check", read("tlc-result.md"), t.tags.includes("learn") ? read("explainer.md") : ""].join("\n\n")
        : [read("plan.md"), "## Tickets", ...this.tickets.list(t.id).map((k) => `- **${k.id}** ${k.title} (check: ${k.check || "n/a"}; picked up by ${stageName(k.pickedUpBy) ?? "?"})`)].join("\n");
    const intro = `> 💬 Leave a comment on every issue, on the words it's about. Then give one overall verdict in the factory app or with factory approve, send-back or drop ${t.id}.`;
    const key = `review_${t.id}_${gate}`;
    const existing = this.store.setting<string | undefined>(key, undefined);
    this.store.setSetting(`verdict_${t.id}`, "Waiting");
    if (existing) {
      await notion.addRound(this.store, existing, { Round: round, Verdict: "Waiting" }, `# Round ${round}\n\n${intro}\n\n${md}`, `Round ${round} is added below and addresses this. Check the new section and resolve this if it's handled.`);
      this.engine.store.updateTask(t.id, { notionReviewId: existing });
      this.store.setSetting(done, `${gate}:${round}`);
      return existing;
    }
    const pageId = await notion.createReview(this.store, this.board(), { Name: `${t.id} ${gate}: ${t.title}`, Gate: gate, Round: round, Verdict: "Waiting", Job: t.notionJobId ?? null }, `${intro}\n\n${md}`);
    this.store.setSetting(key, pageId);
    this.store.setSetting(done, `${gate}:${round}`);
    this.engine.store.updateTask(t.id, { notionReviewId: pageId });
    this.engine.emit("change", { kind: "task", task: this.engine.get(t.id) });
    return pageId;
  }

  /** Before a sent-back stage reruns: every comment with its anchor, into review-comments.md. */
  async collectComments(t: TaskView, note: string): Promise<number> {
    const pageId = t.notionReviewId;
    if (!pageId) return 0;
    const list = await notion.comments(this.store, pageId);
    this.cacheComments(t.id, list);
    const lines = [`# Review comments on ${t.id} (round ${t.rounds ?? ""})`, "", note ? `Overall note: ${note}` : "", "", `Page: ${notion.pageUrl(pageId)}`, ""];
    for (const c of list) lines.push(`## ${c.author} (${String(c.createdAt).slice(0, 16).replace("T", " ")})`, c.anchor ? `> ${c.anchor.slice(0, 500)}` : "> (on the whole page)", "", c.text, "");
    writeFileSync(join(paths.job(t.id), "review-comments.md"), lines.join("\n"));
    return list.length;
  }

  private cacheComments(taskId: string, list: notion.NotionComment[]) {
    this.store.setSetting(`comments_${taskId}`, { count: list.length, discussions: new Set(list.map((c) => c.discussionId)).size, at: new Date().toISOString() });
  }

  /** The verdict goes on the review page with the next sync. */
  recordVerdict(t: TaskView, verdict: string) {
    if (!t.notionReviewId) return;
    this.store.setSetting(`verdict_${t.id}`, verdict === "approve" ? "Approved" : verdict === "drop" ? "Dropped" : "Sent back");
    this.pending.add(`review:${t.id}`);
  }

  /**
   * What the app's review tab shows: a summary, the comment count and the page link. The count comes
   * from the last read; if that's over ten minutes old, a fresh read starts in the background.
   */
  summary(taskId: string) {
    const t = this.engine.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    const job = paths.job(t.id);
    const file = t.machine.state === "PlanGate" ? "plan.md" : "research.md";
    const text = existsSync(join(job, file)) ? readFileSync(join(job, file), "utf8") : "";
    const cached = this.store.setting<{ count: number; discussions: number; at?: string }>(`comments_${t.id}`, { count: 0, discussions: 0 });
    const stale = !cached.at || Date.now() - Date.parse(cached.at) > 10 * 60_000;
    if (t.notionReviewId && stale && this.connections.ok("notion") && !this.refreshing.has(t.id)) {
      this.refreshing.add(t.id);
      void notion
        .comments(this.store, t.notionReviewId)
        .then((list) => {
          this.cacheComments(t.id, list);
          this.engine.emit("change", { kind: "task", task: this.engine.get(t.id) });
        })
        .catch(() => {})
        .finally(() => this.refreshing.delete(t.id));
    }
    return {
      url: t.notionReviewId ? notion.pageUrl(t.notionReviewId) : undefined,
      comments: cached.count,
      discussions: cached.discussions,
      commentsReadAt: cached.at,
      summary: text.split("\n").filter((l) => l.trim() && !l.startsWith("```")).slice(0, 14).join("\n"),
      tlc: existsSync(join(job, "tlc-result.md")) ? readFileSync(join(job, "tlc-result.md"), "utf8") : undefined,
      statechart: existsSync(join(job, "statechart.md")) ? readFileSync(join(job, "statechart.md"), "utf8") : undefined,
    };
  }

  // ---------- pull: Notion to engine ----------

  /** Tickets you added on the board (no factory id yet) become tickets of their job; edits to titles and checks come back. */
  async pullTickets(): Promise<number> {
    if (!this.ready()) return 0;
    const rows = await notion.ticketRows(this.store, this.board());
    const byJob = new Map(this.engine.list({ all: true }).filter((t) => t.notionJobId).map((t) => [t.notionJobId!.replace(/-/g, ""), t]));
    let added = 0;
    for (const r of rows) {
      if (r.ticket) {
        // Notion wins on content: pick up title and check edits.
        const k = this.tickets.get(r.ticket);
        if (k && r.title && (r.title !== k.title || (r.check ?? "") !== k.check)) this.tickets.update(k.id, { title: r.title, check: r.check ?? "" });
        continue;
      }
      const job = byJob.get(String(r.jobPageId ?? "").replace(/-/g, ""));
      if (!job) continue;
      const k = this.tickets.add({ taskId: job.id, title: r.title || "Untitled", createdBy: "you", pickedUpBy: "builder", check: r.check ?? "" });
      this.tickets.update(k.id, { notionPageId: r.pageId });
      this.pending.add(`ticket:${k.id}`);
      added++;
    }
    return added;
  }

  /** Queue a board change for the next sync; a review page is published right away (and queued if that fails). */
  later(kind: "job" | "ticket" | "review", id: string, work?: () => Promise<unknown>) {
    if (!this.ready()) return;
    if (kind === "review" && work) work().catch(() => this.pending.add(`publish:${id}`));
    else this.pending.add(`${kind}:${id}`);
  }

  /** Review pages that couldn't be published when their gate opened. */
  async retryPublish(): Promise<number> {
    let n = 0;
    for (const key of [...this.pending].filter((k) => k.startsWith("publish:"))) {
      const t = this.engine.get(key.slice("publish:".length));
      try {
        if (t && ["ResearchGate", "PlanGate"].includes(t.machine.state)) await this.publishReview(t);
        this.pending.delete(key);
        n++;
      } catch {
        // Stays queued for the next sync.
      }
    }
    return n;
  }

  pendingCount() {
    return this.pending.size;
  }
}
