import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setPrintRunner } from "../src/claude/print.js";
import type { Connections } from "../src/connectors/connections.js";
import { call } from "../src/daemon/client.js";
import { startEngine } from "../src/daemon/host.js";
import { Intake } from "../src/integrations/intake.js";
import { areaOf, buildDigest, digest, saveDigest } from "../src/memory/digest.js";
import { type Embedder, setEmbedder } from "../src/memory/embed.js";
import { linkDigest } from "../src/memory/graph.js";
import { memoryPart } from "../src/memory/memory.js";
import type { Project, ProjectSummary } from "../src/memory/projects.js";
import { matchTask, recall } from "../src/memory/recall.js";
import { Repos } from "../src/repo/registry.js";
import { paths } from "../src/shared/paths.js";
import { Engine } from "../src/workflow/engine.js";
import { linksIn } from "../src/workflow/links.js";
import { Store } from "../src/workflow/store.js";

const dir = mkdtempSync(join(tmpdir(), "factory-mem-"));
process.env.FACTORY_HOME = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

/** Bag of words hashed into 128 numbers: texts that share words point the same way, like a real embedding does for meaning. */
const fakeEmbedder: Embedder = {
  model: "test-bow",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Float32Array(128);
      for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % 128]! += 1;
      }
      return v;
    });
  },
};

function world() {
  const store = new Store(":memory:");
  const engine = new Engine(store);
  return { store, engine };
}

function finish(store: Store, engine: Engine, id: string, files: Record<string, string> = {}, extra: { prUrl?: string } = {}) {
  const job = paths.job(id);
  mkdirSync(job, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(job, f), text);
  if (extra.prUrl) store.updateTask(id, { prUrl: extra.prUrl });
  const t = store.task(id)!;
  store.saveMachine(id, { ...t.machine, state: "Done" });
  const done = engine.get(id)!;
  const d = buildDigest(done, engine.events(id), job);
  saveDigest(store, d);
  linkDigest(store, d, done.sourceRef);
  return d;
}

test("a finished task's digest names its area, decisions and files; the graph ties it to what it touched", () => {
  const { store, engine } = world();
  const t = engine.add({ title: "Retry failed card payments", body: "Payments that fail with a timeout should retry twice. See PAY-12.", repo: "/r/mono" });
  const d = finish(store, engine, t.id, {
    "requirements.md": "# Requirements\n### R1: Retry on timeout\n### R2: Give up after two\n",
    "research.md": "# Research\nToday nothing retries.\n## Recommendation\nWrap the gateway call in a bounded retry with jitter, in packages/billing/src/gateway.ts.\n## Risks\nDouble charges.",
    "files.txt": "packages/billing/src/gateway.ts\npackages/billing/src/gateway.test.ts\npackages/web/src/pay.tsx",
    "lessons.md": "# Lessons\n- The gateway mock lives in packages/billing/test/fakes.ts",
  });
  assert.equal(d.area, "packages/billing");
  assert.deepEqual(d.requirements, ["R1: Retry on timeout", "R2: Give up after two"]);
  assert.match(d.approach, /bounded retry with jitter/);
  assert.doesNotMatch(d.approach, /Double charges/, "only the recommendation, not the whole research");
  assert.match(d.lessons, /gateway mock/);
  assert.equal(areaOf(["README.md"]), "(root)");
  assert.equal(areaOf(["src/a/b.ts", "src/a/c.ts", "docs/x.md"]), "src/a");
  const edges = store.db.prepare("SELECT rel, dst FROM edges WHERE src = ?").all(`task:${t.id}`) as { rel: string; dst: string }[];
  assert.ok(edges.some((e) => e.rel === "touched" && e.dst === "file:packages/billing/src/gateway.ts"));
  assert.ok(edges.some((e) => e.rel === "in" && e.dst === "area:packages/billing"));
  assert.ok(edges.some((e) => e.rel === "for" && e.dst === "ticket:PAY-12"));
});

test("text points at the task it's about: its id, its pull request, its branch, its Jira key", () => {
  const { store, engine } = world();
  const a = engine.add({ title: "A", source: "jira", sourceRef: "PAY-7@2026-11-01", repo: "/r/mono" });
  const b = engine.add({ title: "B", repo: "/r/mono" });
  store.updateTask(b.id, { prUrl: "https://github.com/acme/mono/pull/41", branch: "fix/retry-payments" });
  assert.deepEqual(
    linksIn(store, "since https://github.com/acme/mono/pull/41/files merged the retries double", []).map((l) => l.taskId),
    [b.id],
  );
  assert.deepEqual(
    linksIn(store, `follow-up to PAY-7 and ${a.id}`, []).map((l) => l.taskId),
    [a.id],
  );
  assert.deepEqual(
    linksIn(store, "the fix/retry-payments branch broke staging", []).map((l) => l.taskId),
    [b.id],
  );
  assert.deepEqual(linksIn(store, "nothing to see here", []), []);
});

