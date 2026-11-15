import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { extractJson, setPrintRunner } from "../src/claude-print.js";
import { call } from "../src/client.js";
import type { Connection } from "../src/connections.js";
import type { TaskView } from "../src/engine.js";
import { startEngine } from "../src/factoryd.js";
import { setFetch } from "../src/http.js";
import type { IntakeItem, TriageRule } from "../src/intake.js";
import { integrationsPart } from "../src/integrations.js";
import { blocks, rich } from "../src/notion.js";
import { pageIdFrom } from "../src/notion-sync.js";
import { inWorkingHours, parseEvery, type Routine } from "../src/routines.js";
import { ticketsPart } from "../src/tickets.js";

const dir = mkdtempSync(join(tmpdir(), "factory-int-"));
process.env.FACTORY_HOME = dir;
const socket = join(dir, "run", "factoryd.sock");
process.env.FACTORY_SOCKET = socket;
process.env.FACTORY_SLACK = "xoxp-test";
process.env.FACTORY_JIRA = "jira-test";

/** Fake Slack and Jira over a fake fetch: the real clients run against canned replies. */
const slackMessages = [
  { ts: "1800000001.000100", user: "U2", username: "dana", text: "<@U1> checkout is down for EU users!", channel: { id: "C1", name: "incidents" }, permalink: "https://s/1" },
  { ts: "1800000002.000100", user: "U3", username: "lee", text: "<@U1> can you add a CSV export to reports?", channel: { id: "C2", name: "product" }, permalink: "https://s/2" },
  { ts: "1800000003.000100", user: "U1", username: "me", text: "<@U1> note to self", channel: { id: "C2", name: "product" } },
  { ts: "1800000004.000100", bot_id: "B1", text: "<@U1> deploy finished", channel: { id: "C3", name: "deploys" } },
];
const posted: unknown[] = [];
setFetch((async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.host === "slack.com") {
    const method = url.pathname.split("/").pop();
    if (method === "auth.test") return reply({ ok: true, user_id: "U1", team: "Acme", url: "https://acme.slack.com" });
    if (method === "search.messages") return reply({ ok: true, messages: { matches: slackMessages } });
    if (method === "users.conversations") return reply({ ok: true, channels: [{ id: "D1", user: "U4" }] });
    if (method === "conversations.history") return reply({ ok: true, messages: [{ ts: "1800000005.000100", user: "U4", text: "quick q: is the release tomorrow?" }] });
    if (method === "chat.postMessage") {
      posted.push(JSON.parse(String(init?.body)));
      return reply({ ok: true });
    }
  }
  return reply({ message: "not faked" }, 404);
}) as typeof fetch);

const triageCalls: string[] = [];
setPrintRunner(async (prompt, opts) => {
  triageCalls.push(opts.model);
  if (prompt.startsWith("Draft a short reply")) return "Yes, it ships tomorrow at 10.";
  const ids = [...prompt.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]);
  const text = (id: string) => prompt.split("\n").find((l) => l.includes(`"id":"${id}"`)) ?? "";
  return `Here you go:\n\`\`\`json\n${JSON.stringify(
    ids.map((id) => {
      const t = text(id!);
      if (t.includes("release")) return { id, action: "reply", reason: "a yes/no question" };
      if (t.includes("checkout")) return { id, action: "task", reason: "outage", title: "Fix EU checkout", recipe: "bugfix", tags: [] };
      return { id, action: "task", reason: "feature", title: "Add CSV export to reports", recipe: "feature", tags: ["ui"] };
    }),
  )}\n\`\`\``;
});

let running: Awaited<ReturnType<typeof startEngine>>;
const c = <T = unknown>(method: string, params: unknown = {}) => call<T>(method, params, socket);
const tester = async (name: string) => {
  if (name === "notion") throw Object.assign(new (await import("../src/http.js")).HttpError(401, "token revoked"));
  return `${name} ok`;
};

