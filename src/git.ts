import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { paths } from "./paths.js";

/*
 * One git worktree per task under ~/.factory/worktrees/<repo>/<task>, on its own branch, so tasks in
 * the same repo never touch each other or the person's checkout.
 */

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export const repoName = (repo: string) => basename(repo.replace(/\/+$/, ""));

export function slug(text: string, max = 40): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "task"
  );
}

/** The repo's main branch: origin's HEAD if known, else main or master. */
export function baseBranch(repo: string): string {
  const head = tryGit(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok) return head.out.replace(/^origin\//, "");
  return tryGit(repo, ["rev-parse", "--verify", "main"]).ok ? "main" : "master";
}

/** Create (or reuse) the task's worktree. Returns its path and branch. */
export function ensureWorktree(repo: string, taskId: string, title: string, base = baseBranch(repo)): { path: string; branch: string; created: boolean } {
  const path = paths.worktree(repoName(repo), taskId);
  const branch = `factory/${taskId.toLowerCase()}-${slug(title, 32)}`;
  if (existsSync(path)) return { path, branch, created: false };
  mkdirSync(dirname(path), { recursive: true });
  tryGit(repo, ["fetch", "--quiet", "origin", base]);
  const start = tryGit(repo, ["rev-parse", "--verify", `origin/${base}`]).ok ? `origin/${base}` : base;
  const exists = tryGit(repo, ["rev-parse", "--verify", branch]).ok;
  git(repo, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, start]);
  return { path, branch, created: true };
}

export function removeWorktree(repo: string, path: string) {
  if (existsSync(path)) tryGit(repo, ["worktree", "remove", "--force", path]);
  tryGit(repo, ["worktree", "prune"]);
}

/** Rebase the task's branch onto the latest base before the PR gate, so you never review a stale diff. */
export function rebaseOnBase(worktree: string, base: string): { ok: boolean; out: string } {
  tryGit(worktree, ["fetch", "--quiet", "origin", base]);
  const r = tryGit(worktree, ["rebase", `origin/${base}`]);
  if (!r.ok) tryGit(worktree, ["rebase", "--abort"]);
  return r;
}

export function diffStat(worktree: string, base: string): string {
  return tryGit(worktree, ["diff", "--stat", `origin/${base}...HEAD`]).out || tryGit(worktree, ["diff", "--stat", `${base}...HEAD`]).out;
}

/** Push the branch and open a PR with `gh`, if it's installed and signed in. */
export function openPullRequest(worktree: string, opts: { branch: string; base: string; title: string; bodyFile: string }): { url?: string; error?: string } {
  const push = tryGit(worktree, ["push", "-u", "origin", opts.branch]);
  if (!push.ok) return { error: `git push failed: ${push.out}` };
  const r = spawnSync("gh", ["pr", "create", "--base", opts.base, "--head", opts.branch, "--title", opts.title, "--body-file", opts.bodyFile], { cwd: worktree, encoding: "utf8" });
  if (r.error) return { error: "the GitHub CLI (gh) isn't installed; the branch is pushed, open the PR by hand" };
  if (r.status !== 0) {
    const existing = spawnSync("gh", ["pr", "view", opts.branch, "--json", "url", "-q", ".url"], { cwd: worktree, encoding: "utf8" });
    if (existing.status === 0 && existing.stdout.trim()) return { url: existing.stdout.trim() };
    return { error: `gh pr create failed: ${r.stderr.trim()}` };
  }
  return { url: r.stdout.trim().split("\n").pop() };
}
