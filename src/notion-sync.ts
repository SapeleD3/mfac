import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Connections } from "./connections.js";
import type { Engine, TaskView } from "./engine.js";
import * as notion from "./notion.js";
import { paths } from "./paths.js";
import type { Store } from "./store.js";
import type { Ticket, Tickets } from "./tickets.js";

/*
 * Your Notion factory board, and the research and plan reviews.
 *
 * On first run the factory makes three databases on a page you share with it: Jobs (one per task),
 * Tickets (small units of work, tagged with their job, the stage that created them and the stage
 * picking them up) and Reviews (the research and plan docs you comment on).
 *
 * Comments live in Notion, not in the app. When you send work back, every comment on the review page,
 * with the words it's anchored to, goes to the stage as review-comments.md; the next round is added to
 * the same page, with a reply under each comment.
 *
 * factory.db stays the source of truth for status; Notion mirrors it and feeds back your comments and
 * any tickets you add there. If they disagree, the engine wins on status and Notion wins on content.
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
  private pending = new Set<string>();

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

  /** First run: three linked databases on the page you shared with the integration. */
  async setup(parentLink: string): Promise<NotionIds> {
    const parentPageId = pageIdFrom(parentLink);
    const existing = this.ids();
    if (existing.parentPageId === parentPageId && this.ready()) return existing;
    const tags = { multi_select: { options: ["learn", "urgent", "ui", "sensitive", "harden"].map((name) => ({ name })) } };
    const jobs = await notion.createDatabase(parentPageId, "Jobs", {
      Name: { title: {} },
      Task: { rich_text: {} },
      State: { select: {} },
      Column: { select: {} },
      Rounds: { rich_text: {} },
      Tags: tags,
      Source: { url: {} },
      PR: { url: {} },
    });
    const tickets = await notion.createDatabase(parentPageId, "Tickets", {
      Name: { title: {} },
      Ticket: { rich_text: {} },
      Job: { relation: { database_id: jobs.id, single_property: {} } },
      "Created by": { select: { options: STAGES.map((name) => ({ name })) } },
      "Picked up by": { select: { options: STAGES.map((name) => ({ name })) } },
      Status: { select: { options: ["Backlog", "In progress", "In review", "Blocked", "Done"].map((name) => ({ name })) } },
      Tags: tags,
      Check: { rich_text: {} },
      Links: { rich_text: {} },
    });
    const reviews = await notion.createDatabase(parentPageId, "Reviews", {
      Name: { title: {} },
      Job: { relation: { database_id: jobs.id, single_property: {} } },
      Gate: { select: { options: [{ name: "Research" }, { name: "Plan" }] } },
      Round: { number: {} },
      Verdict: { select: { options: ["Waiting", "Approved", "Sent back", "Dropped"].map((name) => ({ name })) } },
    });
    const ids = { parentPageId, jobsDb: jobs.id, ticketsDb: tickets.id, reviewsDb: reviews.id };
    this.store.setSetting("notion_ids", ids);
    for (const t of this.engine.list()) await this.mirrorJob(t).catch(() => {});
    return ids;
  }

  // ---------- mirror: engine to Notion ----------

  async mirrorJob(t: TaskView): Promise<string | undefined> {
    const ids = this.ids();
    if (!ids.jobsDb) return undefined;
    const props = {
      Name: notion.prop.title(t.title),
      Task: notion.prop.text(t.id),
      State: notion.prop.select(t.machine.state),
      Column: notion.prop.select(t.column),
      Rounds: notion.prop.text(t.rounds ?? ""),
      Tags: notion.prop.multi(t.tags),
      Source: notion.prop.url(t.sourceUrl),
      PR: notion.prop.url(t.prUrl),
    };
    if (t.notionJobId) {
      await notion.updatePage(t.notionJobId, props);
      return t.notionJobId;
    }
    const page = await notion.createPage({ database_id: ids.jobsDb }, props);
    this.engine.store.updateTask(t.id, { notionJobId: page.id });
    return page.id;
  }

  async mirrorTicket(ticket: Ticket) {
    const ids = this.ids();
    if (!ids.ticketsDb) return;
    const t = this.engine.get(ticket.taskId);
    const jobId = t?.notionJobId ?? (t ? await this.mirrorJob(t) : undefined);
    const props = {
      Name: notion.prop.title(ticket.title),
      Ticket: notion.prop.text(ticket.id),
      ...(jobId ? { Job: notion.prop.relation([jobId]) } : {}),
      "Created by": notion.prop.select(stageName(ticket.createdBy)),
      "Picked up by": notion.prop.select(stageName(ticket.pickedUpBy)),
      Status: notion.prop.select(ticket.status),
      Tags: notion.prop.multi(ticket.tags),
      Check: notion.prop.text(ticket.check),
      Links: notion.prop.text(Object.entries(ticket.links).map(([k, v]) => `${k}: ${v}`).join("\n")),
    };
    if (ticket.notionPageId) await notion.updatePage(ticket.notionPageId, props);
    else {
      const page = await notion.createPage({ database_id: ids.ticketsDb }, props);
      this.tickets.update(ticket.id, { notionPageId: page.id });
    }
  }

  // ---------- reviews ----------

  /** A research or plan gate opened: publish (or add a round to) the review page. */
  async publishReview(t: TaskView): Promise<string | undefined> {
    const ids = this.ids();
    if (!ids.reviewsDb) return undefined;
    const gate = t.machine.state === "ResearchGate" ? "Research" : t.machine.state === "PlanGate" ? "Plan" : undefined;
    if (!gate) return undefined;
    const job = paths.job(t.id);
    const read = (f: string) => (existsSync(join(job, f)) ? readFileSync(join(job, f), "utf8") : "");
    const round = (gate === "Research" ? t.machine.tries.ResearchGate : t.machine.tries.PlanGate) + 1;
    const md =
      gate === "Research"
        ? [read("research.md"), "## Statechart", read("statechart.md"), "## Formal check", read("tlc-result.md"), t.tags.includes("learn") ? read("explainer.md") : ""].join("\n\n")
        : [read("plan.md"), "## Tickets", ...this.tickets.list(t.id).map((k) => `- **${k.id}** ${k.title} (check: ${k.check || "n/a"}; picked up by ${stageName(k.pickedUpBy) ?? "?"})`)].join("\n");
    const intro = `Leave a comment on every issue, on the words it's about. Then give one overall verdict in the factory app or with factory approve, send-back or drop ${t.id}.`;
    const body = [{ type: "callout", callout: { icon: { type: "emoji", emoji: "💬" }, rich_text: notion.rich(intro) } }, ...notion.blocks(md)];
    const jobId = t.notionJobId ?? (await this.mirrorJob(t));
    const key = `review_${t.id}_${gate}`;
    const existing = this.store.setting<string | undefined>(key, undefined);
    if (existing) {
      // A new round goes on the same page, after a divider, and each open comment gets a reply.
      await notion.appendBlocks(existing, [{ type: "divider", divider: {} }, { type: "heading_1", heading_1: { rich_text: notion.rich(`Round ${round}`) } }, ...body]);
      await notion.updatePage(existing, { Round: notion.prop.number(round), Verdict: notion.prop.select("Waiting") });
      for (const c of await this.openDiscussions(existing)) await notion.replyToDiscussion(c, `Round ${round} is added below and addresses this. Check the new section and resolve this if it's handled.`).catch(() => {});
      this.engine.store.updateTask(t.id, { notionReviewId: existing });
      return existing;
    }
    const page = await notion.createPage(
      { database_id: ids.reviewsDb },
      { Name: notion.prop.title(`${t.id} ${gate}: ${t.title}`), Gate: notion.prop.select(gate), Round: notion.prop.number(round), Verdict: notion.prop.select("Waiting"), ...(jobId ? { Job: notion.prop.relation([jobId]) } : {}) },
      body,
    );
    this.store.setSetting(key, page.id);
    this.engine.store.updateTask(t.id, { notionReviewId: page.id });
    this.engine.emit("change", { kind: "task", task: this.engine.get(t.id) });
    return page.id;
  }

  private async openDiscussions(pageId: string): Promise<string[]> {
    return [...new Set((await notion.comments(pageId)).map((c) => c.discussionId))];
  }

  /** Before a sent-back stage reruns: every comment with its anchor, into review-comments.md. */
  async collectComments(t: TaskView, note: string): Promise<number> {
    const pageId = t.notionReviewId;
    if (!pageId) return 0;
    const list = await notion.comments(pageId);
    const lines = [`# Review comments on ${t.id} (round ${t.rounds ?? ""})`, "", note ? `Overall note: ${note}` : "", "", `Page: ${notion.pageUrl(pageId)}`, ""];
    for (const c of list) lines.push(`## ${c.author} (${c.createdAt.slice(0, 16).replace("T", " ")})`, c.anchor ? `> ${c.anchor.slice(0, 500)}` : "> (on the whole page)", "", c.text, "");
    writeFileSync(join(paths.job(t.id), "review-comments.md"), lines.join("\n"));
    return list.length;
  }

  async recordVerdict(t: TaskView, verdict: string) {
    if (!t.notionReviewId) return;
    await notion.updatePage(t.notionReviewId, { Verdict: notion.prop.select(verdict === "approve" ? "Approved" : verdict === "drop" ? "Dropped" : "Sent back") });
  }

  /** What the app's review tab shows: a read-only summary, the comment count and the page link. */
  async summary(taskId: string) {
    const t = this.engine.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    const job = paths.job(t.id);
    const file = t.machine.state === "PlanGate" ? "plan.md" : "research.md";
    const text = existsSync(join(job, file)) ? readFileSync(join(job, file), "utf8") : "";
    const comments = t.notionReviewId && this.connections.ok("notion") ? await notion.comments(t.notionReviewId).catch(() => []) : [];
    return {
      url: t.notionReviewId ? notion.pageUrl(t.notionReviewId) : undefined,
      comments: comments.length,
      discussions: new Set(comments.map((c) => c.discussionId)).size,
      summary: text.split("\n").filter((l) => l.trim() && !l.startsWith("```")).slice(0, 14).join("\n"),
      tlc: existsSync(join(job, "tlc-result.md")) ? readFileSync(join(job, "tlc-result.md"), "utf8") : undefined,
      statechart: existsSync(join(job, "statechart.md")) ? readFileSync(join(job, "statechart.md"), "utf8") : undefined,
    };
  }

  // ---------- pull: Notion to engine ----------

  /** Tickets you added on the board (no factory id yet) become tickets of their job, created by you. */
  async pullTickets(): Promise<number> {
    const ids = this.ids();
    if (!ids.ticketsDb) return 0;
    const rows = await notion.queryDatabase(ids.ticketsDb);
    const byJob = new Map(this.engine.list({ all: true }).filter((t) => t.notionJobId).map((t) => [t.notionJobId!.replace(/-/g, ""), t]));
    let added = 0;
    for (const r of rows) {
      const ticketId = notion.read.text(r.properties?.Ticket);
      if (ticketId) {
        // Notion wins on content: pick up title and check edits.
        const k = this.tickets.get(ticketId);
        const title = notion.read.title(r.properties?.Name);
        const check = notion.read.text(r.properties?.Check);
        if (k && (title !== k.title || check !== k.check) && title) this.tickets.update(k.id, { title, check });
        continue;
      }
      const job = byJob.get(String(r.properties?.Job?.relation?.[0]?.id ?? "").replace(/-/g, ""));
      if (!job) continue;
      const k = this.tickets.add({ taskId: job.id, title: notion.read.title(r.properties?.Name) || "Untitled", createdBy: "you", pickedUpBy: "builder", check: notion.read.text(r.properties?.Check) });
      this.tickets.update(k.id, { notionPageId: r.id });
      await notion.updatePage(r.id, { Ticket: notion.prop.text(k.id) }).catch(() => {});
      added++;
    }
    return added;
  }

  /** Mirror whatever couldn't be sent while Notion was down. */
  async flush(): Promise<number> {
    if (!this.ready() || !this.connections.ok("notion")) return 0;
    let n = 0;
    for (const key of [...this.pending]) {
      const [kind, id] = key.split(":") as [string, string];
      try {
        if (kind === "job") await this.mirrorJob(this.engine.get(id)!);
        if (kind === "ticket") await this.mirrorTicket(this.tickets.get(id)!);
        if (kind === "review") await this.publishReview(this.engine.get(id)!);
        this.pending.delete(key);
        n++;
      } catch {
        // Stays pending for the next run.
      }
    }
    return n;
  }

  /** Mirror now, or queue it for the next sync if Notion isn't reachable. */
  later(kind: "job" | "ticket" | "review", id: string, work: () => Promise<unknown>) {
    if (!this.ready()) return;
    work().catch(() => this.pending.add(`${kind}:${id}`));
  }

  pendingCount() {
    return this.pending.size;
  }
}
