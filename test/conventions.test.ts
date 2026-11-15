import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { conventionsMarkdown, copyLocalAgentFiles, gather, parsePrDraft, validBranch } from "../src/conventions.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-conv-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

test("a work repo's commit, PR and branch rules are all found", () => {
  const dir = repo({
    ".github/pull_request_template.md": "## Jira\n\n## Testing\n",
    "commitlint.config.js": "module.exports = { extends: ['@commitlint/config-conventional'] };",
    "package.json": JSON.stringify({ "validate-branch-name": { pattern: "^(feature|bugfix)/[A-Z]+-\\d+" } }),
    "CONTRIBUTING.md": "# Contributing\n\nBranch names use the prefix feature/ or bugfix/ and the Jira key.\nBe kind.\n",
    "CLAUDE.md": "Use pnpm.",
    ".claude/skills/release/SKILL.md": "x",
  });
  const found = gather(dir);
  const kinds = (k: string) => found.filter((c) => c.kind === k).map((c) => c.path);
  assert.deepEqual(kinds("pr"), [".github/pull_request_template.md"]);
  assert.deepEqual(kinds("commit"), ["commitlint.config.js"]);
  assert.deepEqual(kinds("branch"), ["package.json#validate-branch-name", "CONTRIBUTING.md"]);
  assert.deepEqual(kinds("instructions"), ["CLAUDE.md", ".claude/skills/"]);
  const md = conventionsMarkdown(found, ["feature/ABC-12-login"]);
  assert.match(md, /## Testing/);
  assert.match(md, /feature\/ABC-12-login/);
  assert.equal(found.find((c) => c.kind === "branch" && c.path === "CONTRIBUTING.md")?.excerpt, "Branch names use the prefix feature/ or bugfix/ and the Jira key.", "only a guide's branch lines are quoted under branch naming");
});

test("a repo with no conventions gets the factory defaults", () => {
  assert.match(conventionsMarkdown(gather(repo({ "a.ts": "" })), []), /defines none of these/);
});

test("pr.md gives the branch, title and body", () => {
  assert.deepEqual(parsePrDraft("Branch: `feature/ABC-1-x`\nTitle: feat(login): add SSO\n\n## Jira\nABC-1\n"), { branch: "feature/ABC-1-x", title: "feat(login): add SSO", body: "## Jira\nABC-1" });
  assert.deepEqual(parsePrDraft("Title: Fix it\n\nBody"), { title: "Fix it", body: "Body" });
  assert.ok(validBranch("feature/ABC-1-x"));
  assert.ok(!validBranch("bad branch..name"));
});

test("local agent settings follow into the worktree only when git ignores them", () => {
  const main = repo({ ".gitignore": ".claude/settings.local.json\n", ".claude/settings.local.json": "{}", "CLAUDE.local.md": "mine" });
  const wt = repo({ ".gitignore": ".claude/settings.local.json\n" });
  assert.deepEqual(copyLocalAgentFiles(main, wt), [".claude/settings.local.json"]);
  assert.ok(existsSync(join(wt, ".claude/settings.local.json")));
  assert.ok(!existsSync(join(wt, "CLAUDE.local.md")), "a file git would pick up is never copied in");
});
