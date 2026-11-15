import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AGENTS = "claude|anthropic|copilot|codex|openai|cursor|chatgpt|gemini";
const CREDIT_LINE = new RegExp(
  `^\\s*(co-authored-by:.*(${AGENTS})|claude-session:|.*generated (with|by) \\[?(${AGENTS}|ai\\b)|.*🤖 generated|https://claude\\.ai/code/session_)`,
  "i",
);
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
  rule: "credit" | "banner";
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
  const files = spawnSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" }).stdout.split("\n").filter((f) => CODE.test(f));
  return files.flatMap((f) => {
    const text = readFileSync(`${dir}/${f}`, "utf8");
    const exempt = f.startsWith("test/") || f === "src/rules.ts";
    return findings(f, text, exempt ? ["banner"] : ["credit", "banner"]);
  });
}

function main(args: string[]) {
  if (args[0] === "strip") {
    process.stdout.write(stripCredits(readFileSync(0, "utf8")));
    return;
  }
  const all = checkRepo(process.cwd());
  const event = process.env.GITHUB_EVENT_PATH;
  if (event) {
    const pr = (JSON.parse(readFileSync(event, "utf8")) as { pull_request?: { title?: string; body?: string } }).pull_request;
    if (pr) all.push(...findings("PR title", pr.title ?? "", ["credit"]), ...findings("PR body", pr.body ?? "", ["credit"]));
  }
  for (const f of all) console.log(`${f.where}:${f.line}: ${f.rule === "credit" ? "credits an agent" : "section-break comment"}: ${f.text}`);
  if (all.length) {
    console.log(`\n${all.length} rule violation(s). See CLAUDE.md.`);
    process.exit(1);
  }
  console.log("rules ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
