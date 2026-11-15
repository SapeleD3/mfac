import { execFile } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { paths } from "./paths.js";

/*
 * The factory's own skills. Sessions get them through `--plugin-dir ~/.factory/plugin`; your own
 * ~/.claude is never written. Each skill comes from a git repo or a local folder: a repo with a skills/
 * folder (or a marketplace's plugins/<name>/skills/) contributes every skill in it, and a folder with a
 * SKILL.md is one skill. Nothing is installed twice: if Claude Code already has the plugin or skill
 * (~/.claude/plugins/cache or ~/.claude/skills), the factory links to that copy instead of cloning.
 */

export interface SkillSpec {
  name: string;
  description: string;
  /** A git URL or a local folder. Unknown until you set it with `factory skills add`. */
  source?: string;
  /** For repos that keep the skill in a single file elsewhere (graphify ships graphify/skill.md). */
  skillFile?: string;
}

export const CORE_SKILLS: SkillSpec[] = [
  { name: "superpowers", description: "planning, TDD and debugging workflows", source: "https://github.com/obra/superpowers" },
  // Lauren Tan's pstack (github.com/cursor/plugins/tree/main/pstack), ported to Claude Code's plugin layout.
  { name: "pstack", description: "statechart and create-formal-verification (the research rule)", source: "https://github.com/michael-denyer/pstack-claude" },
  { name: "ponytail", description: "Mo's working conventions", source: "https://github.com/DietrichGebert/ponytail" },
  // A Python CLI as well as a skill: setup.sh installs the CLI with uv; the skill text comes from the repo.
  { name: "graphify", description: "knowledge graphs of code and docs for research", source: "https://github.com/Graphify-Labs/graphify", skillFile: "graphify/skill.md" },
  { name: "design-principles", description: "the design-principles knowledge base outputs cite" },
];

export interface SkillStatus extends SkillSpec {
  status: "ok" | "missing" | "no-source";
  version?: string;
  provides: string[];
}

const pluginDir = () => join(paths.home(), "plugin");
const srcDir = (name: string) => join(paths.skills(), name);

const run = (cmd: string, args: string[], cwd?: string) =>
  new Promise<{ ok: boolean; out: string }>((done) =>
    execFile(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 }, (err, stdout, stderr) => done({ ok: !err, out: String(stdout || stderr || err?.message || "").trim() })),
  );

export function specs(saved: Record<string, string> = {}): SkillSpec[] {
  const list = CORE_SKILLS.map((s) => ({ ...s, source: saved[s.name] ?? s.source }));
  for (const [name, source] of Object.entries(saved)) if (!list.some((s) => s.name === name)) list.push({ name, description: "added by you", source });
  return list;
}

const skillsIn = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(dir, d.name, "SKILL.md")))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
    : [];

