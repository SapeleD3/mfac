import { execFile } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../shared/paths.js";

export interface SkillSpec {
  name: string;
  description: string;
  source?: string;
  skillFile?: string;
}

export const CORE_SKILLS: SkillSpec[] = [
  { name: "superpowers", description: "planning, TDD and debugging workflows", source: "https://github.com/obra/superpowers" },
  { name: "pstack", description: "statechart, create-formal-verification and the principle-* skills (the research rule)", source: "https://github.com/cursor/plugins#pstack" },
  { name: "ponytail", description: "Mo's working conventions", source: "https://github.com/DietrichGebert/ponytail" },
  { name: "graphify", description: "knowledge graphs of code and docs for research", source: "https://github.com/Graphify-Labs/graphify", skillFile: "graphify/skill.md" },
];

export interface SkillStatus extends SkillSpec {
  status: "ok" | "missing" | "no-source";
  version?: string;
  provides: string[];
}

const pluginDir = () => join(paths.home(), "plugin");
const srcDir = (name: string) => join(paths.skills(), name);

export function parseSource(source: string): { repo: string; subdir?: string } {
  const i = source.lastIndexOf("#");
  return i > 0 ? { repo: source.slice(0, i), subdir: source.slice(i + 1).replace(/^\/+|\/+$/g, "") || undefined } : { repo: source };
}

const rootOf = (s: SkillSpec) => {
  const sub = s.source ? parseSource(s.source).subdir : undefined;
  return sub ? join(srcDir(s.name), sub) : srcDir(s.name);
};

const ownerOf = (url: string) => /github\.com[/:]([^/]+)/i.exec(url)?.[1]?.toLowerCase();

const run = (cmd: string, args: string[], cwd?: string) =>
  new Promise<{ ok: boolean; out: string }>((done) =>
    execFile(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 }, (err, stdout, stderr) => done({ ok: !err, out: String(stdout || stderr || err?.message || "").trim() })),
  );

export function specs(saved: Record<string, string> = {}): SkillSpec[] {
  const list = CORE_SKILLS.map((s) => (saved[s.name] ? { name: s.name, description: s.description, source: saved[s.name] } : { ...s }));
  for (const [name, source] of Object.entries(saved)) if (!list.some((s) => s.name === name)) list.push({ name, description: "added by you", source });
  return list;
}

const skillsIn = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(dir, d.name, "SKILL.md")))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
    : [];

function provided(dir: string, name: string): { name: string; path: string }[] {
  if (existsSync(join(dir, ".factory-skill", "SKILL.md"))) return [{ name, path: join(dir, ".factory-skill") }];
  if (existsSync(join(dir, "skills"))) return skillsIn(join(dir, "skills"));
  if (existsSync(join(dir, "plugins"))) {
    return readdirSync(join(dir, "plugins"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => skillsIn(join(dir, "plugins", d.name, "skills")));
  }
  if (existsSync(join(dir, "SKILL.md"))) return [{ name, path: dir }];
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
    out.push({ ...s, status: "ok", version: v, provides: provided(rootOf(s), s.name).map((p) => p.name) });
  }
  return out;
}

function sameOrigin(dir: string, source: string): boolean {
  const owner = ownerOf(parseSource(source).repo);
  if (!owner) return false;
  for (const m of [join(dir, ".claude-plugin", "plugin.json"), join(dir, "plugin.json")]) {
    if (!existsSync(m)) continue;
    try {
      const j = JSON.parse(readFileSync(m, "utf8")) as { homepage?: string; repository?: string | { url?: string }; author?: { url?: string } };
      const urls = [j.homepage, typeof j.repository === "string" ? j.repository : j.repository?.url, j.author?.url];
      return urls.some((u) => !!u && ownerOf(u) === owner);
    } catch {
      return false;
    }
  }
  return false;
}

