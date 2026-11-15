import { extractJson, runner as claudePrint } from "../claude/print.js";
import type { Digest } from "./digest.js";

/**
 * One cheap pass when a task finishes: the raw digest (already clipped to a few thousand characters)
 * in, a short summary and the decisions out. Runs without a persisted session, because a resumed
 * session would carry every earlier summary into each new call.
 */
export async function summarize(d: Digest, model: string, effort?: string): Promise<{ summary: string; decisions: string[] } | undefined> {
  const input = [
    `Task ${d.taskId}: ${d.title} (${d.kind}, ${d.outcome})`,
    d.area ? `Area: ${d.area}` : "",
    `Ask: ${d.ask}`,
    d.requirements.length ? `Requirements: ${d.requirements.join("; ")}` : "",
    d.approach ? `Research conclusion:\n${d.approach}` : "",
    d.lessons ? `Lessons the coordinator wrote:\n${d.lessons}` : "",
    d.notes.length ? `Reviewer notes:\n${d.notes.map((n) => `- ${n}`).join("\n")}` : "",
    d.files.length ? `Files changed: ${d.files.slice(0, 25).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = `Summarise this finished software task for whoever next works in the same repo. Reply with only JSON: {"summary": "<at most 60 words: what was asked, what was done or found, and where in the code>", "decisions": ["<at most 4 decisions or constraints a later task must respect, each under 25 words>"]}. Use only facts below; no praise, no filler.\n\n${input}`;
  try {
    const r = extractJson<{ summary?: string; decisions?: string[] }>(await claudePrint(prompt, { model, effort, timeoutMs: 120_000 }));
    if (!r.summary?.trim()) return undefined;
    return {
      summary: r.summary.trim().slice(0, 500),
      decisions: (r.decisions ?? [])
        .filter((x) => typeof x === "string" && x.trim())
        .slice(0, 4)
        .map((x) => x.trim().slice(0, 200)),
    };
  } catch {
    return undefined;
  }
}
