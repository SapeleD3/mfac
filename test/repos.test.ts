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
