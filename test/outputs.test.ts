import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allowRules, discover } from "../src/repo/toolchain.js";
import { RESEARCH_WORDS, checkConfirmed, checkCoverage, checkPlanTraces, checkReadable, checkRequirements } from "../src/stages/outputs.js";

const job = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-out-"));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
};

const req = (id: string, fields = ["Source", "Acceptance", "Verify by"]) => [`### ${id}: thing`, ...fields.map((f) => `- ${f}: x`)].join("\n");
const REQS = ["# Requirements", req("R1"), req("R2"), "## Out of scope", "None", "## Open questions", "None"].join("\n");

test("requirements need a source, acceptance and a way to verify each, plus scope and questions", () => {
  assert.ok(checkRequirements(job({ "requirements.md": REQS })).ok);
  assert.deepEqual(checkRequirements(job({ "requirements.md": [req("R1", ["Source"]), req("R1")].join("\n") })).problems, [
    'R1 has no "Acceptance:" line.',
    'R1 has no "Verify by:" line.',
    "R1 appears twice.",
    'requirements.md has no "## Out of scope" section (write "None" if empty).',
    'requirements.md has no "## Open questions" section (write "None" if empty).',
  ]);
  assert.match(checkRequirements(job({})).problems[0]!, /missing/);
});

test("the plan and the requirements review must trace every requirement", () => {
  const partial = job({ "requirements.md": REQS, "plan.md": "## Traceability\n| R1 | t1 |", "review-requirements.md": "R1 R2\nVERDICT: covered" });
  assert.deepEqual(checkPlanTraces(partial).problems, ["plan.md never mentions R2, so no ticket covers it."]);
  assert.ok(!checkCoverage(partial).ok);
  const full = job({ "requirements.md": REQS, "plan.md": "## Traceability\n| R1 | t1 |\n| R2 | t2 |", "review-requirements.md": "| R1 | covered |\n| R2 | covered |\nVERDICT: covered" });
  assert.ok(checkCoverage(full).ok);
  const gaps = job({ "requirements.md": REQS, "plan.md": "## Traceability\nR1 R2", "review-requirements.md": "R1 R2\nVERDICT: gaps" });
  assert.match(checkCoverage(gaps).problems.join(), /VERDICT: covered/);
});

test("solved means every requirement has a PASS line", () => {
  const dir = (confirm: string) => job({ "requirements.md": REQS, "confirm.md": confirm });
  assert.ok(checkConfirmed(dir("| R1 | PASS |\n| R2 | PASS |\nVERDICT: solved")).ok);
  assert.deepEqual(checkConfirmed(dir("| R1 | PASS |\nVERDICT: solved")).problems, ["confirm.md has no PASS or FAIL result for R2."]);
  assert.match(checkConfirmed(dir("| R1 | PASS |\n| R2 | FAIL |\nVERDICT: solved")).problems[0]!, /R2 failed/);
});

test("the toolchain comes from the repo's own manifests, whatever the language", () => {
  const node = discover(job({ "package.json": JSON.stringify({ scripts: { test: "vitest", lint: "eslint .", typecheck: "tsc", dev: "vite" } }), "pnpm-lock.yaml": "" }));
  assert.deepEqual(
    node.commands.map((c) => c.command),
    ["pnpm test", "pnpm run lint", "pnpm run typecheck"],
  );
  const go = discover(job({ "go.mod": "module x", Makefile: "lint:\n\tgolangci-lint run\nbuild:\n\tgo build\nVAR := 1\n" }));
  assert.deepEqual(
    go.commands.map((c) => c.command),
    ["make lint", "make build", "go test ./...", "go vet ./...", "go build ./..."],
  );
  const py = discover(job({ "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n", "uv.lock": "" }));
  assert.deepEqual(allowRules(py), ["Bash(uv run pytest:*)", "Bash(uv run ruff check .:*)"]);
  const ci = discover(job({ ".github/workflows/ci.yml": "jobs:\n  t:\n    steps:\n      - run: npm ci\n      - run: |\n          npm test\n          npm run lint\n" }));
  assert.deepEqual(
    ci.ci.map((c) => c.run),
    ["npm ci", "npm test && npm run lint"],
  );
  assert.deepEqual(discover(job({ "README.md": "hi" })).commands, []);
});

test("research.md must lead with a short answer, say the next step and stay under its cap", () => {
  const good = "# Is Sapele free to use as an app name?\n\n## Answer\nProbably yes: no live mark for software.\n\n## What we checked\n| R1 | USPTO | none |\n\n## Next step\nBuy sapele.app.\n";
  assert.ok(checkReadable(job({ "research.md": good })).ok);
  const buried = "# Requirements recap\n\n## Background\nMuch context.\n\n## Answer\nYes.\n";
  assert.deepEqual(checkReadable(job({ "research.md": buried })).problems, [
    'The first section of research.md must be "## Answer": the verdict or recommendation in plain words, before anything else.',
    'research.md has no "## Next step" section saying what the person should do or decide.',
  ]);
  const rambling = `# Q\n\n## Answer\n${"word ".repeat(130)}\n\n## Next step\nGo.\n\n## Details\n${"more ".repeat(RESEARCH_WORDS)}\n\n\`\`\`\n${"code ".repeat(5000)}\n\`\`\`\n`;
  const problems = checkReadable(job({ "research.md": rambling })).problems;
  assert.match(problems[0]!, /"## Answer" is 130 words/);
  assert.match(problems[1]!, new RegExp(`is ${RESEARCH_WORDS + 136} words`));
  assert.equal(problems.length, 2, "code blocks don't count toward the cap");
  assert.match(checkReadable(job({})).problems[0]!, /missing/);
});

test("statechart labels and notes lose the extra colons mermaid can't draw, and nothing else changes", async () => {
  const { mendStatechart } = await import("../src/stages/research-check.js");
  const chart = [
    "# Statechart",
    "Intro: kept as written.",
    "```mermaid",
    "stateDiagram-v2",
    "    [*] --> Asking: you ask (R1)",
    "    Asking --> Answered: match; fresh (R2)",
    "    note right of Answered: logs its source: system or gpr (R6)",
    "    Answered --> [*]",
    "```",
  ].join("\n");
  assert.equal(
    mendStatechart(chart),
    [
      "# Statechart",
      "Intro: kept as written.",
      "```mermaid",
      "stateDiagram-v2",
      "    [*] --> Asking : you ask (R1)",
      "    Asking --> Answered : match, fresh (R2)",
      "    note right of Answered : logs its source - system or gpr (R6)",
      "    Answered --> [*]",
      "```",
    ].join("\n"),
  );
});
