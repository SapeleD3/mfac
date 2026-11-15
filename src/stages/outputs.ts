import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Validation {
  ok: boolean;
  problems: string[];
}

const read = (job: string, file: string) => (existsSync(join(job, file)) ? readFileSync(join(job, file), "utf8") : undefined);
const result = (problems: string[]): Validation => ({ ok: problems.length === 0, problems });
const FIELDS = ["Source", "Acceptance", "Verify by"] as const;

export function requirementBlocks(text: string): { id: string; body: string }[] {
  const parts = text.split(/^###\s+(R\d+)\b.*$/m);
  const out: { id: string; body: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ id: parts[i]!, body: parts[i + 1] ?? "" });
  return out;
}

export function requirementIds(job: string): string[] {
  return requirementBlocks(read(job, "requirements.md") ?? "").map((b) => b.id);
}

const mentions = (text: string, id: string) => new RegExp(`\\b${id}\\b`).test(text);
const verdict = (text: string) => text.match(/^VERDICT:\s*(\w+)/im)?.[1]?.toLowerCase();

export function checkRequirements(job: string): Validation {
  const text = read(job, "requirements.md");
  if (text === undefined) return result(["requirements.md is missing."]);
  const blocks = requirementBlocks(text);
  const problems: string[] = [];
  if (!blocks.length) problems.push('requirements.md has no requirements; each one is a "### R1: <name>" heading.');
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) problems.push(`${b.id} appears twice.`);
    seen.add(b.id);
    for (const f of FIELDS) if (!new RegExp(`^\\s*[-*]\\s*${f}:\\s*\\S`, "m").test(b.body)) problems.push(`${b.id} has no "${f}:" line.`);
  }
  for (const h of ["Out of scope", "Open questions"]) if (!new RegExp(`^##\\s+${h}`, "mi").test(text)) problems.push(`requirements.md has no "## ${h}" section (write "None" if empty).`);
  return result(problems);
}

export function checkPlanTraces(job: string): Validation {
  const plan = read(job, "plan.md");
  if (plan === undefined) return result(["plan.md is missing."]);
  const ids = requirementIds(job);
  const problems = ids.filter((id) => !mentions(plan, id)).map((id) => `plan.md never mentions ${id}, so no ticket covers it.`);
  if (!/^##\s+Traceability/im.test(plan)) problems.push('plan.md has no "## Traceability" section mapping each requirement to its tickets.');
  return result(problems);
}

export function checkCoverage(job: string): Validation {
  const review = read(job, "review-requirements.md");
  if (review === undefined) return result(["review-requirements.md is missing."]);
  const problems = [...checkPlanTraces(job).problems];
  for (const id of requirementIds(job)) if (!mentions(review, id)) problems.push(`review-requirements.md doesn't trace ${id}.`);
  if (verdict(review) !== "covered") problems.push('review-requirements.md must end with "VERDICT: covered" to pass.');
  return result(problems);
}

export function checkConfirmed(job: string): Validation {
  const confirm = read(job, "confirm.md");
  if (confirm === undefined) return result(["confirm.md is missing."]);
  const problems: string[] = [];
  for (const id of requirementIds(job)) {
    const line = confirm.split("\n").find((l) => mentions(l, id) && /\b(PASS|FAIL)\b/.test(l));
    if (!line) problems.push(`confirm.md has no PASS or FAIL result for ${id}.`);
    else if (/\bFAIL\b/.test(line)) problems.push(`${id} failed: ${line.trim()}`);
  }
  if (verdict(confirm) !== "solved") problems.push('confirm.md must end with "VERDICT: solved".');
  return result(problems);
}
