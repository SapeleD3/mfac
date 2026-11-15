import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { call } from "./client.js";
import type { Command, Flags } from "./cli.js";
import { CONNECTIONS, type Connection, type ConnectionName, INFO } from "./connections.js";
import { table } from "./format.js";
import type { IntakeItem, TriageRule } from "./intake.js";
import type { Routine } from "./routines.js";

const out = (s = ""): void => void process.stdout.write(`${s}\n`);
const str = (v: Flags[string] | undefined) => (Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined);
const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const until = (iso?: string) => {
  if (!iso) return "";
  const s = (Date.parse(iso) - Date.now()) / 1000;
  return s <= 0 ? "due" : s < 5400 ? `in ${Math.round(s / 60)}m` : s < 129600 ? `in ${Math.round(s / 3600)}h` : `in ${Math.round(s / 86400)}d`;
};

function openUrl(url: string) {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export const connectCommands: Record<string, Command> = {
  connections: {
    usage: "connections [--test]",
    help: "Slack, Notion, Jira, Claude Code and GitHub: connected, expired or missing, and when each last worked",
    async run(_a, f) {
      const list = f.test ? await call<Connection[]>("connections.test", {}) : await call<Connection[]>("connections.list");
      out(table([["CONNECTION", "STATUS", "LAST WORKED", "NEEDED FOR", "DETAIL"], ...list.map((c) => [c.label + (c.required ? "" : " (optional)"), c.status, ago(c.lastOkAt), c.neededFor, c.detail ?? ""])]));
      const bad = list.filter((c) => c.status !== "connected" && c.required);
      if (bad.length) out(`\nFix with: ${bad.map((c) => `factory connect ${c.name}`).join(", ")}`);
    },
  },
  connect: {
    usage: "connect slack|notion|jira|claude|github [--server NAME]",
    help: "Checks that Claude Code can reach Slack, Notion or Jira through your connectors (one small Haiku call), and sets up the Notion board",
    async run(args, f) {
      const name = args[0] as ConnectionName;
      if (!(CONNECTIONS as readonly string[]).includes(name)) throw new Error(`connect one of: ${CONNECTIONS.join(", ")}`);
      const info = INFO[name];
      out(`${info.label}: ${info.neededFor}.${info.via ? ` Uses: ${info.via}.` : ""}`);
      out("Checking...");
      const c = await call<Connection>("connections.connect", { name, server: str(f.server) });
      out(`${info.label}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`);
      if (c.status !== "connected") {
        out("\nTo fix it:");
        info.fix.steps.forEach((s, i) => out(`  ${i + 1}. ${s}`));
        if (info.fix.url) {
          out(`\nOpening ${info.fix.url}`);
          openUrl(info.fix.url);
        }
        if (name !== "claude" && name !== "github") out("\nIf Claude Code has more than one, pick it with --server \"<name from claude mcp list>\".");
        return;
      }
      if (name === "notion") {
        const status = await call<{ ready: boolean }>("notion.status");
        if (status.ready) return out("Your factory board is already set up.");
        const page = await ask("Link to a Notion page for your factory board (Jobs, Tickets and Reviews go there), or Enter to skip: ");
        if (page) {
          out("Creating the board (one call to Notion)...");
          await call("notion.setup", { page });
          out("Created Jobs, Tickets and Reviews on that page.");
        }
      }
    },
  },
  disconnect: {
    usage: "disconnect slack|notion|jira",
    help: "Stop the factory using a connector; Claude keeps it (remove it in Claude to revoke access)",
    async run(args) {
      const name = args[0] as ConnectionName;
      if (!["slack", "notion", "jira"].includes(name)) throw new Error("disconnect one of: slack, notion, jira");
      const c = await call<Connection>("connections.disconnect", { name });
      out(`${c.label}: the factory no longer uses it, and work that needs it is paused. factory connect ${name} turns it back on.`);
      out("Claude still has the connector. To remove Claude's access too: https://claude.ai/settings/connectors");
    },
  },
  inbox: {
    usage: "inbox [--all]",
    help: "What intake picked up and how triage sorted it",
    async run(_a, f) {
      const items = await call<IntakeItem[]>("intake.list", { status: f.all ? undefined : ["Inbox", "Triage", "ReplyDrafted"], limit: 50 });
      if (!items.length) return out("Nothing waiting in the inbox.");
      out(table([["ID", "STATUS", "SOURCE", "FROM", "TRIAGE", "TEXT"], ...items.map((i) => [i.id, i.status, i.channel ?? i.source, i.author ?? "", i.triage ?? "", i.text.replace(/\s+/g, " ").slice(0, 70)])]));
      for (const i of items.filter((x) => x.status === "ReplyDrafted")) out(`\nDraft for ${i.id}:\n  ${i.draft}\n  Send with: factory send ${i.id}`);
    },
  },
  triage: {
    usage: "triage ID ignore|reply|task|urgent [--tag TAG]",
    help: "Overrule triage on an item (the factory learns from it)",
    async run(args, f) {
      const i = await call<IntakeItem>("intake.override", { id: args[0], action: args[1], tags: ([] as string[]).concat((f.tag as string | string[]) ?? []) });
      out(`${i.id} is now ${i.status}${i.taskId ? ` (task ${i.taskId})` : ""}`);
    },
  },
  send: {
    usage: "send ID [--text TEXT]",
    help: "Send a drafted reply (the only way the factory posts as you)",
    run: async (args, f) => out(`${(await call<IntakeItem>("intake.send", { id: args[0], text: str(f.text) })).status}`),
  },
  rules: {
    usage: "rules [approve|reject ID]",
    help: "Triage rules learned from your overrides; proposed ones need your OK",
    async run(args) {
      if (args[0] === "approve" || args[0] === "reject") {
        const r = await call<TriageRule>("rules.set", { id: args[1], status: args[0] === "approve" ? "active" : "rejected" });
        return out(`${r.description}: ${r.status}`);
      }
      const rules = await call<TriageRule[]>("rules.list");
      if (!rules.length) return out("No triage rules yet. They're proposed after you overrule triage the same way three times.");
      out(table([["ID", "STATUS", "HITS", "RULE"], ...rules.map((r) => [r.id, r.status, String(r.hits), r.description])]));
    },
  },
  routines: {
    usage: 'routines [run|pause|resume|history|rm ID] [add NAME --every 1d --command "factory add ..."]',
    help: "Everything the factory does on a schedule: last run, result, next run, on or paused",
    async run(args, f) {
      const [sub, id] = args;
      if (sub === "run") return out(`${(await call<Routine>("routines.run", { id })).lastResult}: ${(await call<Routine[]>("routines.list")).find((r) => r.id === id)?.lastDetail ?? ""}`);
      if (sub === "pause" || sub === "resume") return out(`${id}: ${(await call<Routine>("routines.update", { id, enabled: sub === "resume" })).enabled ? "on" : "paused"}`);
      if (sub === "rm") return out(JSON.stringify(await call("routines.remove", { id })));
      if (sub === "add") return out(`Added ${(await call<Routine>("routines.add", { name: args.slice(1).join(" "), every: str(f.every) ?? "1d", command: str(f.command) ?? "" })).id}`);
      if (sub === "history") {
        const rows = await call<{ started_at: string; result: string; detail: string }[]>("routines.history", { id });
        return out(table([["STARTED", "RESULT", "DETAIL"], ...rows.map((r) => [r.started_at.slice(5, 16).replace("T", " "), r.result, r.detail ?? ""])]));
      }
      const list = await call<Routine[]>("routines.list");
      const every = (s: number) => (s % 86400 === 0 ? `${s / 86400}d` : s % 3600 === 0 ? `${s / 3600}h` : `${Math.round(s / 60)}m`);
      out(table([["ID", "ON", "EVERY", "LAST RUN", "RESULT", "NEXT", "DETAIL"], ...list.map((r) => [r.id, r.enabled ? "on" : "paused", every(r.everySeconds) + (r.workingHours ? " (work hours)" : ""), ago(r.lastRunAt), r.lastResult ?? "", r.enabled ? until(r.nextRunAt) : "", (r.lastDetail ?? "").slice(0, 60)])]));
    },
  },
  notion: {
    usage: "notion setup PAGE_LINK | status",
    help: "Create your factory board (Jobs, Tickets, Reviews) on a Notion page you can edit",
    async run(args) {
      if (args[0] === "setup") return out(JSON.stringify(await call("notion.setup", { page: args[1] }), null, 2));
      out(JSON.stringify(await call("notion.status"), null, 2));
    },
  },
  repo: {
    usage: 'repo add PATH [--setup "cp ../.env .env && npm ci"] [--base main] | ls',
    help: "Register a repo the factory may work in, with its per-worktree setup step",
    async run(args, f) {
      if (args[0] === "add") {
        const { resolve } = await import("node:path");
        return out(JSON.stringify(await call("repo.add", { path: resolve(args[1] ?? "."), setup: str(f.setup), base: str(f.base) })));
      }
      const repos = await call<{ name: string; path: string; base: string; setup: string }[]>("repo.list");
      out(repos.length ? table([["NAME", "BASE", "PATH", "SETUP"], ...repos.map((r) => [r.name, r.base, r.path, r.setup])]) : "No repos yet: factory repo add ~/code/app");
    },
  },
};