/** Which skill folders a source provides: skills/* in a plugin repo, plugins/*\/skills/* in a marketplace, or the folder itself. */
function provided(dir: string, name: string): { name: string; path: string }[] {
  if (existsSync(join(dir, ".factory-skill", "SKILL.md"))) return [{ name, path: join(dir, ".factory-skill") }];
  if (existsSync(join(dir, "skills"))) return skillsIn(join(dir, "skills"));
  if (existsSync(join(dir, "plugins"))) {
    return readdirSync(join(dir, "plugins"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => skillsIn(join(dir, "plugins", d.name, "skills")));
  }
  if (existsSync(join(dir, "SKILL.md"))) return [{ name, path: dir }];
  // A knowledge base without a SKILL.md is still made available, as a skill folder of documents.
  return existsSync(dir) ? [{ name, path: dir }] : [];
}

export async function status(saved: Record<string, string> = {}): Promise<SkillStatus[]> {
  const out: SkillStatus[] = [];
  for (const s of specs(saved)) {
    const dir = srcDir(s.name);
    if (!existsSync(dir)) {
      out.push({ ...s, status: s.source ? "missing" : "no-source", provides: [] });
      continue;
    }
    const v = existsSync(join(dir, ".git")) ? (await run("git", ["rev-parse", "--short", "HEAD"], dir)).out : "local";
    out.push({ ...s, status: "ok", version: v, provides: provided(dir, s.name).map((p) => p.name) });
  }
  return out;
}

/**
 * An install Claude Code already has: a plugin in ~/.claude/plugins/cache/<marketplace>/<name>/<version>,
 * or a skill in ~/.claude/skills/<name>. Only read, never written; the factory links to it.
 */
export function existingInstall(name: string, claudeDir = process.env.FACTORY_CLAUDE_DIR ?? join(homedir(), ".claude")): string | undefined {
  const cache = join(claudeDir, "plugins", "cache");
  if (existsSync(cache)) {
    for (const market of readdirSync(cache)) {
      const plugin = join(cache, market, name);
      if (!existsSync(plugin)) continue;
      const versions = readdirSync(plugin).filter((v) => provided(join(plugin, v), name).length).sort();
      if (versions.length) return join(plugin, versions[versions.length - 1]!);
    }
  }
  const skill = join(claudeDir, "skills", name);
  return existsSync(join(skill, "SKILL.md")) ? skill : undefined;
}

/** For single-file skills, puts the file where Claude Code expects it: <dir>/.factory-skill/SKILL.md. */
function placeSkillFile(dir: string, s: SkillSpec) {
  if (!s.skillFile || !existsSync(join(dir, s.skillFile))) return;
  mkdirSync(join(dir, ".factory-skill"), { recursive: true });
  copyFileSync(join(dir, s.skillFile), join(dir, ".factory-skill", "SKILL.md"));
}

function ensurePlugin() {
  mkdirSync(join(pluginDir(), ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir(), "skills"), { recursive: true });
  const manifest = join(pluginDir(), ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify({ name: "factory", version: "0.1.0", description: "The factory's own skills, for its sessions only." }, null, 2));
}

/** Links every installed source's skills into the plugin folder, replacing stale links. */
export function relink(saved: Record<string, string> = {}) {
  ensurePlugin();
  const dest = join(pluginDir(), "skills");
  for (const entry of readdirSync(dest)) if (lstatSync(join(dest, entry)).isSymbolicLink()) rmSync(join(dest, entry));
  for (const s of specs(saved)) {
    for (const p of provided(srcDir(s.name), s.name)) if (!existsSync(join(dest, p.name))) symlinkSync(p.path, join(dest, p.name));
  }
}

/** Installs (or updates) skills that have a source. Returns one line per skill. */
export async function install(saved: Record<string, string> = {}, opts: { update?: boolean; only?: string } = {}): Promise<string[]> {
  mkdirSync(paths.skills(), { recursive: true });
  const lines: string[] = [];
  for (const s of specs(saved)) {
    if (opts.only && s.name !== opts.only) continue;
    const dir = srcDir(s.name);
    if (!s.source) {
      lines.push(`${s.name}: no source yet (factory skills add ${s.name} <git url or folder>)`);
      continue;
    }
    if (existsSync(dir)) {
      if (opts.update && existsSync(join(dir, ".git")) && !lstatSync(dir).isSymbolicLink()) {
        const r = await run("git", ["pull", "--ff-only", "-q"], dir);
        placeSkillFile(dir, s);
        lines.push(`${s.name}: ${r.ok ? "updated" : `update failed: ${r.out}`}`);
      } else lines.push(`${s.name}: already installed`);
      continue;
    }
    const existing = saved[s.name] ? undefined : existingInstall(s.name);
    if (existing) {
      symlinkSync(existing, dir);
      lines.push(`${s.name}: already in Claude Code, linked ${existing}`);
      continue;
    }
    const local = resolve(s.source.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
    if (existsSync(local)) {
      symlinkSync(local, dir);
      lines.push(`${s.name}: linked ${local}`);
    } else {
      const r = await run("git", ["clone", "--depth", "1", "-q", s.source, dir]);
      if (r.ok) placeSkillFile(dir, s);
      lines.push(`${s.name}: ${r.ok ? "cloned" : `clone failed: ${r.out}`}`);
    }
  }
  relink(saved);
  return lines;
}
