import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "factory-skills-"));
process.env.FACTORY_HOME = join(dir, "home");
process.env.FACTORY_CLAUDE_DIR = join(dir, "claude");
const { existingInstall, install } = await import("../src/skills.js");

const skill = (path: string) => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: x\n---\n");
};

test("reuses a plugin or skill Claude Code already has, newest version first", () => {
  skill(join(dir, "claude/plugins/cache/mkt/superpowers/4.0.0/skills/tdd"));
  skill(join(dir, "claude/plugins/cache/mkt/superpowers/5.0.0/skills/tdd"));
  skill(join(dir, "claude/skills/graphify"));
  assert.equal(existingInstall("superpowers"), join(dir, "claude/plugins/cache/mkt/superpowers/5.0.0"));
  assert.equal(existingInstall("graphify"), join(dir, "claude/skills/graphify"));
  assert.equal(existingInstall("ponytail"), undefined);
});

test("install links existing copies and local marketplaces without cloning or writing to ~/.claude", async () => {
  const market = join(dir, "pstack-local");
  skill(join(market, "plugins/pstack/skills/statechart"));
  skill(join(market, "plugins/pstack/skills/create-formal-verification-skill"));
  const lines = await install({ pstack: market }, { only: "superpowers" });
  assert.match(lines[0]!, /already in Claude Code/);
  await install({ pstack: market }, { only: "pstack" });
  const linked = join(dir, "home/plugin/skills");
  for (const s of ["tdd", "statechart", "create-formal-verification-skill"]) assert.ok(lstatSync(join(linked, s)).isSymbolicLink(), s);
  assert.equal(readlinkSync(join(dir, "home/skills/superpowers")), join(dir, "claude/plugins/cache/mkt/superpowers/5.0.0"));
  assert.ok(!existsSync(join(dir, "claude/plugins/cache/mkt/pstack")));
});
