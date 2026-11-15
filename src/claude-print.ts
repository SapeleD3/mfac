import { spawn } from "node:child_process";

/*
 * One-shot Claude calls for small jobs (triage, reply drafts, retros): `claude -p` on the person's
 * subscription, with no tools, returning text. Tests swap `runner` for a fake.
 */

export type PrintRunner = (prompt: string, opts: { model: string; system?: string }) => Promise<string>;

export let runner: PrintRunner = (prompt, opts) =>
  new Promise((resolve, reject) => {
    const args = ["-p", "--model", opts.model, "--output-format", "text", "--tools", "", ...(opts.system ? ["--append-system-prompt", opts.system] : [])];
    const child = spawn(process.env.FACTORY_CLAUDE ?? "claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    child.on("error", (e) => reject(new Error(`couldn't run claude: ${e.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });

export function setPrintRunner(r: PrintRunner) {
  runner = r;
}

/** Pulls the first JSON value out of a model's reply (it may wrap it in a fence). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in the reply");
  const open = body[start]!;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1)) as T;
  }
  throw new Error("unterminated JSON in the reply");
}