test("a starting task gets its lineage and the related past work in a few hundred tokens, with pointers instead of content", async () => {
  setEmbedder(fakeEmbedder);
  const { store, engine } = world();
  const repo = "/r/mono";
  const parent = engine.add({ title: "Retry failed card payments", body: "Payments that time out should retry.", repo });
  finish(store, engine, parent.id, { "files.txt": "packages/billing/src/gateway.ts", "research.md": "## Recommendation\nBounded retry in the gateway." });
  const sameFile = engine.add({ title: "Log gateway latency", body: "Add timing logs around the payment gateway call.", repo });
  finish(store, engine, sameFile.id, { "files.txt": "packages/billing/src/gateway.ts\npackages/billing/src/log.ts" });
  for (let n = 0; n < 40; n++) {
    const x = engine.add({ title: `Unrelated chore ${n}`, body: `Rename the marketing banner colours on page ${n}.`, repo });
    finish(store, engine, x.id, { "files.txt": `apps/site/page${n}.tsx` });
  }
  const elsewhere = engine.add({ title: "Retry failed card payments", body: "same words, other repo", repo: "/r/other" });
  finish(store, engine, elsewhere.id);
  const running = engine.add({ title: "Move the billing tests to vitest", repo });
  store.saveMachine(running.id, { ...store.task(running.id)!.machine, state: "Building" });

  const child = engine.add({ title: "Retries double-charge some cards", body: "After the retry change, packages/billing/src/gateway.ts charges twice on 502s.", repo, parent: parent.id });
  const r = await recall(store, store.task(child.id)!);
  const ids = r.picks.map((p) => p.taskId);
  assert.equal(ids[0], parent.id, "the task it continues comes first");
  assert.ok(ids.includes(sameFile.id), "the task that changed the same file is found through the graph");
  assert.ok(!ids.includes(elsewhere.id), "another repo's work stays out");
  assert.ok(!ids.some((id) => store.task(id)!.title.startsWith("Unrelated")), "unrelated work stays out");
  assert.match(r.markdown, /Also in progress in this repo[\s\S]*vitest/);
  assert.match(r.markdown, /factory memory show/);
  assert.ok(r.markdown.length <= 600 * 4, `history.md is ${r.markdown.length} characters; the cap is 2,400 (600 tokens)`);

  const tight = await recall(store, store.task(child.id)!, 150);
  assert.ok(tight.markdown.length <= 600 && tight.picks.length >= 1, "a smaller budget is honoured, keeping the most relevant line");
  setEmbedder(undefined);
});

test("without the embedder, retrieval still works from the graph and keywords", async () => {
  setEmbedder(null);
  const { store, engine } = world();
  const a = engine.add({ title: "Add CSV export to reports", body: "Reports need CSV export.", repo: "/r/app" });
  finish(store, engine, a.id, { "files.txt": "src/reports/export.ts" });
  const b = engine.add({ title: "Reports CSV export misses the totals row", repo: "/r/app" });
  const r = await recall(store, store.task(b.id)!);
  assert.deepEqual(
    r.picks.map((p) => p.taskId),
    [a.id],
  );
  setEmbedder(undefined);
});

test("triage: a link or a close match settles it locally; the model only sees the top candidates; work a finished task caused becomes its child", async () => {
  setEmbedder(fakeEmbedder);
  const { store, engine } = world();
  new Repos(store, engine).add({ path: mkdtempSync(join(tmpdir(), "mono-")), name: "mono" });
  const repo = new Repos(store, engine).defaultPath()!;
  const prompts: string[] = [];
  setPrintRunner(async (prompt) => {
    prompts.push(prompt);
    const ids = [...prompt.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]);
    return JSON.stringify(ids.map((id) => ({ id, action: "task", reason: "work", title: "Fix double charge", recipe: "bugfix", tags: [] })));
  });
  const intake = new Intake(store, engine, {} as Connections);

  const merged = engine.add({ title: "Retry failed card payments", body: "retry on timeout", repo });
  finish(store, engine, merged.id, { "files.txt": "packages/billing/src/gateway.ts" }, { prUrl: "https://github.com/acme/mono/pull/41" });
  const open = engine.add({ title: "Speed up the invoices page loading", body: "The invoices page takes eight seconds to load for big customers.", repo });

  const caused = intake.add({ source: "jira", sourceId: "PAY-90@1", channel: "Jira", text: "PAY-90: cards charged twice since https://github.com/acme/mono/pull/41 shipped" })!;
  const more = intake.add({ source: "slack", sourceId: "C9:1", channel: "#billing", text: "speed up the invoices page loading, it takes eight seconds to load for big customers" })!;
  const fresh = intake.add({ source: "slack", sourceId: "C9:2", channel: "#billing", text: "can we add dark mode to settings" })!;
  await intake.triage();

  const c = intake.item(caused.id)!;
  const task = engine.get(c.taskId!)!;
  assert.equal(task.parent, merged.id, "the ticket its merge caused is a child of the merged task");
  assert.equal(task.repo, repo);
  assert.equal(intake.item(more.id)!.taskId, open.id, "a near-duplicate of open work is added to it without asking a model");
  assert.ok(engine.events(open.id).some((e) => e.kind === "context_added"));
  assert.ok(intake.item(fresh.id)!.taskId && intake.item(fresh.id)!.taskId !== open.id);
  assert.equal(prompts.length, 1, "one model call for the items that needed sorting");
  assert.doesNotMatch(prompts[0]!, /Speed up the invoices page/, "the board is not pasted into the prompt");
  setEmbedder(undefined);
});

