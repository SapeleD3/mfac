import assert from "node:assert/strict";
import { test } from "node:test";
import { Tickets } from "../src/board/tickets.js";
import { NotionSync, fold } from "../src/board/notion-sync.js";
import type { RowUpdate } from "../src/connectors/notion.js";
import { Engine } from "../src/workflow/engine.js";
import { Store } from "../src/workflow/store.js";

test("the board skips dropped tasks it never showed, and one row Notion refuses doesn't hold back the rest", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store);
  const alerts: string[] = [];
  engine.on("alert", (a: { message: string }) => alerts.push(a.message));
  store.setSetting("notion_ids", { parentPageId: "p", jobsDb: "jobs", ticketsDb: "tickets", reviewsDb: "reviews" });
  const calls: string[][] = [];
  const upsert = async (_s: Store, _ids: unknown, rows: RowUpdate[]) => {
    calls.push(rows.map((r) => r.key));
    if (rows.some((r) => r.properties.Name === "Refused")) throw new Error('Notion: State "Odd" is not a valid select option');
    return rows.map((r) => ({ key: r.key, pageId: `page-${r.key}` }));
  };
  const sync = new NotionSync(store, engine, new Tickets(store, engine), { ok: () => true }, upsert);

  const kept = engine.add({ title: "Kept" });
  const refused = engine.add({ title: "Refused" });
  const dropped = engine.add({ title: "Dropped early", backlog: true });
  engine.move(dropped.id, { type: "drop" }, "human");
  for (const t of [kept, refused, dropped]) sync.later("job", t.id);

  await assert.rejects(sync.flush(), /not a valid select option/);
  assert.deepEqual(calls, [[`job:${kept.id}`, `job:${refused.id}`]], "the dropped task never reaches Notion");

  assert.equal(await sync.flush(), 1, "after a failure rows go one at a time, so the good one lands");
  assert.equal(engine.get(kept.id)!.notionJobId, `page-job:${kept.id}`);
  assert.equal(alerts.length, 0);
  await assert.rejects(sync.flush());
  assert.match(alerts[0]!, new RegExp(`Stopped syncing job:${refused.id} .* 3 failed tries`));
  const before = calls.length;
  assert.equal(await sync.flush(), 0);
  assert.equal(calls.length, before, "a row it gave up on isn't tried again");
});

test("the builder's part folds into one toggle, and a superseded ticket is dropped instead of patched", () => {
  assert.equal(fold("For the builder", "### Tickets\n\n- T1\n  - check"), '## For the builder {toggle="true"}\n\t### Tickets\n\n\t- T1\n\t  - check');

  const store = new Store(":memory:");
  const engine = new Engine(store);
  const tickets = new Tickets(store, engine);
  const t = engine.add({ title: "Count properties" });
  const first = tickets.add({ taskId: t.id, title: "Check in Langfuse", createdBy: "planner", check: "shows a log" });
  const edited = tickets.update(first.id, { check: "lookup_sources has system" });
  assert.equal(edited.check, "lookup_sources has system");
  assert.throws(() => tickets.drop(first.id, " "), /say why/);
  const dropped = tickets.drop(first.id, "the person checks it after deploy");
  assert.equal(dropped.status, "Dropped");
  assert.equal(dropped.links.dropped, "the person checks it after deploy");
  assert.equal(tickets.add({ taskId: t.id, title: "Next", createdBy: "planner" }).id, `${t.id}-T2`, "a dropped ticket keeps its number");
});
