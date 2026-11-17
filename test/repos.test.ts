import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Repos, isGitRepo } from "../src/repo/registry.js";
import { Engine } from "../src/workflow/engine.js";
import { Store } from "../src/workflow/store.js";

const folder = (name: string) => {
  const p = join(mkdtempSync(join(tmpdir(), "factory-repos-")), name);
  mkdirSync(p);
  return p;
};

test("the first repo you add is the default; what each is for goes to triage; a name in the text or the default decides when the model can't", () => {
  const engine = new Engine(new Store(":memory:"));
  const repos = new Repos(engine.store, engine);
  const web = repos.add({ path: folder("web"), about: "the customer web app and checkout" });
  const api = repos.add({ path: `${folder("billing-api")}/` });
  assert.equal(web.isDefault, true);
  assert.equal(api.isDefault, false);
  assert.equal(api.path.endsWith("/"), false);

  repos.update("billing-api", { about: "invoices and payments", isDefault: true });
  assert.equal(engine.settings().defaultRepo, "billing-api");
  assert.deepEqual(repos.forPrompt(), [`- billing-api (default): invoices and payments [${api.path}]`, `- web: the customer web app and checkout [${web.path}]`]);

  assert.equal(repos.resolve("web"), web.path);
  assert.equal(repos.resolve(`${web.path}/`), web.path);
  assert.equal(repos.resolve("made-up"), undefined, "a guessed name never becomes a path");
  assert.equal(repos.mentionedIn("checkout on web is down"), web.path);
  assert.equal(repos.mentionedIn("the webhooks are slow"), undefined, "whole names only");
  assert.equal(repos.mentionedIn("move web logic into billing-api"), undefined, "two names: let the default decide");
  assert.equal(repos.defaultPath(), api.path);

  repos.remove("billing-api");
  assert.equal(engine.settings().defaultRepo, "web", "removing the default hands it to another repo");
  assert.throws(() => repos.add({ path: join(tmpdir(), "no-such-folder-here") }), /isn't a folder/);
});

test("a folder that isn't a git repo is told apart from one that is", () => {
  const plain = folder("notes");
  const repo = folder("app");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  assert.equal(isGitRepo(plain), false);
  assert.equal(isGitRepo(repo), true);
});

test("a card's work goes where its board's folder and its own text point, ahead of the default repo", async () => {
  const { Intake } = await import("../src/integrations/intake.js");
  const { saveBoards } = await import("../src/integrations/boards.js");
  const engine = new Engine(new Store(":memory:"));
  const repos = new Repos(engine.store, engine);
  const work = repos.add({ path: folder("system-automation") });
  const tools = folder("Side Projects");
  for (const name of ["sapele-app", "docs", "ledger-cli"]) mkdirSync(join(tools, name));
  saveBoards(engine, [{ url: "https://notion.so/tools", name: "Side Projects Board", status: "Ready for agent", folder: tools }]);
  const intake = new Intake(engine.store, engine, {} as never);
  const queue = async (id: string, text: string, board = "https://notion.so/tools") => {
    const item = intake.add({ source: "notion", sourceId: id, text, meta: { pageId: id, board } })!;
    (intake as unknown as { moveItem: (id: string, e: { type: string }) => void }).moveItem(item.id, { type: "pick" });
    const saved = await intake.apply(item.id, { action: "task" });
    return engine.get(saved.taskId!)!.repo;
  };
  assert.equal(await queue("c1", "Project: sapele-app\nTrademark check for the name"), join(tools, "sapele-app"), "the card names a folder under its board's folder");
  assert.equal(await queue("c2", "Tidy the docs"), tools, "nothing distinctive named: the board's folder itself");
  assert.equal(await queue("c3", "Fix the cron in system-automation"), work.path, "a registered repo named in the text wins");
  assert.equal(await queue("c4", "Something from another board", "https://notion.so/other"), work.path, "no board folder: the default");
  assert.equal(repos.folderIn("bump ledger-cli and sapele-app", [tools]), undefined, "two named: don't guess");
});