test("matchTask: sure only when one task is clearly closest", async () => {
  setEmbedder(fakeEmbedder);
  const { store, engine } = world();
  engine.add({ title: "Export reports as CSV", body: "export reports csv download button" });
  engine.add({ title: "Export invoices as PDF", body: "export invoices pdf download button" });
  const close = await matchTask(store, "export reports csv download button please");
  assert.ok(close.sure);
  const vague = await matchTask(store, "export reports invoices download button");
  assert.equal(vague.sure, undefined);
  assert.ok(vague.candidates.length >= 1 && vague.candidates.length <= 3);
  setEmbedder(undefined);
});

test("a finished task is summarised once by the cheap model without a saved session, embedded, and shown per project with its lineage and area", async () => {
  setEmbedder(fakeEmbedder);
  const calls: { prompt: string; model: string; session?: string }[] = [];
  setPrintRunner(async (prompt, opts) => {
    calls.push({ prompt, model: opts.model, session: opts.session });
    return '{"summary": "Added bounded retries to the billing gateway.", "decisions": ["Never retry a 4xx"]}';
  });
  const socket = join(dir, "mem.sock");
  const running = await startEngine({ db: ":memory:", socket, plugins: [memoryPart] });
  const { engine, store } = running;
  const c = <T>(m: string, p: unknown = {}) => call<T>(m, p, socket);
  const repoDir = mkdtempSync(join(tmpdir(), "mono-"));
  new Repos(store, engine).add({ path: repoDir, name: "mono", about: "the monorepo" });
  const a = engine.add({ title: "Retry failed card payments", repo: repoDir });
  mkdirSync(paths.job(a.id), { recursive: true });
  writeFileSync(join(paths.job(a.id), "files.txt"), "packages/billing/src/gateway.ts");
  store.saveMachine(a.id, { ...store.task(a.id)!.machine, state: "Done" });
  engine.emit("change", { kind: "task", task: engine.get(a.id) });
  const b = engine.add({ title: "Stop the double charge in billing", repo: repoDir, parent: a.id });
  for (let i = 0; i < 50 && !engine.events(a.id).some((e) => e.kind === "remembered"); i++) await new Promise((r) => setTimeout(r, 10));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, "haiku");
  assert.equal(calls[0]!.session, undefined, "no resumed session carrying old summaries into each call");
  assert.ok(calls[0]!.prompt.length < 4000, "the summary pass reads a clipped digest, not the job folder");
  assert.equal(digest(store, a.id)?.summary, "Added bounded retries to the billing gateway.");
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM vectors WHERE kind = 'digest'").get() as { n: number }).n, 1);
  assert.match(await c<string>("memory.show", { task: a.id }), /Never retry a 4xx/);
  assert.deepEqual(await c<string[]>("memory.file", { path: "gateway.ts" }), [`- ${a.id} Retry failed card payments (done ${digest(store, a.id)!.finishedAt.slice(0, 10)})`]);

  const list = await c<ProjectSummary[]>("projects.list");
  assert.equal(list[0]!.name, "mono");
  assert.equal(list[0]!.counts.total, 2);
  const p = await c<Project>("projects.get", { name: "mono" });
  assert.deepEqual(
    p.tasks.map((t) => t.id),
    [b.id, a.id],
  );
  assert.deepEqual(p.tasks.find((t) => t.id === a.id)!.children, [b.id]);
  assert.equal(p.tasks.find((t) => t.id === a.id)!.area, "packages/billing");
  assert.equal(p.tasks.find((t) => t.id === b.id)!.area, "packages/billing", "an unfinished task's area is guessed from the areas its repo already has");
  await running.stop();
  setEmbedder(undefined);
});