export function existingInstall(s: SkillSpec, claudeDir = process.env.FACTORY_CLAUDE_DIR ?? join(homedir(), ".claude")): string | undefined {
  if (!s.source) return undefined;
  const cache = join(claudeDir, "plugins", "cache");
  if (existsSync(cache)) {
    for (const market of readdirSync(cache)) {
      const plugin = join(cache, market, s.name);
      if (!existsSync(plugin)) continue;
      const versions = readdirSync(plugin)
        .filter((v) => provided(join(plugin, v), s.name).length && sameOrigin(join(plugin, v), s.source!))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (versions.length) return join(plugin, versions[versions.length - 1]!);
    }
  }
  const skill = join(claudeDir, "skills", s.name);
  return s.skillFile && existsSync(join(skill, "SKILL.md")) ? skill : undefined;
}

async function installedFrom(dir: string, s: SkillSpec): Promise<boolean> {
  const { repo } = parseSource(s.source!);
  if (lstatSync(dir).isSymbolicLink()) {
    const target = realpathSync(dir);
    const local = resolve(repo.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
    const reused = existingInstall(s);
    return (existsSync(local) && realpathSync(local) === target) || (!!reused && realpathSync(reused) === target);
  }
  if (!existsSync(join(dir, ".git"))) return true;
  const url = (await run("git", ["remote", "get-url", "origin"], dir)).out.replace(/\.git$/, "");
  return url === repo.replace(/\.git$/, "");
}

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

const bundledSkills = () => fileURLToPath(new URL("../../../plugin", import.meta.url));

export function relink(saved: Record<string, string> = {}) {
  ensurePlugin();
  const dest = join(pluginDir(), "skills");
  const agents = join(pluginDir(), "agents");
  mkdirSync(agents, { recursive: true });
  for (const d of [dest, agents]) for (const entry of readdirSync(d)) if (lstatSync(join(d, entry)).isSymbolicLink()) rmSync(join(d, entry));
  const roots = [...specs(saved).map((s) => ({ root: rootOf(s), name: s.name })), { root: bundledSkills(), name: "factory" }];
  for (const { root, name } of roots) {
    for (const p of provided(root, name)) if (!existsSync(join(dest, p.name))) symlinkSync(p.path, join(dest, p.name));
    const a = join(root, "agents");
    if (existsSync(a)) for (const f of readdirSync(a)) if (f.endsWith(".md") && !existsSync(join(agents, f))) symlinkSync(join(a, f), join(agents, f));
  }
}

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
    const { repo, subdir } = parseSource(s.source);
    if (existsSync(dir) && !(await installedFrom(dir, s))) {
      rmSync(dir, { recursive: true, force: true });
      lines.push(`${s.name}: replacing the copy from the old source`);
    }
    if (existsSync(dir)) {
      if (opts.update && existsSync(join(dir, ".git")) && !lstatSync(dir).isSymbolicLink()) {
        const r = await run("git", ["pull", "--ff-only", "-q"], dir);
        placeSkillFile(dir, s);
        lines.push(`${s.name}: ${r.ok ? "updated" : `update failed: ${r.out}`}`);
      } else lines.push(`${s.name}: already installed`);
      continue;
    }
    const existing = existingInstall(s);
    if (existing) {
      symlinkSync(existing, dir);
      lines.push(`${s.name}: already in Claude Code, linked ${existing}`);
      continue;
    }
    const local = resolve(repo.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
    if (existsSync(local)) {
      symlinkSync(local, dir);
      lines.push(`${s.name}: linked ${local}`);
      continue;
    }
    const r = subdir
      ? await run("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "-q", repo, dir]).then((c) => (c.ok ? run("git", ["sparse-checkout", "set", subdir], dir) : c))
      : await run("git", ["clone", "--depth", "1", "-q", repo, dir]);
    if (r.ok) placeSkillFile(dir, s);
    lines.push(`${s.name}: ${r.ok ? `cloned from ${s.source}` : `clone failed: ${r.out}`}`);
  }
  relink(saved);
  return lines;
}
