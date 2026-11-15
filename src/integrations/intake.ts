import { randomUUID } from "node:crypto";
import { extractJson, runner as claudePrint } from "../claude/print.js";
import type { Connections } from "../connectors/connections.js";
import type { Engine, TaskView } from "../workflow/engine.js";
import * as jira from "../connectors/jira.js";
import * as notion from "../connectors/notion.js";
import * as slack from "../connectors/slack.js";
import { type Candidate, matchTask } from "../memory/recall.js";
import { Repos } from "../repo/registry.js";
import { linksIn } from "../workflow/links.js";
import { type Event, type State, initial, step } from "../workflow/statechart.js";
import { RECIPES, type Recipe, type Row, type Source, type Store, TAGS, type Tag, now, opt, parseJson } from "../workflow/store.js";

export type TriageAction = "ignore" | "reply" | "task" | "urgent" | "backlog";

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
    private repos = new Repos(store, engine),
  ) {}

  items(filter: { status?: State[]; limit?: number } = {}): IntakeItem[] {
    const rows = this.store.db.prepare("SELECT * FROM intake ORDER BY received_at DESC LIMIT ?").all(filter.limit ?? 200) as Row[];
    return rows.map(toItem).filter((i) => !filter.status || filter.status.includes(i.status));
  }

  item(id: string): IntakeItem | undefined {
    const r = this.store.db.prepare("SELECT * FROM intake WHERE id = ?").get(id) as Row | undefined;
    return r ? toItem(r) : undefined;
  }

  private seen(source: Source, sourceId: string): boolean {
    return !!this.store.db.prepare("SELECT 1 FROM intake WHERE source = ? AND source_id = ?").get(source, sourceId);
  }

  add(i: { source: Source; sourceId: string; author?: string; channel?: string; text: string; url?: string; meta?: Record<string, string> }): IntakeItem | undefined {
    const id = randomUUID().slice(0, 8);
    const r = this.store.db
      .prepare("INSERT OR IGNORE INTO intake (id, source, source_id, author, channel, text, url, received_at, status, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Inbox', ?)")
      .run(id, i.source, i.sourceId, i.author ?? null, i.channel ?? null, i.text, i.url ?? null, now(), JSON.stringify(i.meta ?? {}));
    return Number(r.changes) ? this.item(id) : undefined;
  }

  private moveItem(id: string, event: Event, patch: Partial<{ triage: TriageAction; why: string; tags: Tag[]; draft: string; taskId: string; overridden: boolean }> = {}) {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    const r = step(initial(item.status), event);
    if (!r.ok) throw new Error(r.reason);
    this.store.db
      .prepare("UPDATE intake SET status = ?, triage = COALESCE(?, triage), reason = ?, tags = ?, draft = COALESCE(?, draft), task_id = COALESCE(?, task_id), overridden = ? WHERE id = ?")
      .run(
        r.machine.state,
        patch.triage ?? null,
        patch.why ?? item.reason ?? null,
        JSON.stringify(patch.tags ?? item.tags),
        patch.draft ?? null,
        patch.taskId ?? null,
        patch.overridden || item.overridden ? 1 : 0,
        id,
      );
    const saved = this.item(id)!;
    this.engine.emit("intake", { item: saved });
    return saved;
  }

  private cursor(source: string): string {
    const r = this.store.db.prepare("SELECT cursor FROM cursors WHERE source = ?").get(source) as Row | undefined;
    return r ? String(r.cursor) : "";
  }

  private setCursor(source: string, cursor: string) {
    this.store.db.prepare("INSERT INTO cursors (source, cursor, at) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, at = excluded.at").run(source, cursor, now());
  }

  async poll(source: "slack" | "jira" | "notion"): Promise<{ added: number; found?: number; skipped?: string }> {
    if (source === "notion") return this.pollBoard();
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
        if (this.add({ source: "slack", sourceId: m.sourceId, author: m.author, channel: m.channel, text: m.text, url: m.url, meta: { channelId: m.channelId, threadTs: m.threadTs ?? m.ts } }))
          added++;
    } else {
      const since = this.cursor("jira") || new Date(Date.now() - 7 * 86_400_000).toISOString();
      for (const i of await jira.poll(this.store, since)) {
        const meta: Record<string, string> = { key: i.key, ...(i.priority ? { priority: i.priority } : {}), ...(i.due ? { due: i.due } : {}) };
        if (this.add({ source: "jira", sourceId: i.sourceId, author: i.reporter, channel: "Jira", text: `${i.key}: ${i.summary}\n\n${i.text}`.trim(), url: i.url, meta })) added++;
      }
    }
    this.setCursor(source, started);
    return { added };
  }

  /** Cards you moved to the ready column are your decision already, so they skip triage and go straight to the queue. */
  private async pollBoard(): Promise<{ added: number; found?: number; skipped?: string }> {
    const { intakeBoard, intakeStatus, intakeServer } = this.engine.settings().notion;
    if (!intakeBoard) return { added: 0, skipped: "no Notion board to watch yet (Connections, or factory notion intake <board name>)" };
    const c = await this.connections.test("notion");
    if (c.status !== "connected") return { added: 0, skipped: `Notion is ${c.status}; cards wait on the board` };
    const status = intakeStatus || "Ready for agent";
    let added = 0;
    const cards = await notion.readyCards(this.store, intakeBoard, status, intakeServer);
    for (const card of cards) {
      if (this.seen("notion", card.pageId)) continue;
      const text = await notion.cardText(this.store, card.pageId, intakeServer).catch(() => "");
      const item = this.add({ source: "notion", sourceId: card.pageId, channel: "Notion board", text: `${card.title}\n\n${text}`.trim(), url: card.url, meta: { pageId: card.pageId } });
      if (!item) continue;
      this.moveItem(item.id, { type: "pick" });
      await this.apply(item.id, { action: "task", why: `you moved it to ${status} on your Notion board`, title: card.title });
      added++;
    }
    return { added, found: cards.length };
  }

  rules(status?: TriageRule["status"]): TriageRule[] {
    return (this.store.db.prepare("SELECT * FROM triage_rules ORDER BY created_at").all() as Row[]).map(toRule).filter((r) => !status || r.status === status);
  }

  /** The task an earlier message in the same Slack thread or Jira issue already became. */
  private threadTask(i: IntakeItem): TaskView | undefined {
    const q =
      i.source === "slack" && i.meta.channelId && i.meta.threadTs
        ? this.store.db
            .prepare(
              "SELECT task_id FROM intake WHERE source = 'slack' AND id != ? AND task_id IS NOT NULL AND json_extract(meta, '$.channelId') = ? AND json_extract(meta, '$.threadTs') = ? ORDER BY received_at DESC LIMIT 1",
            )
            .get(i.id, i.meta.channelId, i.meta.threadTs)
        : i.source === "jira" && i.meta.key
          ? this.store.db
              .prepare("SELECT task_id FROM intake WHERE source = 'jira' AND id != ? AND task_id IS NOT NULL AND json_extract(meta, '$.key') = ? ORDER BY received_at DESC LIMIT 1")
              .get(i.id, i.meta.key)
          : undefined;
    const id = (q as Row | undefined)?.task_id;
    return id ? this.engine.get(String(id)) : undefined;
  }

  private setMeta(id: string, patch: Record<string, string>) {
    const item = this.item(id)!;
    this.store.db.prepare("UPDATE intake SET meta = ? WHERE id = ?").run(JSON.stringify({ ...item.meta, ...patch }), id);
  }

  private label(i: IntakeItem): string {
    return i.source === "slack" ? `Slack${i.channel ? ` ${i.channel}` : ""}${i.author ? `, ${i.author}` : ""}` : i.source === "jira" ? `Jira ${i.meta.key ?? ""}`.trim() : i.source;
  }

  /** Turns an item into more context for an existing task instead of a new task. */
  attach(id: string, taskId: string, why: string): IntakeItem {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    const r = this.engine.addContext(taskId, { text: item.text, from: this.label(item), url: item.url, source: item.source, sourceRef: item.sourceId, actor: "triage" });
    const target = r.followUp?.id ?? taskId;
    const reason = r.followUp ? `${why}; ${taskId} had finished, so it became follow-up ${target}` : why;
    if (item.status === "Triage") return this.moveItem(id, { type: "triage", as: "task" }, { triage: "task", why: reason, taskId: target });
    this.store.db.prepare("UPDATE intake SET task_id = ?, reason = ? WHERE id = ?").run(target, reason, id);
    const saved = this.item(id)!;
    this.engine.emit("intake", { item: saved });
    return saved;
  }

  /** You confirm a suggested follow-up: the task triage made from the item goes to the bin if it hasn't started. */
  confirmAttach(id: string, taskId: string): IntakeItem {
    const item = this.item(id);
    if (!item) throw new Error(`no intake item ${id}`);
    if (item.taskId && item.taskId !== taskId) {
      const own = this.engine.get(item.taskId);
      if (own && !["Queued", "Backlog"].includes(own.machine.state)) throw new Error(`${own.id} has already started; add the context from its page instead`);
      if (own?.machine.state === "Queued") this.engine.move(own.id, { type: "park" }, "human", { note: `merged into ${taskId}` });
      if (own) this.engine.move(own.id, { type: "drop" }, "human", { note: `merged into ${taskId}` });
    }
    return this.attach(id, taskId, "you marked it as more input for this task");
  }

  async triage(): Promise<{ triaged: number; tokensUsed: boolean; attached?: number }> {
    const inbox = this.items({ status: ["Inbox"] });
    if (!inbox.length) return { triaged: 0, tokensUsed: false };
    const active = this.rules("active");
    const forModel: IntakeItem[] = [];
    let attached = 0;
    const candidates = new Map<string, Candidate[]>();
    for (const i of inbox) {
      this.moveItem(i.id, { type: "pick" });
      const same = this.threadTask(i);
      if (same && !finished(same)) {
        this.attach(i.id, same.id, `more in the ${i.source === "jira" ? "Jira issue" : "thread"} that started ${same.id}`);
        attached++;
        continue;
      }
      const own = this.engine.store.taskBySource(i.source, i.sourceId)?.id;
      const link = linksIn(this.store, i.text, own ? [own] : []).find((l) => this.engine.get(l.taskId));
      const match = link ? undefined : await matchTask(this.store, i.text, { exclude: own ? [own] : [] }).catch(() => undefined);
      const hit = link
        ? { id: link.taskId, why: link.why }
        : match?.sure
          ? { id: match.sure.taskId, why: `it reads like more of ${match.sure.taskId} (similarity ${match.sure.score.toFixed(2)})` }
          : undefined;
      const target = hit ? this.engine.get(hit.id) : undefined;
      if (target && hit && !finished(target)) {
        this.attach(i.id, target.id, hit.why);
        attached++;
        continue;
      }
      if (target && hit) this.setMeta(i.id, { parentTask: target.id, parentWhy: hit.why });
      else if (match?.candidates.length) candidates.set(i.id, match.candidates);
      const rule = active.find((r) => matches(r, i));
      if (rule) {
        this.store.db.prepare("UPDATE triage_rules SET hits = hits + 1 WHERE id = ?").run(rule.id);
        await this.apply(i.id, { action: rule.action, why: `rule: ${rule.description}` });
      } else forModel.push(i);
    }
    if (!forModel.length) return { triaged: inbox.length, tokensUsed: false, ...(attached ? { attached } : {}) };
    const decisions = await this.askModel(forModel, candidates);
    for (const i of forModel) {
      const d = decisions.find((x) => x.id === i.id) ?? { id: i.id, action: "task" as TriageAction, reason: "triage gave no answer, so it's queued for you to look at" };
      const related = d.followUp ? this.engine.get(d.followUp) : undefined;
      if (related && d.sure && d.action !== "ignore" && !finished(related)) {
        this.attach(i.id, related.id, d.reason ?? `more input for ${related.id}`);
        attached++;
        continue;
      }
      if (related && d.sure && finished(related)) this.setMeta(i.id, { parentTask: related.id, parentWhy: d.reason ?? `it follows on from ${related.id}` });
      else if (related) this.setMeta(i.id, { relatedTask: related.id });
      await this.apply(i.id, { action: this.boost(i, d.action), why: d.reason, tags: d.tags, recipe: d.recipe, title: d.title, repo: d.repo });
    }
    return { triaged: inbox.length, tokensUsed: true, ...(attached ? { attached } : {}) };
  }

  /** Engine-side urgency, so a missed word in the model's answer can't bury an outage. */
  private boost(i: IntakeItem, action: TriageAction): TriageAction {
    if (action === "ignore" || action === "urgent") return action;
    const dueSoon = i.meta.due && Date.parse(i.meta.due) - Date.now() < 86_400_000;
    const vips = this.store.setting<string[]>("vip_senders", []);
    if (URGENT_WORDS.test(i.text) || dueSoon || ["Highest", "Blocker"].includes(i.meta.priority ?? "") || (i.author && vips.includes(i.author))) return action === "reply" ? "reply" : "urgent";
    return action;
  }

  /** Only the few tasks each item was matched to locally are shown, never the whole board: that list is what used to cost the most. */
  private async askModel(items: IntakeItem[], candidates = new Map<string, Candidate[]>()) {
    const repos = this.repos.forPrompt();
    const shown = (i: IntakeItem) =>
      (candidates.get(i.id) ?? []).flatMap((c) => {
        const t = this.engine.get(c.taskId);
        return t ? [`${t.id} [${t.machine.state}] ${t.title.slice(0, 80)}`] : [];
      });
    const anyCandidates = items.some((i) => shown(i).length);
    const examples = (this.store.db.prepare("SELECT source, channel, author, text, triage FROM intake WHERE overridden = 1 ORDER BY received_at DESC LIMIT 10").all() as Row[]).map(
      (r) => `- [${r.source} ${r.channel ?? ""} from ${r.author ?? "?"}] "${String(r.text).slice(0, 140)}" → ${r.triage}`,
    );
    const prompt = [
      "Sort each incoming item for a software engineer. Actions:",
      "- ignore: FYI, noise, nothing needed from them.",
      "- reply: they need to answer, but no code or investigation.",
      "- task: it needs work (research, a bug fix, a feature, a review) and should be done soon.",
      "- backlog: it needs work, but isn't a priority now (a nice-to-have, an idea, no deadline, no one waiting).",
      "- urgent: like task, but outage words, a VIP, or due within a day.",
      `For task, backlog and urgent also give: title (short, imperative), recipe (${RECIPES.join(", ")}), tags from [${TAGS.join(", ")}] (learn: they want to understand something; ui: touches screens; sensitive: billing, auth, migrations, access control), and repo (the name of the known repo this work most likely belongs to, judged by what each repo is for and any repo, service or product named in the item; null if you can't tell).`,
      repos.length ? `Known repos:\n${repos.join("\n")}` : "No repos are registered yet; use null.",
      examples.length ? `How they corrected triage before (follow these):\n${examples.join("\n")}` : "",
      "Every task is researched before it is planned, so pick the recipe by the outcome they want. recipe research only when they want an answer, findings or a recommendation and nothing in the item asks for a change; the task stops once the research is approved. If a fix, feature or change is asked for or clearly implied, use bugfix or feature even when it needs investigating first.",
      anyCandidates
        ? "Some items list candidates: existing tasks that look related. If an item is more input for one of them (a reply about it, a correction, a new detail, the same problem again, or work its result caused), set followUp to that id, and sure to true only when it clearly is. Otherwise followUp is null."
        : "",
      'Answer with only a JSON array: [{"id","action","reason","title","recipe","tags","repo","followUp","sure"}].',
      "",
      "Items:",
      ...items.map((i) => {
        const { relatedTask: _r, parentTask: _p, parentWhy: _w, ...meta } = i.meta;
        const c = shown(i);
        return JSON.stringify({ id: i.id, source: i.source, channel: i.channel, from: i.author, text: i.text.slice(0, 2000), ...meta, ...(c.length ? { candidates: c } : {}) });
      }),
    ]
      .filter(Boolean)
      .join("\n");
    const model = this.engine.settings().models.triage ?? "haiku";
    try {
      const reply = await claudePrint(prompt, { model, effort: this.engine.settings().efforts.triage, session: "factory-triage" });
      const parsed =
        extractJson<{ id: string; action: TriageAction; reason?: string; title?: string; recipe?: Recipe; tags?: Tag[]; repo?: string | null; followUp?: string | null; sure?: boolean }[]>(reply);
      return parsed.filter((d) => ["ignore", "reply", "task", "urgent", "backlog"].includes(d.action));
    } catch (e) {
      this.engine.emit("alert", { level: "warn", message: `Triage couldn't run (${e instanceof Error ? e.message : e}); new items were queued as tasks for you to sort.` });
      return [];
    }
  }

  async apply(id: string, d: { action: TriageAction; why?: string; tags?: Tag[]; recipe?: Recipe; title?: string; repo?: string | null; override?: boolean }): Promise<IntakeItem> {
    const item = this.item(id)!;
    const tags = [...new Set([...(d.tags ?? []).filter((t) => (TAGS as readonly string[]).includes(t)), ...(d.action === "urgent" ? (["urgent"] as Tag[]) : [])])];
    const base = { triage: d.action, why: d.why, tags, overridden: !!d.override };
    if (d.action === "ignore") return this.moveItem(id, item.status === "ReplyDrafted" ? { type: "dismiss" } : { type: "triage", as: "ignore" }, base);
    if (d.action === "reply") {
      const draft = await this.draftReply(item).catch(() => "");
      return this.moveItem(id, { type: "triage", as: "reply" }, { ...base, draft });
    }
    const parentRepo = item.meta.parentTask ? this.engine.get(item.meta.parentTask)?.repo : undefined;
    const repoPath = this.repos.resolve(d.repo) ?? parentRepo ?? this.repos.mentionedIn(item.text) ?? this.repos.defaultPath();
    const existing = this.engine.store.taskBySource(item.source, item.sourceId);
    const task: TaskView = existing
      ? this.engine.get(existing.id)!
      : this.engine.add({
          title: d.title || firstLine(item.text),
          body: `${item.text}${item.url ? `\n\nSource: ${item.url}` : ""}`,
          source: item.source,
          sourceRef: item.sourceId,
          sourceUrl: item.url,
          tags,
          recipe: d.recipe,
          repo: repoPath,
          backlog: d.action === "backlog",
          parent: item.meta.parentTask,
        });
    const event: Event = item.status === "Triage" ? { type: "triage", as: d.action === "backlog" ? "backlog" : "task" } : { type: "promote" };
    return this.moveItem(id, event, { ...base, taskId: task.id });
  }

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
    const same = this.store.db.prepare("SELECT COUNT(*) AS n FROM intake WHERE overridden = 1 AND source = ? AND channel = ? AND triage = ?").get(item.source, item.channel, item.triage) as Row;
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

  private async draftReply(item: IntakeItem): Promise<string> {
    const model = this.engine.settings().models.reply ?? "sonnet";
    return claudePrint(
      `Draft a short reply from me to this ${item.source} message. Plain, friendly, specific; no greeting fluff; under 80 words. If you can't answer from the message alone, ask the one question that unblocks it. Reply with only the text.\n\nFrom ${item.author ?? "someone"} in ${item.channel ?? item.source}:\n${item.text}`,
      { model, effort: this.engine.settings().efforts.reply, session: "factory-replies" },
    );
  }

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

const finished = (t: TaskView) => t.machine.state === "Done" || t.machine.state === "Dropped";

const firstLine = (t: string) =>
  t
    .split("\n")
    .find((l) => l.trim())
    ?.slice(0, 90) ?? "Untitled";
