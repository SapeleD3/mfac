import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../shared/paths.js";
import { stripCredits } from "./rules.js";

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

export function baseBranch(repo: string): string {
  const head = tryGit(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok) return head.out.replace(/^origin\//, "");
  return tryGit(repo, ["rev-parse", "--verify", "main"]).ok ? "main" : "master";
}

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

export function rebaseOnBase(worktree: string, base: string): { ok: boolean; out: string } {
  tryGit(worktree, ["fetch", "--quiet", "origin", base]);
  const r = tryGit(worktree, ["rebase", `origin/${base}`]);
  if (!r.ok) tryGit(worktree, ["rebase", "--abort"]);
  return r;
}

export function diffStat(worktree: string, base: string): string {
  return tryGit(worktree, ["diff", "--stat", `origin/${base}...HEAD`]).out || tryGit(worktree, ["diff", "--stat", `${base}...HEAD`]).out;
}

export function stripBranchCredits(worktree: string, base: string): { ok: boolean; out: string } {
  const range = `origin/${base}..HEAD`;
  const log = tryGit(worktree, ["log", "--format=%B%x00", range]);
  if (!log.ok || log.out.split("\0").every((m) => stripCredits(m).trim() === m.trim())) return { ok: true, out: "" };
  const filter = `"${process.execPath}" "${fileURLToPath(new URL("./rules.js", import.meta.url))}" strip`;
  const r = spawnSync("git", ["filter-branch", "-f", "--msg-filter", filter, range], { cwd: worktree, encoding: "utf8", env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" } });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export function renameBranch(worktree: string, from: string, to: string): { ok: boolean; out: string } {
  if (tryGit(worktree, ["rev-parse", "--verify", `refs/heads/${to}`]).ok) return { ok: false, out: `a branch named ${to} already exists` };
  return tryGit(worktree, ["branch", "-m", from, to]);
}

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
