import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "factory-skills-"));
process.env.FACTORY_HOME = join(dir, "home");
process.env.FACTORY_CLAUDE_DIR = join(dir, "claude");
const { CORE_SKILLS, existingInstall, install, parseSource } = await import("../src/skills.js");

const skill = (path: string) => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: x\n---\n");
};
const manifest = (path: string, homepage: string) => {
  mkdirSync(join(path, ".claude-plugin"), { recursive: true });
  writeFileSync(join(path, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p", homepage }));
};
const spec = (name: string) => CORE_SKILLS.find((s) => s.name === name)!;
const cache = (p: string) => join(dir, "claude/plugins/cache", p);

test("pstack comes from the original, a subfolder of cursor/plugins", () => {
  assert.deepEqual(parseSource(spec("pstack").source!), { repo: "https://github.com/cursor/plugins", subdir: "pstack" });
  assert.deepEqual(parseSource("https://github.com/obra/superpowers"), { repo: "https://github.com/obra/superpowers" });
});

test("reuses Claude Code's copy only when it comes from the same source, newest version first", () => {
  for (const v of ["4.0.0", "10.0.0"]) {
    skill(cache(`mkt/superpowers/${v}/skills/tdd`));
    manifest(cache(`mkt/superpowers/${v}`), "https://github.com/obra/superpowers");
  }
  skill(cache("port/pstack/1.0.0/plugins/pstack/skills/statechart"));
  manifest(cache("port/pstack/1.0.0"), "https://github.com/someone-else/pstack-claude");
  skill(join(dir, "claude/skills/graphify"));
  skill(join(dir, "claude/skills/ponytail"));
  assert.equal(existingInstall(spec("superpowers")), cache("mkt/superpowers/10.0.0"));
  assert.equal(existingInstall(spec("pstack")), undefined);
  assert.equal(existingInstall(spec("graphify")), join(dir, "claude/skills/graphify"));
  assert.equal(existingInstall(spec("ponytail")), undefined);
});

test("install links existing copies, takes a repo's subfolder, and never writes to ~/.claude", async () => {
  const lines = await install({}, { only: "superpowers" });
  assert.match(lines[0]!, /already in Claude Code/);
  assert.equal(readlinkSync(join(dir, "home/skills/superpowers")), cache("mkt/superpowers/10.0.0"));

  const repo = join(dir, "plugins-repo");
  skill(join(repo, "pstack/skills/statechart"));
  skill(join(repo, "pstack/skills/create-formal-verification-skill"));
  skill(join(repo, "other/skills/unrelated"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  const out = await install({ pstack: `file://${repo}#pstack` }, { only: "pstack" });
  assert.match(out.join("\n"), /cloned from/);
  const linked = join(dir, "home/plugin/skills");
  for (const s of ["tdd", "statechart", "create-formal-verification-skill"]) assert.ok(lstatSync(join(linked, s)).isSymbolicLink(), s);
  assert.ok(!existsSync(join(linked, "unrelated")));
  assert.ok(!existsSync(cache("mkt/pstack")));
});

test("a skill installed from an old source is replaced when its source changes", async () => {
  const other = join(dir, "pstack-fork");
  skill(join(other, "skills/fork-only"));
  await install({ pstack: other }, { only: "pstack" });
  assert.ok(existsSync(join(dir, "home/plugin/skills/fork-only")));
  const repo = join(dir, "plugins-repo");
  const out = await install({ pstack: `file://${repo}#pstack` }, { only: "pstack" });
  assert.match(out[0]!, /replacing/);
  assert.ok(!existsSync(join(dir, "home/plugin/skills/fork-only")));
  assert.ok(existsSync(join(dir, "home/plugin/skills/statechart")));
  assert.ok(existsSync(join(other, "skills/fork-only")), "the old source itself is left alone");
});
