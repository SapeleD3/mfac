import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "factory-sessions-"));
process.env.FACTORY_HOME = join(dir, "home");
process.env.FACTORY_CLAUDE_DIR = join(dir, "claude");
const fake = join(dir, "claude.sh");
writeFileSync(fake, `#!/bin/sh\ncat >/dev/null\nnode -e 'console.log(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd() }))' -- "$@"\n`);
chmodSync(fake, 0o755);
process.env.FACTORY_CLAUDE = fake;
const { ROTATE_TURNS, pooledSessions, realRunner } = await import("../src/claude-print.js");
const { sessionName } = await import("../src/runner.js");
const { paths } = await import("../src/paths.js");

const run = async (session?: string) => JSON.parse(await realRunner("hi", { model: "haiku", session })) as { args: string[]; cwd: string };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("a job reuses one named session, in the factory's own folder, instead of a new one per call", async () => {
  const first = await run("factory-triage");
  const id = after(first.args, "--session-id")!;
  assert.equal(after(first.args, "--name"), "factory-triage");
  assert.ok(first.cwd.endsWith(join("home", "sessions")), "never in a repo");
  const second = await run("factory-triage");
  assert.equal(after(second.args, "--resume"), id);
  assert.ok(!second.args.includes("--session-id"));
  const other = await run("factory-mcp-slack");
  assert.notEqual(after(other.args, "--session-id"), id, "each job has its own session");
  assert.deepEqual(Object.keys(pooledSessions()).sort(), ["factory-mcp-slack", "factory-triage"]);
});

test("calls on the same session wait their turn", async () => {
  const all = await Promise.all([run("factory-replies"), run("factory-replies"), run("factory-replies")]);
  assert.equal(all.filter((r) => r.args.includes("--session-id")).length, 1, "one session started, the others resumed it");
});

test("a session is rotated after enough calls, and the old transcript is deleted", async () => {
  const old = pooledSessions()["factory-triage"]!.id;
  const transcript = join(dir, "claude", "projects", "-factory-sessions", `${old}.jsonl`);
  mkdirSync(join(dir, "claude", "projects", "-factory-sessions"), { recursive: true });
  writeFileSync(transcript, "{}\n");
  for (let n = pooledSessions()["factory-triage"]!.turns; n < ROTATE_TURNS; n++) await run("factory-triage");
  const rotated = await run("factory-triage");
  assert.ok(rotated.args.includes("--session-id"));
  assert.notEqual(after(rotated.args, "--session-id"), old);
  assert.ok(!existsSync(transcript));
});

test("a call with no job saves no session at all, and stage sessions are named for task and stage", async () => {
  const r = await run();
  assert.ok(r.args.includes("--no-session-persistence"));
  assert.equal(sessionName("F-012", "researcher", 1), "factory-F-012-research");
  assert.equal(sessionName("F-012", "security_review", 2), "factory-F-012-security-review-r2");
  assert.equal(sessionName("F-012", "builder", 3), "factory-F-012-build-r3");
  assert.ok(paths.sessions().startsWith(join(dir, "home")));
});
