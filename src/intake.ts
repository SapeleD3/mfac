import { randomUUID } from "node:crypto";
import { extractJson, runner as claudePrint } from "./claude-print.js";
import type { Connections } from "./connections.js";
import type { Engine, TaskView } from "./engine.js";
import * as jira from "./jira.js";
import * as slack from "./slack.js";
import { type Event, type State, initial, step } from "./statechart.js";
import { RECIPES, type Recipe, type Row, type Source, type Store, TAGS, type Tag, now, opt, parseJson } from "./store.js";

/*
 * Intake and triage. Polling, not webhooks (a webhook needs a public URL). Every half hour in working
 * hours a small Haiku call reads Slack and Jira through your connectors in Claude for anything newer
 * than the cursor; plain rules sort what they can; the rest goes to one batched Haiku call that sorts
 * each item into ignore, reply, task or urgent.
 *
 * Each item follows the first part of the task statechart (Inbox, Triage, Ignored, ReplyDrafted,
 * Replied, Queued), checked with the same step function.
 *
 * Self-improving: every time you overrule triage it's recorded; repeated overrides become proposed
 * rules you approve, and recent ones are shown to triage as examples.
 */

export type TriageAction = "ignore" | "reply" | "task" | "urgent";

export interface IntakeItem {
  id: string;
  source: Source;
  sourceId: string;
  author?: string;
  channel?: string;
  text: string;
  url?: string;
  receivedAt: string;
  triage?: TriageAction;
  reason?: string;
  tags: Tag[];
  draft?: string;
  status: State;
  taskId?: string;
  overridden: boolean;
  meta: Record<string, string>;
}

export interface TriageRule {
  id: string;
  description: string;
  match: { source?: string; channel?: string; author?: string; textIncludes?: string };
  action: TriageAction;
  status: "proposed" | "active" | "rejected";
  hits: number;
}

const toItem = (r: Row): IntakeItem => {
  return {
    id: String(r.id),
    source: r.source as Source,
    sourceId: String(r.source_id),
    author: opt(r.author),
    channel: opt(r.channel),
    text: String(r.text),
    url: opt(r.url),
    receivedAt: String(r.received_at),
    triage: opt(r.triage) as TriageAction | undefined,
    reason: opt(r.reason),
    tags: parseJson(r.tags, []),
    draft: opt(r.draft),
    status: r.status as State,
    taskId: opt(r.task_id),
    overridden: Number(r.overridden) === 1,
    meta: parseJson(r.meta, {}),
  };
};

const toRule = (r: Row): TriageRule => ({
  id: String(r.id),
  description: String(r.description),
  match: parseJson(r.match, {}),
  action: r.action as TriageAction,
  status: r.status as TriageRule["status"],
  hits: Number(r.hits),
});

export const matches = (rule: TriageRule, i: Pick<IntakeItem, "source" | "channel" | "author" | "text">) =>
  (!rule.match.source || rule.match.source === i.source) &&
  (!rule.match.channel || rule.match.channel === i.channel) &&
  (!rule.match.author || rule.match.author === i.author) &&
  (!rule.match.textIncludes || i.text.toLowerCase().includes(rule.match.textIncludes.toLowerCase()));

const URGENT_WORDS = /\b(outage|down|sev ?[01]|incident|p0|urgent|asap|prod(uction)? (is )?broken|data loss)\b/i;

export class Intake {
  constructor(
    private store: Store,
    private engine: Engine,
    private connections: Connections,
  ) {}

  // ---------- items ----------

  items(filter: { status?: State[]; limit?: number } = {}): IntakeItem[] {
    const rows = this.store.db.prepare("SELECT * FROM intake ORDER BY received_at DESC LIMIT ?").all(filter.limit ?? 200) as Row[];
    return rows.map(toItem).filter((i) => !filter.status || filter.status.includes(i.status));
  }

  item(id: string): IntakeItem | undefined {
    const r = this.store.db.prepare("SELECT * FROM intake WHERE id = ?").get(id) as Row | undefined;
    return r ? toItem(r) : undefined;
  }

