import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const MARKETPLACE = "factory-local";
export const PLUGIN = "mfactory";

export type Run = (args: string[]) => { ok: boolean; out: string };

const claude: Run = (args) => {
  const r = spawnSync(process.env.FACTORY_CLAUDE ?? "claude", args, { encoding: "utf8", timeout: 120_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

/**
 * Installs /mfactory through Claude Code's own plugin commands, from this checkout, so the factory never
 * writes into ~/.claude itself. Safe to run again: it refreshes the copy Claude Code keeps.
 */
export function installChatCommand(repo: string, run: Run = claude): string[] {
  const source = join(repo, "claude-plugin");
  const lines: string[] = [];
  const known = run(["plugin", "marketplace", "list"]);
  if (!known.ok) return [`skipped: claude plugin isn't available (${known.out.slice(0, 120)})`];
  const step = (label: string, args: string[]) => {
    const r = run(args);
    if (!r.ok) throw new Error(`${label} failed: ${r.out.slice(0, 300)}`);
    lines.push(label);
  };
  if (known.out.includes(MARKETPLACE)) step(`refreshed the ${MARKETPLACE} marketplace`, ["plugin", "marketplace", "update", MARKETPLACE]);
  else step(`added the ${MARKETPLACE} marketplace from ${source}`, ["plugin", "marketplace", "add", source]);
  const installed = run(["plugin", "list"]);
  if (installed.ok && installed.out.includes(`${PLUGIN}@${MARKETPLACE}`)) step(`updated /${PLUGIN}`, ["plugin", "update", `${PLUGIN}@${MARKETPLACE}`]);
  else step(`installed /${PLUGIN}`, ["plugin", "install", `${PLUGIN}@${MARKETPLACE}`]);
  return lines;
}
