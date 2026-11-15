import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { permissionsFor } from "../src/stages/agent.js";
import { extractJson, setPrintRunner } from "../src/claude/print.js";
import { call } from "../src/daemon/client.js";
import type { Connection } from "../src/connectors/connections.js";
import { connectorReads, isWriteTool, parseMcpList, setMcpLister, toolPrefix } from "../src/connectors/mcp.js";
import type { TaskView } from "../src/workflow/engine.js";
import { startEngine } from "../src/daemon/host.js";
import type { IntakeItem, TriageRule } from "../src/integrations/intake.js";
import { integrationsPart } from "../src/integrations/integrations.js";
import { pageIdFrom } from "../src/board/notion-sync.js";
import { inWorkingHours, parseEvery, type Routine } from "../src/integrations/routines.js";
import { ticketsPart } from "../src/board/tickets.js";

const dir = mkdtempSync(join(tmpdir(), "factory-int-"));
process.env.FACTORY_HOME = dir;
const socket = join(dir, "run", "factoryd.sock");
process.env.FACTORY_SOCKET = socket;

let mcpList = "Checking MCP server health...\n\nclaude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected\nclaude.ai Notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected\n";
setMcpLister(async () => mcpList);
const SLACK = toolPrefix("claude.ai Slack");
const slackItems: { channelId: string; ts: string; threadTs?: string; channel: string; author: string; text: string; url?: string }[] = [
  { channelId: "C1", ts: "1800000001.000100", channel: "#incidents", author: "dana", text: "checkout is down for EU users!", url: "https://s/1" },
  { channelId: "C2", ts: "1800000002.000100", channel: "#product", author: "lee", text: "can you add a CSV export to reports?", url: "https://s/2" },
  { channelId: "D1", ts: "1800000005.000100", channel: "DM", author: "sam", text: "quick q: is the release tomorrow?" },
  { channelId: "C2", ts: "1800000006.000100", channel: "#product", author: "lee", text: "someday we should rename the dashboard tabs", url: "https://s/3" },
];
const connectorCalls: { prompt: string; allowed: string[] }[] = [];
const posted: string[] = [];
const triageCalls: string[] = [];
setPrintRunner(async (prompt, opts) => {
  if (opts.allowedTools) {
    connectorCalls.push({ prompt, allowed: opts.allowedTools });
    if (prompt.startsWith("Use the Notion tools from plugin:engineering:notion"))
      return '{"error": "No plugin:engineering:notion tools are exposed in this session, so no access check or tool listing was possible. The only Notion tools available are from the claude.ai Notion connector (mcp__claude_ai_Notion__*), which I was told not to use."}';
    if (prompt.includes("list the exact names"))
      return JSON.stringify({ who: "me at Acme", tools: [`${SLACK}__slack_search_messages`, `${SLACK}__slack_read_channel`, `${SLACK}__slack_send_message`] });
    if (prompt.includes("Find Slack messages")) return `\`\`\`json\n${JSON.stringify({ items: slackItems })}\n\`\`\``;
    if (prompt.includes("Search Notion for databases")) {
      assert.equal(opts.session, "factory-mcp-notion-intake");
      return JSON.stringify({
        boards: [
          { title: "🛠️ Custom Tools Board", url: "https://notion.so/custom-tools-board" },
          { title: "Custom Tools Board archive", url: "https://notion.so/old-board" },
        ],
      });
    }
    if (prompt.includes('status is "Ready for agent"')) {
      assert.match(prompt, /^Use the .*https:\/\/notion\.so\/custom-tools-board is a Notion database/s, "polls read the board found by name, without searching again");
      assert.equal(opts.session, "factory-mcp-notion-intake", "board intake never queues behind the board sync");
      return JSON.stringify({ cards: [{ pageId: "card-1", title: "Speed up the reports page", url: "https://notion.so/card1" }] });
    }
    if (prompt.startsWith("Use the") && prompt.includes("Read the Notion page")) return JSON.stringify({ text: "It takes 8s to load." });
    if (prompt.includes("Post this exact text")) {
      posted.push(prompt);
      return '{"ok": true}';
    }
    return '{"error": "not faked"}';
  }
  triageCalls.push(opts.model);
  if (prompt.startsWith("Draft a short reply")) return "Yes, it ships tomorrow at 10.";
  const ids = [...prompt.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]);
  const text = (id: string) => prompt.split("\n").find((l) => l.includes(`"id":"${id}"`)) ?? "";
  return `Here you go:\n\`\`\`json\n${JSON.stringify(
    ids.map((id) => {
      const t = text(id!);
      if (t.includes("release")) return { id, action: "reply", reason: "a yes/no question" };
      if (t.includes("someday")) return { id, action: "backlog", reason: "real but not now", title: "Rename the dashboard tabs", recipe: "feature", tags: [] };
      if (t.includes("checkout")) return { id, action: "task", reason: "outage", title: "Fix EU checkout", recipe: "bugfix", tags: [] };
      return { id, action: "task", reason: "feature", title: "Add CSV export to reports", recipe: "feature", tags: ["ui"] };
    }),
  )}\n\`\`\``;
});

