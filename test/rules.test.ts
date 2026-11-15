import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stageSettings } from "../src/stages/agent.js";
import { stripBranchCredits } from "../src/repo/git.js";
import { checkStructure, findings, stripCredits } from "../src/repo/rules.js";

const credited = [
  "Add the intake poller",
  "",
  "Polls Slack and Jira.",
  "",
  "Co-Authored-By: Claude Opus <noreply@anthropic.com>",
  "Claude-Session: https://claude.ai/code/session_abc",
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
].join("\n");

test("credit lines are stripped and the rest of the message is kept", () => {
  assert.equal(stripCredits(credited), "Add the intake poller\n\nPolls Slack and Jira.\n");
  assert.equal(stripCredits("Co-Authored-By: Dana <dana@example.com>\n"), "Co-Authored-By: Dana <dana@example.com>\n", "people keep their credit");
});

test("the check flags agent credit and section banners, not ordinary code", () => {
  const code = ["// ---------- intake ----------", "const a = 1;", "/* ====== */", "// the cursor overlaps by a minute so edits aren't missed", "x -= 1;"].join("\n");
  assert.deepEqual(
    findings("a.ts", code).map((f) => [f.line, f.rule]),
    [
      [1, "banner"],
      [3, "banner"],
    ],
  );
  assert.deepEqual(
    findings("PR body", credited, ["credit"]).map((f) => f.line),
    [5, 6, 7],
  );
});

test("stage sessions are told not to add attribution", () => {
  const s = stageSettings("builder", "/tmp/job");
  assert.equal(s.includeCoAuthoredBy, false);
  assert.deepEqual(s.attribution, { commit: "", pr: "" });
});

test("a task branch's commit messages lose agent credit before it's pushed", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-rules-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a"), "1");
  g("add", "a");
  g("commit", "-q", "-m", "base");
  g("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(dir, "a"), "2");
  g("commit", "-qam", credited);
  const r = stripBranchCredits(dir, "main");
  assert.ok(r.ok, r.out);
  assert.equal(g("log", "-1", "--format=%B"), "Add the intake poller\n\nPolls Slack and Jira.");
  assert.equal(g("log", "-1", "--format=%s", "HEAD~1"), "base", "commits already on main are left alone");
});

test("the layout check catches loose files, unknown modules and upward imports", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-layout-"));
  const put = (f: string, text: string) => {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), text);
  };
  put("src/loose.ts", "");
  put("src/misc/thing.ts", "");
  put("src/workflow/engine.ts", 'import { a } from "../shared/paths.js";\nimport { b } from "../daemon/host.js";\n');
  put("src/cli/cli.ts", 'const m = await import("../main/plugins.js");\nimport { c } from "../workflow/engine.js";\n');
  assert.deepEqual(
    checkStructure(dir).map((f) => [f.where, f.line, f.rule]).sort(),
    [
      ["src/loose.ts", 0, "layout"],
      ["src/misc", 0, "layout"],
      ["src/workflow/engine.ts", 2, "layer"],
    ],
  );
});

test("this repo's own layout passes", () => {
  assert.deepEqual(checkStructure(process.cwd()), []);
});