before(async () => {
  running = await startEngine({ plugins: [ticketsPart, integrationsPart({ tester: tester as never })] });
});
after(async () => {
  await running.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("Slack intake keeps what's aimed at you, triage sorts it in one call, and outages become urgent", async () => {
  const r = await c<{ added: number; triaged: number }>("intake.poll", { source: "slack" });
  assert.equal(r.added, 3, "own message and bot message dropped by rules, no tokens");
  assert.equal(triageCalls.filter((m) => m === "haiku").length, 1, "one batched Haiku call");
  const items = await c<IntakeItem[]>("intake.list", {});
  const outage = items.find((i) => i.text.includes("checkout"))!;
  assert.equal(outage.status, "Queued");
  assert.equal(outage.triage, "urgent", "the engine boosts outage words even when the model said task");
  const tasks = await c<TaskView[]>("task.list", {});
  const urgent = tasks.find((t) => t.id === outage.taskId)!;
  assert.ok(urgent.tags.includes("urgent"));
  assert.equal(tasks[0]!.id, urgent.id, "urgent jumps the queue");
  assert.equal(urgent.sourceUrl, "https://s/1");
  const reply = items.find((i) => i.text.includes("release"))!;
  assert.equal(reply.status, "ReplyDrafted");
  assert.equal(reply.draft, "Yes, it ships tomorrow at 10.");

  // Polling again finds nothing new and spends nothing.
  const again = await c<{ added: number }>("intake.poll", { source: "slack" });
  assert.equal(again.added, 0);
  assert.equal(triageCalls.filter((m) => m === "haiku").length, 1);
});

test("a drafted reply is only posted when you press Send", async () => {
  const draft = (await c<IntakeItem[]>("intake.list", {})).find((i) => i.status === "ReplyDrafted")!;
  assert.equal(posted.length, 0);
  const sent = await c<IntakeItem>("intake.send", { id: draft.id, text: "Yes, 10am tomorrow." });
  assert.equal(sent.status, "Replied");
  assert.deepEqual(posted[0], { channel: "D1", thread_ts: "1800000005.000100", text: "Yes, 10am tomorrow." });
  await assert.rejects(c("intake.send", { id: draft.id }), /only a drafted reply/);
});

test("overriding triage three times the same way proposes a rule, which then sorts with no tokens", async () => {
  for (let n = 0; n < 3; n++) {
    const item = running.store.db.prepare("INSERT INTO intake (id, source, source_id, author, channel, text, received_at, status, triage) VALUES (?, 'slack', ?, 'bot', '#standup', 'standup notes', ?, 'ReplyDrafted', 'reply')");
    item.run(`s${n}`, `x${n}`, new Date().toISOString());
    await c("intake.override", { id: `s${n}`, action: "ignore" });
  }
  const rules = await c<TriageRule[]>("rules.list");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.status, "proposed");
  assert.match(rules[0]!.description, /#standup .* ignore/);
  await c("rules.set", { id: rules[0]!.id, status: "active" });
  running.store.db.prepare("INSERT INTO intake (id, source, source_id, channel, text, received_at, status) VALUES ('s9', 'slack', 'x9', '#standup', 'more notes', ?, 'Inbox')").run(new Date().toISOString());
  const before = triageCalls.length;
  const r = await c<{ triaged: number; tokensUsed: boolean }>("intake.triage");
  assert.deepEqual(r, { triaged: 1, tokensUsed: false });
  assert.equal(triageCalls.length, before);
});

test("an ignored item can be promoted to a task, and the statechart refuses the rest", async () => {
  running.store.db.prepare("INSERT INTO intake (id, source, source_id, channel, text, received_at, status) VALUES ('p1', 'slack', 'p1', '#x', 'Please look at the flaky test', ?, 'Ignored')").run(new Date().toISOString());
  await assert.rejects(c("intake.override", { id: "p1", action: "reply" }), /can become a task, not a reply/);
  const promoted = await c<IntakeItem>("intake.override", { id: "p1", action: "task" });
  assert.equal(promoted.status, "Queued");
  assert.ok(promoted.taskId);
});

test("health checks mark a revoked token expired and raise a sticky alert", async () => {
  const alerts: { message: string; sticky?: boolean }[] = [];
  running.engine.on("alert", (a) => alerts.push(a));
  process.env.FACTORY_NOTION = "secret";
  const [n] = await c<Connection[]>("connections.test", { name: "notion" });
  assert.equal(n!.status, "expired");
  assert.ok(alerts.some((a) => a.sticky && /Notion is expired/.test(a.message)));
  assert.equal((await c<Connection[]>("connections.alerts")).map((x) => x.name).join(), "notion");
  await c("connections.snooze", { name: "notion", hours: 2 });
  assert.equal((await c<Connection[]>("connections.alerts")).length, 0);
});

test("routines show schedule, last result and next run, and your own run as shell commands", async () => {
  const list = await c<Routine[]>("routines.list");
  for (const id of ["health-check", "intake-slack", "intake-jira", "triage", "notion-sync", "cleanup", "post-merge-watch"]) assert.ok(list.some((r) => r.id === id), id);
  const ran = await c<Routine>("routines.run", { id: "notion-sync" });
  assert.equal(ran.lastResult, "skipped");
  const mine = await c<Routine>("routines.add", { name: "Nightly deps check", every: "1d", command: "echo all good" });
  const done = await c<Routine>("routines.run", { id: mine.id });
  assert.equal(done.lastResult, "ok");
  assert.equal(done.lastDetail, "all good");
  const paused = await c<Routine>("routines.update", { id: mine.id, enabled: false });
  assert.equal(paused.enabled, false);
  await assert.rejects(c("routines.remove", { id: "triage" }), /paused, not removed/);
});

test("small pieces: schedules, working hours, Notion blocks and links, JSON in replies", () => {
  assert.equal(parseEvery("10m"), 600);
  assert.equal(parseEvery("1d"), 86400);
  assert.throws(() => parseEvery("weekly"));
  const hours = { start: 8, end: 19, weekends: false };
  assert.equal(inWorkingHours(new Date(2026, 10, 16, 9, 30), hours), true);
  assert.equal(inWorkingHours(new Date(2026, 10, 15, 9, 30), hours), false, "Sunday");
  assert.equal(inWorkingHours(new Date(2026, 10, 16, 20), hours), false);
  const b = blocks("# Title\n\nSome **bold** text\nwrapped.\n\n- one\n1. first\n```mermaid\nstateDiagram-v2\n  A --> B\n```\n| a | b |\n|---|---|");
  assert.deepEqual(b.map((x) => x.type), ["heading_1", "paragraph", "bulleted_list_item", "numbered_list_item", "code", "code"]);
  assert.equal(b[4].code.language, "mermaid");
  assert.equal(rich("see [doc](https://x.y) and `code`")[1]!.text.link?.url, "https://x.y");
  assert.equal(pageIdFrom("https://www.notion.so/acme/Factory-0123456789abcdef0123456789abcdef?pvs=4"), "01234567-89ab-cdef-0123-456789abcdef");
  assert.deepEqual(extractJson('sure: [{"a": "]"}] done'), [{ a: "]" }]);
});
