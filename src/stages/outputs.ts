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
  if (!/^#{2,4}\s+Traceability/im.test(plan)) problems.push('plan.md has no "## Traceability" section mapping each requirement to its tickets.');
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

export function checkResearchCoverage(job: string): Validation {
  const review = read(job, "review-requirements.md");
  if (review === undefined) return result(["review-requirements.md is missing."]);
  const research = read(job, "research.md") ?? "";
  const problems: string[] = [];
  for (const id of requirementIds(job)) {
    if (!mentions(research, id)) problems.push(`research.md never answers ${id}.`);
    if (!mentions(review, id)) problems.push(`review-requirements.md doesn't trace ${id}.`);
  }
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

export const ANSWER_WORDS = 120;
export const RESEARCH_WORDS = 800;
export const PLAN_WORDS = 1000;
export const CONFIRM_WORDS = 250;
export const JOURNEY_STEPS = 6;
export const BUILDER = "For the builder";

const words = (text: string) => text.replace(/```[\s\S]*?```/g, "").match(/[A-Za-z0-9][\w'’.-]*/g)?.length ?? 0;
const builderHeading = new RegExp(`^##\\s+${BUILDER}\\b.*$`, "im");

export function forPerson(text: string): string {
  const m = builderHeading.exec(text);
  return m ? text.slice(0, m.index).trimEnd() : text;
}

export function forBuilder(text: string): string {
  const m = builderHeading.exec(text);
  return m ? text.slice(m.index + m[0].length).trim() : "";
}

const NOT_FOR_PEOPLE: [RegExp, string][] = [
  [/`?[\w./-]+\.[a-z]{1,5}:\d+(?:-\d+)?`?/, "file:line references"],
  [/\bR\d+\b/, "requirement ids"],
  [/\b[A-Z][A-Z0-9]*-\d+-T\d+\b/, "ticket ids"],
  [/\b(?:round \d+|G\d+)\b/i, "review-round history"],
];

const section = (sections: string[], name: RegExp) => sections.find((s) => name.test(s));
const steps = (body: string) => body.split("\n").filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).length;

function checkForPerson(file: string, text: string, opts: { cap: number; journey: boolean; nextStep: boolean }): string[] {
  const problems: string[] = [];
  const person = forPerson(text);
  const lines = person.split("\n").filter((l) => l.trim());
  if (!/^#\s+\S/.test(lines[0] ?? "")) problems.push(`${file} must open with a # title that says what the person asked.`);
  const sections = person.split(/^##\s+/m).slice(1);
  const first = sections[0];
  if (!first || !/^Answer\b/i.test(first)) problems.push(`The first section of ${file} must be "## Answer": the verdict or recommendation in plain words, before anything else.`);
  else {
    const n = words(first.replace(/^.*\n/, ""));
    if (!n) problems.push('"## Answer" is empty.');
    if (n > ANSWER_WORDS) problems.push(`"## Answer" is ${n} words; keep it under ${ANSWER_WORDS} so a person gets it at a glance. Move the detail further down.`);
  }
  if (opts.journey) {
    for (const name of ["Today", "After"]) {
      const s = section(sections, new RegExp(`^${name}\\b`, "i"));
      if (!s) problems.push(`${file} has no "## ${name}" section: the user's journey ${name === "Today" ? "as it is now" : "once this ships"}, as numbered steps in plain words.`);
      else if (!steps(s)) problems.push(`"## ${name}" has no numbered steps; write the journey as 1., 2., 3.`);
      else if (steps(s) > JOURNEY_STEPS) problems.push(`"## ${name}" has ${steps(s)} steps; keep it to ${JOURNEY_STEPS} or fewer, the ones a user would notice.`);
    }
    if (!section(sections, /^What it imposes\b/i)) problems.push(`${file} has no "## What it imposes" section: what changes for users, what it costs, and what must happen before it works.`);
  }
  if (opts.nextStep && !section(sections, /^(Next steps?|Recommended next steps?)\b/i)) problems.push(`${file} has no "## Next step" section saying what the person should do or decide.`);
  const total = words(person);
  if (total > opts.cap)
    problems.push(`The part of ${file} above "## ${BUILDER}" is ${total} words; the cap is ${opts.cap}. Cut what doesn't help the person decide, or move it under "## ${BUILDER}".`);
  const prose = person.replace(/```[\s\S]*?```/g, "");
  for (const [re, what] of NOT_FOR_PEOPLE) {
    const m = re.exec(prose);
    if (m) problems.push(`The part of ${file} for the person has ${what} (e.g. "${m[0]}"); those go under "## ${BUILDER}".`);
  }
  return problems;
}

export function checkReadable(job: string, opts: { journey?: boolean } = {}): Validation {
  const text = read(job, "research.md");
  if (text === undefined) return result(["research.md is missing."]);
  return result(checkForPerson("research.md", text, { cap: RESEARCH_WORDS, journey: !!opts.journey, nextStep: true }));
}

export function checkPlanReadable(job: string): Validation {
  const text = read(job, "plan.md");
  if (text === undefined) return result(["plan.md is missing."]);
  const problems = checkForPerson("plan.md", text, { cap: PLAN_WORDS, journey: true, nextStep: false });
  if (!forBuilder(text)) problems.push(`plan.md has no "## ${BUILDER}" section; the approach, tickets, traceability, verification and rollback go there.`);
  return result(problems);
}

export function checkConfirmReadable(job: string): Validation {
  const text = read(job, "confirm.md");
  if (text === undefined) return result(["confirm.md is missing."]);
  const problems = checkForPerson("confirm.md", text, { cap: CONFIRM_WORDS, journey: false, nextStep: false });
  if (!forBuilder(text)) problems.push(`confirm.md has no "## ${BUILDER}" section; the results table, commands and evidence go there.`);
  return result(problems);
}