let running: Awaited<ReturnType<typeof startEngine>>;
const c = <T = unknown>(method: string, params: unknown = {}) => call<T>(method, params, socket);

before(async () => {
  running = await startEngine({ plugins: [ticketsPart, integrationsPart()] });
});
after(async () => {
  await running.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("connect finds Claude's Slack connector, checks it with one call, and remembers its tools; no token anywhere", async () => {
  const conn = await c<Connection & { server?: string }>("connections.connect", { name: "slack" });
  assert.equal(conn.status, "connected");
  assert.equal(conn.server, "claude.ai Slack");
  assert.match(conn.detail!, /me at Acme, via claude\.ai Slack/);
  assert.equal(connectorCalls.length, 1);
  assert.deepEqual(connectorCalls[0]!.allowed, [SLACK], "before the tools are known, only the Slack server's tools");
  const reads = connectorReads(running.store);
  assert.deepEqual(reads, [`${SLACK}__slack_search_messages`, `${SLACK}__slack_read_channel`]);
  assert.deepEqual(
    permissionsFor("researcher", "/tmp/job", reads).allow.filter((a) => a.startsWith("mcp__")),
    reads,
  );
});

test("Slack intake reads through the connector with read-only tools, and triage sorts it in one call", async () => {
  const r = await c<{ added: number; triaged: number }>("intake.poll", { source: "slack" });
  assert.equal(r.added, 4);
  const read = connectorCalls.at(-1)!;
  assert.deepEqual(read.allowed, [`${SLACK}__slack_search_messages`, `${SLACK}__slack_read_channel`], "intake can't post");
  assert.match(read.prompt, /Only read/);
  assert.equal(triageCalls.filter((m) => m === "haiku").length, 1, "one batched Haiku triage call");
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
  const later = items.find((i) => i.text.includes("someday"))!;
  assert.equal(tasks.find((t) => t.id === later.taskId)?.column, "Backlog", "backlog work never takes a queue slot");

  const again = await c<{ added: number }>("intake.poll", { source: "slack" });
  assert.equal(again.added, 0);
  assert.equal(triageCalls.filter((m) => m === "haiku").length, 1);
});

test("a reply in the thread a task came from becomes context for that task, with no triage call", async () => {
  const csv = (await c<IntakeItem[]>("intake.list", {})).find((i) => i.text.includes("CSV export"))!;
  const calls = triageCalls.length;
  slackItems.push({ channelId: "C2", ts: "1800000009.000100", threadTs: "1800000002.000100", channel: "#product", author: "lee", text: "also include the date column please" });
  const r = await c<{ added: number; attached?: number }>("intake.poll", { source: "slack" });
  assert.equal(r.added, 1);
  assert.equal(r.attached, 1);
  assert.equal(triageCalls.length, calls, "the thread decides it, not the model");
  const item = (await c<IntakeItem[]>("intake.list", {})).find((i) => i.text.includes("date column"))!;
  assert.equal(item.taskId, csv.taskId);
  const t = (await c<{ task: TaskView }>("task.get", { id: csv.taskId })).task;
  assert.match(t.body, /More context, from Slack #product, lee[\s\S]*date column/, "it hasn't started, so the brief takes it");
  slackItems.pop();
});

test("a drafted reply is only posted when you press Send, and only that call may use Slack's write tools", async () => {
  const draft = (await c<IntakeItem[]>("intake.list", {})).find((i) => i.status === "ReplyDrafted")!;
  assert.equal(posted.length, 0);
  const sent = await c<IntakeItem>("intake.send", { id: draft.id, text: "Yes, 10am tomorrow." });
  assert.equal(sent.status, "Replied");
  assert.equal(posted.length, 1);
  assert.match(posted[0]!, /thread 1800000005\.000100 of channel D1/);
  assert.match(posted[0]!, /Yes, 10am tomorrow\./);
  assert.deepEqual(connectorCalls.at(-1)!.allowed, [SLACK]);
  await assert.rejects(c("intake.send", { id: draft.id }), /only a drafted reply/);
});

test("overriding triage three times the same way proposes a rule, which then sorts with no tokens", async () => {
  for (let n = 0; n < 3; n++) {
    const item = running.store.db.prepare(
      "INSERT INTO intake (id, source, source_id, author, channel, text, received_at, status, triage) VALUES (?, 'slack', ?, 'bot', '#standup', 'standup notes', ?, 'ReplyDrafted', 'reply')",
    );
    item.run(`s${n}`, `x${n}`, new Date().toISOString());
    await c("intake.override", { id: `s${n}`, action: "ignore" });
  }
  const rules = await c<TriageRule[]>("rules.list");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.status, "proposed");
  assert.match(rules[0]!.description, /#standup .* ignore/);
  await c("rules.set", { id: rules[0]!.id, status: "active" });
  running.store.db
    .prepare("INSERT INTO intake (id, source, source_id, channel, text, received_at, status) VALUES ('s9', 'slack', 'x9', '#standup', 'more notes', ?, 'Inbox')")
    .run(new Date().toISOString());
  const before = triageCalls.length;
  const r = await c<{ triaged: number; tokensUsed: boolean }>("intake.triage");
  assert.deepEqual(r, { triaged: 1, tokensUsed: false });
  assert.equal(triageCalls.length, before);
});

test("an ignored item can be promoted to a task, and the statechart refuses the rest", async () => {
  running.store.db
    .prepare("INSERT INTO intake (id, source, source_id, channel, text, received_at, status) VALUES ('p1', 'slack', 'p1', '#x', 'Please look at the flaky test', ?, 'Ignored')")
    .run(new Date().toISOString());
  await assert.rejects(c("intake.override", { id: "p1", action: "reply" }), /can become a task, not a reply/);
  const promoted = await c<IntakeItem>("intake.override", { id: "p1", action: "task" });
  assert.equal(promoted.status, "Queued");
  assert.ok(promoted.taskId);
});

test("cards moved to Ready for agent on your own Notion board go straight to the queue, once", async () => {
  const none = await c<{ added: number; skipped?: string }>("intake.poll", { source: "notion" });
  assert.match(none.skipped!, /no Notion board to watch/);
  const before = triageCalls.length;
  await assert.rejects(c("notion.intake", { board: "Custom" }), /more than one Notion board matches "Custom"/);
  const r = await c<{ board: string; status: string; routine: Routine }>("notion.intake", { board: "custom tools board", wait: true });
  assert.equal(r.board, "🛠️ Custom Tools Board");
  assert.equal(r.status, "Ready for agent");
  assert.equal(r.routine.lastResult, "ok");
  assert.equal(r.routine.lastDetail, "1 card queued");
  assert.equal(r.routine.workingHours, false, "cards you chose are picked up at any hour");
  assert.equal(triageCalls.length, before, "you already chose it, so no triage call");
  const task = (await c<TaskView[]>("task.list", {})).find((t) => t.source === "notion")!;
  assert.equal(task.title, "Speed up the reports page");
  assert.equal(task.column, "Queued");
  assert.equal(task.sourceRef, "card-1");
  assert.match(task.body, /8s to load/);
  const reads = connectorCalls.length;
  assert.equal((await c<{ added: number }>("intake.poll", { source: "notion" })).added, 0, "the same card isn't queued twice");
  assert.equal(connectorCalls.length, reads + 1, "a card already queued isn't read again");
  await c("notion.intake", { board: "https://notion.so/custom-tools-board" });
  assert.equal(connectorCalls.filter((x) => x.prompt.includes("Search Notion for databases")).length, 2, "a link is used as it is");
});

test("Claude's own connector is used before a plugin's server, and a server whose tools don't load falls through to the next", async () => {
  const saved = mcpList;
  const { servers, candidates } = await import("../src/connectors/mcp.js");
  mcpList = `plugin:engineering:notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected\n${saved}`;
  await servers(true);
  assert.deepEqual(
    (await candidates(running.store, "notion")).map((x) => x.name),
    ["claude.ai Notion", "plugin:engineering:notion"],
  );
  mcpList =
    "claude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected\nplugin:engineering:notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected\nnotion: npx -y @notionhq/notion-mcp-server - ✓ Connected\n";
  await servers(true);
  const r = await c<{ added: number; found?: number }>("intake.poll", { source: "notion" });
  assert.equal(r.found, 1, "the plugin server's tools didn't load, so the next server answered");
  const notion = (await c<Connection[]>("connections.list")).find((x) => x.name === "notion")!;
  assert.equal(notion.lastCall!.ok, true);
  assert.equal(notion.lastCall!.server, "notion");
  assert.equal(notion.through!.name, "notion");
  assert.equal(notion.through!.kind, "local");
  mcpList = saved;
  await servers(true);
});

test("a pinned plugin server whose tools never load doesn't block Claude's own connector, even when claude mcp list leaves it out; connect without --server unpins", async () => {
  const saved = mcpList;
  const { servers, candidates, connectorSettings } = await import("../src/connectors/mcp.js");
  mcpList = "claude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected\nplugin:engineering:notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected\n";
  await servers(true);
  running.store.setSetting("connectors", { ...connectorSettings(running.store), server: { notion: "plugin:engineering:notion" }, pinned: { notion: true } });
  assert.deepEqual(
    (await candidates(running.store, "notion")).map((x) => x.name),
    ["plugin:engineering:notion", "claude.ai Notion"],
  );
  const r = await c<{ found?: number }>("intake.poll", { source: "notion" });
  assert.equal(r.found, 1, "the plugin's tools didn't load, so Claude's own connector answered");
  const notion = (await c<Connection[]>("connections.list")).find((x) => x.name === "notion")!;
  assert.equal(notion.lastCall!.server, "claude.ai Notion");
  assert.equal(notion.through!.kind, "claude.ai");
  const plugin = connectorCalls.filter((x) => x.prompt.includes("from plugin:engineering:notion"));
  assert.ok(plugin.length > 0 && !plugin.some((x) => /only|don't use|not use/i.test(x.prompt.split("\n")[0]!.replace("Only read", ""))), "no prompt tells the model to avoid a connector");
  await c("connections.connect", { name: "notion" });
  assert.equal(connectorSettings(running.store).pinned?.notion, false);
  assert.deepEqual(
    (await candidates(running.store, "notion")).map((x) => x.name),
    ["claude.ai Notion", "plugin:engineering:notion"],
    "unpinned, Claude's own connector goes ahead of a plugin's server",
  );
  mcpList = saved;
  await servers(true);
  assert.equal((await candidates(running.store, "notion"))[0]!.name, "claude.ai Notion");
});

test("health checks read claude mcp list with no model call: signed out is expired, gone is missing", async () => {
  const alerts: { message: string; sticky?: boolean }[] = [];
  running.engine.on("alert", (a) => alerts.push(a));
  const before = connectorCalls.length + triageCalls.length;
  mcpList = "claude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected\nclaude.ai Notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication\n";
  const { servers } = await import("../src/connectors/mcp.js");
  await servers(true);
  const [n] = await c<Connection[]>("connections.test", { name: "notion" });
  assert.equal(n!.status, "expired");
  assert.ok(alerts.some((a) => a.sticky && /Notion is expired/.test(a.message)));
  assert.ok((await c<Connection[]>("connections.alerts")).some((x) => x.name === "notion"));
  const needsLogin = await c<Connection & { server?: string }>("connections.connect", { name: "notion" });
  assert.equal(needsLogin.status, "expired");
  assert.equal(needsLogin.server, "claude.ai Notion");
  await c("connections.snooze", { name: "notion", hours: 2 });
  assert.ok(!(await c<Connection[]>("connections.alerts")).some((x) => x.name === "notion"));
  const [j] = await c<Connection[]>("connections.test", { name: "jira" });
  assert.equal(j!.status, "missing", "no Atlassian connector: optional, so no alert");
  assert.ok(!(await c<Connection[]>("connections.alerts")).some((x) => x.name === "jira"));
  mcpList += "claude.ai Atlassian: https://mcp.atlassian.com/v1/sse (HTTP) - ! Needs authentication\n";
  await servers(true);
  const [expired] = await c<Connection[]>("connections.test", { name: "jira" });
  assert.equal(expired!.status, "expired");
  assert.equal(expired!.used, false, "an Atlassian connector you never turned on for the factory isn't one you use");
  assert.ok(!alerts.some((a) => /Jira/.test(a.message)));
  assert.ok(!(await c<Connection[]>("connections.alerts")).some((x) => x.name === "jira"));
  assert.doesNotMatch((await c<Routine>("routines.run", { id: "health-check" })).lastDetail ?? "", /Jira/);
  assert.equal((await c<Connection>("connections.connect", { name: "jira" })).used, true, "factory connect jira turns it on");
  assert.ok((await c<Connection[]>("connections.alerts")).some((x) => x.name === "jira"));
  await c("connections.disconnect", { name: "jira" });
  mcpList = mcpList.replace(/claude\.ai Atlassian.*\n/, "");
  await servers(true);
  await c("connections.test", { name: "jira" });
  assert.equal(connectorCalls.length + triageCalls.length, before, "no model calls, even from connect when sign-in is needed");
  assert.equal((await c<Routine>("routines.run", { id: "health-check" })).lastResult, "warn", "an expired connector is a warning, not a green check");
});

test("disconnect stops the factory using a connector until you connect again; Claude Code and GitHub refuse", async () => {
  const d = await c<Connection>("connections.disconnect", { name: "slack" });
  assert.equal(d.status, "missing");
  assert.match(d.detail!, /turned off by you/);
  const r = await c<{ added: number; skipped?: string }>("intake.poll", { source: "slack" });
  assert.match(r.skipped!, /slack is missing/);
  assert.equal((await c<Connection>("connections.connect", { name: "slack" })).status, "connected");
  await assert.rejects(c("connections.disconnect", { name: "claude" }), /uses its own sign-in/);
});

test("routines show schedule, last result and next run, and your own run as shell commands", async () => {
  const list = await c<Routine[]>("routines.list");
  for (const id of ["health-check", "intake-slack", "intake-jira", "intake-notion", "triage", "notion-sync", "notion-pull", "cleanup", "post-merge-watch"])
    assert.ok(
      list.some((r) => r.id === id),
      id,
    );
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

test("small pieces: schedules, working hours, mcp list parsing, write tools, page links, JSON in replies", () => {
  assert.equal(parseEvery("10m"), 600);
  assert.equal(parseEvery("1d"), 86400);
  assert.throws(() => parseEvery("weekly"));
  const hours = { start: 8, end: 19, weekends: false };
  assert.equal(inWorkingHours(new Date(2026, 10, 16, 9, 30), hours), true);
  assert.equal(inWorkingHours(new Date(2026, 10, 15, 9, 30), hours), false, "Sunday");
  assert.equal(inWorkingHours(new Date(2026, 10, 16, 20), hours), false);
  assert.deepEqual(
    parseMcpList(
      "Checking MCP server health...\n\nclaude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected\nnotion: npx -y @notionhq/notion-mcp-server - ✗ Failed to connect\nclaude.ai Atlassian: https://mcp.atlassian.com/v1/sse (SSE) - ! Needs authentication",
    ),
    [
      { name: "claude.ai Slack", status: "connected", detail: "Connected", kind: "claude.ai", target: "https://mcp.slack.com/mcp (HTTP)" },
      { name: "notion", status: "failed", detail: "Failed to connect", kind: "local", target: "npx -y @notionhq/notion-mcp-server" },
      { name: "claude.ai Atlassian", status: "needs-auth", detail: "Needs authentication", kind: "claude.ai", target: "https://mcp.atlassian.com/v1/sse (SSE)" },
    ],
  );
  assert.equal(toolPrefix("claude.ai Slack"), "mcp__claude_ai_Slack");
  for (const t of ["slack_send_message", "notion-create-pages", "notion-update-page", "addCommentToJiraIssue", "editJiraIssue"]) assert.equal(isWriteTool(t), true, t);
  for (const t of ["slack_search_messages", "notion-fetch", "notion-get-comments", "notion-search", "getJiraIssue", "searchJiraIssuesUsingJql"]) assert.equal(isWriteTool(t), false, t);
  assert.equal(pageIdFrom("https://www.notion.so/acme/Factory-0123456789abcdef0123456789abcdef?pvs=4"), "01234567-89ab-cdef-0123-456789abcdef");
  assert.deepEqual(extractJson('sure: [{"a": "]"}] done'), [{ a: "]" }]);
});
