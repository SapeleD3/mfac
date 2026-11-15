import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Convention {
  kind: "instructions" | "pr" | "contributing" | "commit" | "branch";
  path: string;
  excerpt?: string;
}

const PR_TEMPLATES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];
const CONTRIBUTING = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"];
const INSTRUCTIONS = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md", ".claude/settings.json"];
const COMMIT = [
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  "commitlint.config.ts",
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yml",
  ".commitlintrc.yaml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".czrc",
  ".cz.toml",
  ".cz.json",
  ".gitmessage",
  ".husky/commit-msg",
  ".githooks/commit-msg",
];
const BRANCH = [".validate-branch-namerc", ".validate-branch-namerc.json", ".validate-branch-namerc.js", ".branchlintrc", ".branchlintrc.json", ".husky/pre-push", ".githooks/pre-push"];
const HOOK_MANAGERS = ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".pre-commit-config.yaml"];
const LOCAL_ONLY = [".claude/settings.local.json", "CLAUDE.local.md"];

const read = (repo: string, f: string, max = 3000) => readFileSync(join(repo, f), "utf8").slice(0, max);

function packageJson(repo: string): Record<string, unknown> {
  try {
    return JSON.parse(read(repo, "package.json", 1_000_000)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const mentionsBranch = (text: string) =>
  text
    .split("\n")
    .filter((l) => /\bbranch(es)?\b/i.test(l) && /\b(name|naming|prefix|format|convention|feature\/|fix\/|bugfix\/|hotfix\/)/i.test(l))
    .join("\n");

export function gather(repo: string): Convention[] {
  const out: Convention[] = [];
  const add = (kind: Convention["kind"], files: string[], max?: number) => {
    for (const f of files) if (existsSync(join(repo, f))) out.push({ kind, path: f, excerpt: read(repo, f, max) });
  };
  add("instructions", INSTRUCTIONS, 1500);
  const skills = join(repo, ".claude", "skills");
  if (existsSync(skills)) out.push({ kind: "instructions", path: ".claude/skills/", excerpt: readdirSync(skills).join(", ") });
  add("pr", PR_TEMPLATES);
  const templates = join(repo, ".github", "PULL_REQUEST_TEMPLATE");
  if (existsSync(templates))
    add(
      "pr",
      readdirSync(templates)
        .filter((f) => f.endsWith(".md"))
        .map((f) => `.github/PULL_REQUEST_TEMPLATE/${f}`),
    );
  add("contributing", CONTRIBUTING, 6000);
  add("commit", COMMIT);
  add("branch", BRANCH);
  for (const f of HOOK_MANAGERS) {
    if (!existsSync(join(repo, f))) continue;
    const text = read(repo, f);
    if (/commit-msg|commit_msg/.test(text)) out.push({ kind: "commit", path: f, excerpt: text });
    if (/pre-push|branch/.test(text)) out.push({ kind: "branch", path: f, excerpt: text });
  }
  const pkg = packageJson(repo);
  if (pkg.commitlint) out.push({ kind: "commit", path: "package.json#commitlint", excerpt: JSON.stringify(pkg.commitlint, null, 2) });
  const cz = (pkg.config as Record<string, unknown> | undefined)?.commitizen;
  if (cz) out.push({ kind: "commit", path: "package.json#config.commitizen", excerpt: JSON.stringify(cz, null, 2) });
  if (pkg["validate-branch-name"]) out.push({ kind: "branch", path: "package.json#validate-branch-name", excerpt: JSON.stringify(pkg["validate-branch-name"], null, 2) });
  const template = spawnSync("git", ["config", "--get", "commit.template"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  if (template && !out.some((c) => c.path === template)) {
    const abs = template.startsWith("/") ? template : join(repo, template.replace(/^~\//, `${process.env.HOME}/`));
    if (existsSync(abs)) out.push({ kind: "commit", path: `git config commit.template (${template})`, excerpt: readFileSync(abs, "utf8").slice(0, 3000) });
  }
  for (const f of [...CONTRIBUTING, "README.md", "docs/git.md", "docs/branching.md"]) {
    if (!existsSync(join(repo, f))) continue;
    const lines = mentionsBranch(read(repo, f, 200_000));
    if (lines) out.push({ kind: "branch", path: f, excerpt: lines.slice(0, 2000) });
  }
  return out;
}

export function recentBranches(repo: string, base: string, max = 15): string[] {
  const r = spawnSync("git", ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes/origin"], { cwd: repo, encoding: "utf8" });
  return r.stdout
    .split("\n")
    .map((b) => b.replace(/^origin\//, "").trim())
    .filter((b) => b && b !== "HEAD" && b !== "origin" && b !== base && !b.startsWith("factory/"))
    .slice(0, max);
}

const TITLE: Record<Convention["kind"], string> = {
  instructions: "Agent instructions (loaded into every session already)",
  pr: "Pull request template",
  contributing: "Contributing guide",
  commit: "Commit message rules",
  branch: "Branch naming",
};

export function conventionsMarkdown(found: Convention[], branches: string[]): string {
  const lines = ["# This repo's conventions", "", "The repo's own conventions win over the factory's defaults. The one factory rule on top: never credit Claude or any agent.", ""];
  if (!found.length) lines.push("The repo defines none of these. Use the factory defaults.", "");
  for (const kind of Object.keys(TITLE) as Convention["kind"][]) {
    const of = found.filter((c) => c.kind === kind);
    if (!of.length) continue;
    lines.push(`## ${TITLE[kind]}`, "");
    for (const c of of) {
      lines.push(`### ${c.path}`, "");
      if (c.excerpt && kind !== "instructions") lines.push("````", c.excerpt.trimEnd(), "````", "");
    }
  }
  if (branches.length) lines.push("## Recent branches on origin", "", ...branches.map((b) => `- ${b}`), "");
  return lines.join("\n");
}

export function copyLocalAgentFiles(repo: string, worktree: string): string[] {
  const copied: string[] = [];
  for (const f of LOCAL_ONLY) {
    const from = join(repo, f);
    const to = join(worktree, f);
    if (!existsSync(from) || existsSync(to)) continue;
    if (spawnSync("git", ["check-ignore", "-q", f], { cwd: worktree }).status !== 0) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(f);
  }
  return copied;
}

export interface PrDraft {
  branch?: string;
  title?: string;
  body: string;
}

export function parsePrDraft(text: string): PrDraft {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const draft: PrDraft = { body: "" };
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i]!.match(/^(Branch|Title):\s*(.+)$/i);
    if (!m) break;
    if (m[1]!.toLowerCase() === "branch") draft.branch = m[2]!.trim().replace(/^`|`$/g, "");
    else draft.title = m[2]!.trim();
  }
  draft.body = lines.slice(i).join("\n").trim();
  return draft;
}

export const validBranch = (name: string) => spawnSync("git", ["check-ref-format", "--branch", name], { encoding: "utf8" }).status === 0;