  /** Records a new item, once per source id. Returns undefined for a duplicate. */
  add(i: { source: Source; sourceId: string; author?: string; channel?: string; text: string; url?: string; meta?: Record<string, string> }): IntakeItem | undefined {
    const id = randomUUID().slice(0, 8);
    const r = this.store.db
      .prepare("INSERT OR IGNORE INTO intake (id, source, source_id, author, channel, text, url, received_at, status, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Inbox', ?)")
      .run(id, i.source, i.sourceId, i.author ?? null, i.channel ?? null, i.text, i.url ?? null, now(), JSON.stringify(i.meta ?? {}));
    return Number(r.changes) ? this.item(id) : undefined;
  }

  /** Move an item along the intake part of the statechart; refuses what the chart doesn't allow. */
  private moveItem(id: string, event: Event, patch: Partial<{ triage: TriageAction; why: string; tags: Tag[]; draft: string; taskId: string; overridden: boolean }> = {}) {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    const r = step(initial(item.status), event);
    if (!r.ok) throw new Error(r.reason);
    this.store.db
      .prepare("UPDATE intake SET status = ?, triage = COALESCE(?, triage), reason = ?, tags = ?, draft = COALESCE(?, draft), task_id = COALESCE(?, task_id), overridden = ? WHERE id = ?")
      .run(r.machine.state, patch.triage ?? null, patch.why ?? item.reason ?? null, JSON.stringify(patch.tags ?? item.tags), patch.draft ?? null, patch.taskId ?? null, patch.overridden || item.overridden ? 1 : 0, id);
    const saved = this.item(id)!;
    this.engine.emit("intake", { item: saved });
    return saved;
  }

  // ---------- polling ----------

  private cursor(source: string): string {
    const r = this.store.db.prepare("SELECT cursor FROM cursors WHERE source = ?").get(source) as Row | undefined;
    return r ? String(r.cursor) : "";
  }

  private setCursor(source: string, cursor: string) {
    this.store.db.prepare("INSERT INTO cursors (source, cursor, at) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, at = excluded.at").run(source, cursor, now());
  }

  /** One intake run for a source: health first, then new items since the cursor. Returns how many were new. */
  async poll(source: "slack" | "jira"): Promise<{ added: number; skipped?: string }> {
    const c = await this.connections.test(source);
    if (c.status !== "connected") return { added: 0, skipped: `${source} is ${c.status}; intake waits and catches up from its cursor once it's fixed` };
    // The next run looks back a little before this one started, so nothing sent mid-run is missed;
    // duplicates are dropped by their source id.
    const started = new Date(Date.now() - 10 * 60_000).toISOString();
    let added = 0;
    if (source === "slack") {
      const since = this.cursor("slack") || new Date(Date.now() - 86_400_000).toISOString();
      const items = await slack.poll(this.store, since, { mutedChannels: this.store.setting<string[]>("slack_muted", []) });
      for (const m of items)
        if (this.add({ source: "slack", sourceId: m.sourceId, author: m.author, channel: m.channel, text: m.text, url: m.url, meta: { channelId: m.channelId, threadTs: m.threadTs ?? m.ts } })) added++;
    } else {
      const since = this.cursor("jira") || new Date(Date.now() - 7 * 86_400_000).toISOString();
      for (const i of await jira.poll(this.store, since)) {
        const meta: Record<string, string> = { key: i.key, ...(i.priority ? { priority: i.priority } : {}), ...(i.due ? { due: i.due } : {}) };
        if (this.add({ source: "jira", sourceId: i.key, author: i.reporter, channel: "Jira", text: `${i.key}: ${i.summary}\n\n${i.text}`.trim(), url: i.url, meta })) added++;
      }
    }
    this.setCursor(source, started);
    return { added };
  }

  // ---------- triage ----------

  rules(status?: TriageRule["status"]): TriageRule[] {
    return (this.store.db.prepare("SELECT * FROM triage_rules ORDER BY created_at").all() as Row[]).map(toRule).filter((r) => !status || r.status === status);
  }

