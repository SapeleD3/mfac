import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS = "claude|anthropic|copilot|codex|openai|cursor|chatgpt|gemini";
const CREDIT_LINE = new RegExp(`^\\s*(co-authored-by:.*(${AGENTS})|claude-session:|.*generated (with|by) \\[?(${AGENTS}|ai\\b)|.*🤖 generated|https://claude\\.ai/code/session_)`, "i");
const BANNER = /^\s*(\/\/+|#+|\/\*+|--|\*)\s*[-=*~#]{4,}/;

export const isCreditLine = (line: string) => CREDIT_LINE.test(line);

export function stripCredits(text: string): string {
  return text
    .split("\n")
    .filter((l) => !isCreditLine(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

export interface Finding {
  where: string;
  line: number;
  text: string;
  rule: "credit" | "banner" | "layout" | "layer";
}

export function findings(where: string, text: string, rules: Finding["rule"][] = ["credit", "banner"]): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((l, i) => {
    if (rules.includes("credit") && isCreditLine(l)) out.push({ where, line: i + 1, text: l.trim(), rule: "credit" });
    if (rules.includes("banner") && BANNER.test(l)) out.push({ where, line: i + 1, text: l.trim(), rule: "banner" });
  });
  return out;
}

const CODE = /\.(ts|tsx|mjs|js|rs|css|sh|py|go|swift)$/;

export function checkRepo(dir: string): Finding[] {
  const files = spawnSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" })
    .stdout.split("\n")
    .filter((f) => CODE.test(f));
  return files.flatMap((f) => {
    const text = readFileSync(`${dir}/${f}`, "utf8");
    const exempt = f.startsWith("test/") || f === "src/repo/rules.ts";
    return findings(f, text, exempt ? ["banner"] : ["credit", "banner"]);
  });
}

export const LAYERS: Record<string, number> = {
  shared: 0,
  workflow: 1,
  daemon: 2,
  claude: 3,
  skills: 3,
  repo: 3,
  connectors: 3,
  board: 3,
  stages: 3,
  integrations: 3,
  upkeep: 3,
  cli: 4,
  main: 4,
};

const IMPORT = /(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g;

export function checkStructure(dir: string): Finding[] {
  const src = join(dir, "src");
  const out: Finding[] = [];
  for (const entry of readdirSync(src)) {
    const where = `src/${entry}`;
    if (!statSync(join(src, entry)).isDirectory()) out.push({ where, line: 0, text: "files go in a module folder, not loose in src/", rule: "layout" });
    else if (!(entry in LAYERS)) out.push({ where, line: 0, text: "a new module folder needs a layer in LAYERS (src/repo/rules.ts)", rule: "layout" });
  }
  for (const mod of Object.keys(LAYERS)) {
    const folder = join(src, mod);
    let files: string[] = [];
    try {
      files = readdirSync(folder, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"));
    } catch {
      continue;
    }
    for (const f of files) {
      const text = readFileSync(join(folder, f), "utf8");
      text.split("\n").forEach((l, i) => {
        for (const m of l.matchAll(IMPORT)) {
          const target = relative(src, normalize(join(dirname(join(folder, f)), m[1]!))).split("/")[0]!;
          if (target === mod || !(target in LAYERS)) continue;
          if (LAYERS[target]! > LAYERS[mod]!) out.push({ where: `src/${mod}/${f}`, line: i + 1, text: `${mod} (layer ${LAYERS[mod]}) imports ${target} (layer ${LAYERS[target]})`, rule: "layer" });
        }
      });
    }
  }
  return out;
}

const MESSAGE: Record<Finding["rule"], string> = {
  credit: "credits an agent",
  banner: "section-break comment",
  layout: "module layout",
  layer: "imports a higher layer",
};

function main(args: string[]) {
  if (args[0] === "strip") {
    process.stdout.write(stripCredits(readFileSync(0, "utf8")));
    return;
  }
  const all: Finding[] = [];
  if (args[0] === "message") all.push(...findings("commit message", readFileSync(args[1] ?? 0, "utf8"), ["credit"]));
  else if (args[0] === "pr") {
    const event = process.env.GITHUB_EVENT_PATH;
    const pr = event ? (JSON.parse(readFileSync(event, "utf8")) as { pull_request?: { title?: string; body?: string } }).pull_request : undefined;
    if (!pr) throw new Error("rules pr runs in a pull_request workflow, where GITHUB_EVENT_PATH holds the PR");
    all.push(...findings("PR title", pr.title ?? "", ["credit"]), ...findings("PR body", pr.body ?? "", ["credit"]));
  } else all.push(...checkRepo(process.cwd()), ...checkStructure(process.cwd()));
  for (const f of all) console.log(`${f.where}:${f.line}: ${MESSAGE[f.rule]}: ${f.text}`);
  if (all.length) {
    console.log(`\n${all.length} rule violation(s). See CLAUDE.md.`);
    process.exit(1);
  }
  console.log("rules ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
