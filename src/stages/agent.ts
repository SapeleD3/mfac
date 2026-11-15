import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../shared/paths.js";

export const ROLES = ["coordinator", "researcher", "planner", "requirements_review", "builder", "code_review", "security_review", "ui_review", "confirm"] as const;
export type Role = (typeof ROLES)[number];

export const OUTPUT: Record<Role, string> = {
  coordinator: "decision.md",
  researcher: "research.md",
  planner: "plan.md",
  requirements_review: "review-requirements.md",
  builder: "build.md",
  code_review: "review-code.md",
  security_review: "review-security.md",
  ui_review: "review-ui.md",
  confirm: "confirm.md",
};

/** The factory CLI as an absolute command, so hooks work without PATH (GUI apps on the Mac have none). */
export function factoryCommand(): string {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "cli.js");
  return `"${process.execPath}" "${cli}"`;
}

const READ = ["Read", "Grep", "Glob", "LS"];
const GIT_READ = ["Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git branch:*)"];
const CHECKS = [
  "Bash(npm test:*)",
  "Bash(npm run:*)",
  "Bash(npx tsc:*)",
  "Bash(npx eslint:*)",
  "Bash(npx vitest:*)",
  "Bash(npx jest:*)",
  "Bash(npx playwright:*)",
  "Bash(pnpm test:*)",
  "Bash(pnpm run:*)",
  "Bash(yarn test:*)",
  "Bash(yarn run:*)",
  "Bash(make test:*)",
  "Bash(make lint:*)",
  "Bash(cargo test:*)",
  "Bash(cargo check:*)",
  "Bash(cargo clippy:*)",
  "Bash(go test:*)",
  "Bash(go vet:*)",
  "Bash(pytest:*)",
  "Bash(ruff:*)",
];
const ALWAYS_DENY = [
  "Bash(git push:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh pr create:*)",
  "Bash(git reset --hard:*)",
  "Bash(git checkout main:*)",
  "Bash(rm -rf /:*)",
  "Bash(sudo:*)",
  "Bash(curl:*|*sh)",
  "Read(~/.ssh/**)",
  "Read(~/.aws/**)",
];

const RUNS_CHECKS: readonly Role[] = ["builder", "code_review", "security_review", "ui_review", "confirm"];

export function permissionsFor(role: Role, jobDir: string, reads: string[] = [], checks: string[] = []): { allow: string[]; deny: string[] } {
  const p = stationPermissions(role, jobDir);
  return { ...p, allow: [...p.allow, ...reads, ...(RUNS_CHECKS.includes(role) ? checks : [])] };
}

function stationPermissions(role: Role, jobDir: string): { allow: string[]; deny: string[] } {
  const job = [`Write(/${jobDir}/**)`, `Edit(/${jobDir}/**)`];
  const coord = ["Bash(factory coord:*)", "Bash(factory ticket:*)"];
  const base = { deny: ALWAYS_DENY };
  switch (role) {
    case "coordinator":
      return { ...base, allow: [...READ, ...GIT_READ, ...job, ...coord] };
    case "researcher":
      return { ...base, allow: [...READ, ...GIT_READ, ...job, "WebSearch", "WebFetch", "Bash(factory tlc:*)", "Bash(java:*)"] };
    case "planner":
      return { ...base, allow: [...READ, ...GIT_READ, ...job, "Bash(factory ticket:*)"] };
    case "requirements_review":
      return { ...base, allow: [...READ, ...GIT_READ, ...job, "Bash(factory ticket ls:*)"] };
    case "builder":
      return { ...base, allow: [...READ, ...GIT_READ, ...CHECKS, ...job, "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)", "Bash(git mv:*)", "Bash(git rm:*)", "Bash(mkdir:*)", "Bash(ls:*)"] };
    case "code_review":
    case "security_review":
    case "ui_review":
      return { ...base, allow: [...READ, ...GIT_READ, ...CHECKS, ...job, "Bash(factory ticket:*)"] };
    case "confirm":
      return { ...base, allow: [...READ, ...GIT_READ, ...CHECKS, ...job, "Bash(factory ticket:*)", "Bash(ls:*)"] };
  }
}

export function stageSettings(role: Role, jobDir: string, reads: string[] = [], checks: string[] = []) {
  const f = factoryCommand();
  return {
    permissions: permissionsFor(role, jobDir, reads, checks),
    includeCoAuthoredBy: false,
    attribution: { commit: "", pr: "" },
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: `${f} hook stop` }] }],
      PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: `${f} hook permission`, timeout: 900 }] }],
      PreToolUse: [{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: `${f} hook question` }] }],
    },
  };
}

/** A first prompt goes in as one argument; a leading "-" would read as a flag. */
const asArg = (text: string) => (text.startsWith("-") ? ` ${text}` : text);

export interface Launch {
  sessionId: string;
  resume: boolean;
  model: string;
  effort?: string;
  name: string;
  role: Role;
  jobDir: string;
  systemPromptFile: string;
  prompt?: string;
  connectorReads?: string[];
  checks?: string[];
}

export function claudeCommand(l: Launch): string[] {
  const settingsFile = join(l.jobDir, ".factory", `${l.role}.settings.json`);
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(stageSettings(l.role, l.jobDir, l.connectorReads, l.checks), null, 2));
  const plugin = join(paths.home(), "plugin");
  return [
    process.env.FACTORY_CLAUDE ?? "claude",
    ...(l.resume ? ["--resume", l.sessionId] : ["--session-id", l.sessionId]),
    "--model",
    l.model,
    ...(l.effort ? ["--effort", l.effort] : []),
    "--name",
    l.name,
    "--settings",
    settingsFile,
    "--append-system-prompt-file",
    l.systemPromptFile,
    "--add-dir",
    l.jobDir,
    ...(existsSync(plugin) ? ["--plugin-dir", plugin] : []),
    ...(l.prompt ? [asArg(l.prompt)] : []),
  ];
}