  /** Sort every Inbox item. Rules first (no tokens), then one Haiku call for the rest. */
  async triage(): Promise<{ triaged: number; tokensUsed: boolean }> {
    const inbox = this.items({ status: ["Inbox"] });
    if (!inbox.length) return { triaged: 0, tokensUsed: false };
    const active = this.rules("active");
    const forModel: IntakeItem[] = [];
    for (const i of inbox) {
      this.moveItem(i.id, { type: "pick" });
      const rule = active.find((r) => matches(r, i));
      if (rule) {
        this.store.db.prepare("UPDATE triage_rules SET hits = hits + 1 WHERE id = ?").run(rule.id);
        await this.apply(i.id, { action: rule.action, why: `rule: ${rule.description}` });
      } else forModel.push(i);
    }
    if (!forModel.length) return { triaged: inbox.length, tokensUsed: false };
    const decisions = await this.askModel(forModel);
    for (const i of forModel) {
      const d = decisions.find((x) => x.id === i.id) ?? { id: i.id, action: "task" as TriageAction, reason: "triage gave no answer, so it's queued for you to look at" };
      await this.apply(i.id, { action: this.boost(i, d.action), why: d.reason, tags: d.tags, recipe: d.recipe, title: d.title, repo: d.repo });
    }
    return { triaged: inbox.length, tokensUsed: true };
  }

  /** Engine-side urgency, so a missed word in the model's answer can't bury an outage. */
  private boost(i: IntakeItem, action: TriageAction): TriageAction {
    if (action === "ignore" || action === "urgent") return action;
    const dueSoon = i.meta.due && Date.parse(i.meta.due) - Date.now() < 86_400_000;
    const vips = this.store.setting<string[]>("vip_senders", []);
    if (URGENT_WORDS.test(i.text) || dueSoon || ["Highest", "Blocker"].includes(i.meta.priority ?? "") || (i.author && vips.includes(i.author))) return action === "reply" ? "reply" : "urgent";
    return action;
  }

  private async askModel(items: IntakeItem[]) {
    const repos = (this.store.db.prepare("SELECT name, path FROM repos").all() as Row[]).map((r) => `${r.name} (${r.path})`);
    const examples = (this.store.db.prepare("SELECT source, channel, author, text, triage FROM intake WHERE overridden = 1 ORDER BY received_at DESC LIMIT 10").all() as Row[]).map(
      (r) => `- [${r.source} ${r.channel ?? ""} from ${r.author ?? "?"}] "${String(r.text).slice(0, 140)}" → ${r.triage}`,
    );
    const prompt = [
      "Sort each incoming item for a software engineer. Actions:",
      "- ignore: FYI, noise, nothing needed from them.",
      "- reply: they need to answer, but no code or investigation.",
      "- task: it needs work (research, a bug fix, a feature, a review).",
      "- urgent: like task, but outage words, a VIP, or due within a day.",
      `For task and urgent also give: title (short, imperative), recipe (${RECIPES.join(", ")}), tags from [${TAGS.join(", ")}] (learn: they want to understand something; ui: touches screens; sensitive: billing, auth, migrations, access control), and repo (one of the known repos, or null).`,
      repos.length ? `Known repos: ${repos.join("; ")}` : "No repos are registered yet; use null.",
      examples.length ? `How they corrected triage before (follow these):\n${examples.join("\n")}` : "",
      'Answer with only a JSON array: [{"id","action","reason","title","recipe","tags","repo"}].',
      "",
      "Items:",
      ...items.map((i) => JSON.stringify({ id: i.id, source: i.source, channel: i.channel, from: i.author, text: i.text.slice(0, 2000), ...i.meta })),
    ]
      .filter(Boolean)
      .join("\n");
    const model = this.engine.settings().models.triage ?? "haiku";
    try {
      const reply = await claudePrint(prompt, { model, session: "factory-triage" });
      const parsed = extractJson<{ id: string; action: TriageAction; reason?: string; title?: string; recipe?: Recipe; tags?: Tag[]; repo?: string | null }[]>(reply);
      return parsed.filter((d) => ["ignore", "reply", "task", "urgent"].includes(d.action));
    } catch (e) {
      this.engine.emit("alert", { level: "warn", message: `Triage couldn't run (${e instanceof Error ? e.message : e}); new items were queued as tasks for you to sort.` });
      return [];
    }
  }

