import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkRequirements } from "./outputs.js";

export interface CheckResult {
  chart: boolean;
  proved: boolean;
  model?: string;
  states?: number;
  detail: string;
}

export type Tlc = (spec: string) => Promise<{ ok: boolean; states: number; output: string }>;

export const realTlc: Tlc = async (spec) => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "tlc.mjs");
  const mod = (await import(pathToFileURL(script).href)) as { check: Tlc };
  return mod.check(spec);
};

export function hasStatechart(text: string): boolean {
  return /```mermaid\s+stateDiagram(-v2)?\b[\s\S]*-->[\s\S]*```/.test(text);
}

export async function checkResearch(jobDir: string, tlc: Tlc = realTlc): Promise<CheckResult> {
  const chartFile = join(jobDir, "statechart.md");
  const chart = existsSync(chartFile) && hasStatechart(readFileSync(chartFile, "utf8"));
  const models = existsSync(jobDir) ? readdirSync(jobDir).filter((f) => f.endsWith(".tla") && !f.includes("_TTrace_")) : [];
  if (!chart) return record(jobDir, { chart, proved: false, detail: "statechart.md is missing or has no ```mermaid stateDiagram block with transitions." });
  const requirements = checkRequirements(jobDir);
  if (!requirements.ok) return record(jobDir, { chart, proved: false, detail: `requirements.md isn't usable yet:\n- ${requirements.problems.join("\n- ")}` });
  if (!models.length) return record(jobDir, { chart, proved: false, detail: "No TLA+ model (*.tla) was written next to statechart.md." });
  const model = models[0]!;
  if (!existsSync(join(jobDir, model.replace(/\.tla$/, ".cfg")))) return record(jobDir, { chart, proved: false, model, detail: `${model} has no .cfg beside it naming the invariants to check.` });
  let r: Awaited<ReturnType<Tlc>>;
  try {
    r = await tlc(join(jobDir, model));
  } catch (e) {
    return record(jobDir, { chart, proved: false, model, detail: `TLC couldn't run: ${e instanceof Error ? e.message : e}` });
  }
  if (!r.ok) {
    const tail = r.output
      .split("\n")
      .filter((l) => l.trim())
      .slice(-40)
      .join("\n");
    return record(jobDir, { chart, proved: false, model, states: r.states, detail: `TLC failed on ${model}. Its counterexample or error:\n\n${tail}` });
  }
  return record(jobDir, { chart, proved: true, model, states: r.states, detail: `TLC passed on ${model}: ${r.states.toLocaleString("en-US")} distinct states, no errors.` });
}

function record(jobDir: string, r: CheckResult): CheckResult {
  try {
    writeFileSync(join(jobDir, "tlc-result.md"), `# Research check\n\n- Statechart: ${r.chart ? "yes" : "no"}\n- TLC: ${r.proved ? "passed" : "not passed"}\n\n${r.detail}\n`);
  } catch {}
  return r;
}