  /** Carry out a triage decision: log an ignore, draft a reply, or queue a task. */
  async apply(id: string, d: { action: TriageAction; why?: string; tags?: Tag[]; recipe?: Recipe; title?: string; repo?: string | null; override?: boolean }): Promise<IntakeItem> {
    const item = this.item(id)!;
    const tags = [...new Set([...(d.tags ?? []).filter((t) => (TAGS as readonly string[]).includes(t)), ...(d.action === "urgent" ? (["urgent"] as Tag[]) : [])])];
    const base = { triage: d.action, why: d.why, tags, overridden: !!d.override };
    if (d.action === "ignore") return this.moveItem(id, item.status === "ReplyDrafted" ? { type: "dismiss" } : { type: "triage", as: "ignore" }, base);
    if (d.action === "reply") {
      const draft = await this.draftReply(item).catch(() => "");
      return this.moveItem(id, { type: "triage", as: "reply" }, { ...base, draft });
    }
    const repoPath = d.repo ? ((this.store.db.prepare("SELECT path FROM repos WHERE name = ? OR path = ?").get(d.repo, d.repo) as Row | undefined)?.path as string | undefined) : undefined;
    const existing = this.engine.store.taskBySource(item.source, item.sourceId);
    const task: TaskView =
      existing ? this.engine.get(existing.id)! : this.engine.add({ title: d.title || firstLine(item.text), body: `${item.text}${item.url ? `\n\nSource: ${item.url}` : ""}`, source: item.source, sourceRef: item.sourceId, sourceUrl: item.url, tags, recipe: d.recipe, repo: repoPath });
    const event: Event = item.status === "Triage" ? { type: "triage", as: "task" } : { type: "promote" };
    return this.moveItem(id, event, { ...base, taskId: task.id });
  }

  /** You overruled triage. Recorded for learning, and repeated patterns become proposed rules. */
  async override(id: string, action: TriageAction, opts: { tags?: Tag[]; title?: string } = {}): Promise<IntakeItem> {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    if (item.status === "Replied" || item.status === "Queued") throw new Error(`that item is already ${item.status}`);
    if (item.status === "Ignored" && action === "reply") throw new Error("an ignored item can become a task, not a reply");
    const saved = await this.apply(id, { action, why: "you overruled triage", tags: opts.tags, title: opts.title, override: true });
    this.learn(saved);
    return saved;
  }

  private learn(item: IntakeItem) {
    if (!item.channel || !item.triage) return;
    const same = this.store.db
      .prepare("SELECT COUNT(*) AS n FROM intake WHERE overridden = 1 AND source = ? AND channel = ? AND triage = ?")
      .get(item.source, item.channel, item.triage) as Row;
    if (Number(same.n) < 3) return;
    const exists = this.rules().some((r) => r.match.source === item.source && r.match.channel === item.channel);
    if (exists) return;
    const description = `Anything from ${item.channel} (${item.source}) is ${item.triage}`;
    this.store.db
      .prepare("INSERT INTO triage_rules (id, description, match, action, status, created_at) VALUES (?, ?, ?, ?, 'proposed', ?)")
      .run(randomUUID().slice(0, 8), description, JSON.stringify({ source: item.source, channel: item.channel }), item.triage, now());
    this.engine.emit("alert", { level: "info", message: `New triage rule proposed: "${description}". Approve it on the Rules page or with factory rules approve.` });
  }

  setRule(id: string, status: TriageRule["status"]) {
    this.store.db.prepare("UPDATE triage_rules SET status = ? WHERE id = ?").run(status, id);
    return this.rules().find((r) => r.id === id);
  }

  // ---------- replies ----------

  private async draftReply(item: IntakeItem): Promise<string> {
    const model = this.engine.settings().models.reply ?? "sonnet";
    return claudePrint(
      `Draft a short reply from me to this ${item.source} message. Plain, friendly, specific; no greeting fluff; under 80 words. If you can't answer from the message alone, ask the one question that unblocks it. Reply with only the text.\n\nFrom ${item.author ?? "someone"} in ${item.channel ?? item.source}:\n${item.text}`,
      { model, session: "factory-replies" },
    );
  }

  /** You pressed Send. The only way the factory ever posts as you. */
  async send(id: string, text?: string): Promise<IntakeItem> {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    if (item.status !== "ReplyDrafted") throw new Error(`only a drafted reply can be sent (this item is ${item.status})`);
    const body = (text ?? item.draft ?? "").trim();
    if (!body) throw new Error("the reply is empty");
    if (item.source === "slack") await slack.reply(this.store, item.meta.channelId!, item.meta.threadTs!, body);
    else if (item.source === "jira") await jira.comment(this.store, item.meta.key!, body);
    else throw new Error(`can't reply to ${item.source}`);
    return this.moveItem(id, { type: "send_reply" }, { draft: body });
  }
}

const firstLine = (t: string) => t.split("\n").find((l) => l.trim())?.slice(0, 90) ?? "Untitled";
