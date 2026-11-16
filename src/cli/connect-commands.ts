import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { call } from "../daemon/client.js";
import type { Command, Flags } from "./cli.js";
import { CONNECTIONS, type Connection, type ConnectionName, INFO } from "../connectors/connections.js";
import { SERVICES } from "../connectors/mcp.js";
import { table } from "./format.js";
import type { IntakeItem, TriageRule } from "../integrations/intake.js";
import type { Routine } from "../integrations/routines.js";

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
  spawn(cmd, [url], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

function mcpLogin(server: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.env.FACTORY_CLAUDE ?? "claude", ["mcp", "login", server], { stdio: "inherit" });
    child.on("error", (e) => {
      out(`Couldn't run claude mcp login: ${e.message}`);
      resolve();
    });
    child.on("close", () => resolve());
  });
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
      out(
        table([
          ["CONNECTION", "STATUS", "LAST WORKED", "NEEDED FOR", "DETAIL"],
          ...list.map((c) => [c.label + (c.required ? "" : " (optional)"), c.used ? c.status : "not used", ago(c.lastOkAt), c.neededFor, c.detail ?? ""]),
        ]),
      );
      const bad = list.filter((c) => c.status !== "connected" && c.used);
      if (bad.length) out(`\nFix with: ${bad.map((c) => `factory connect ${c.name}`).join(", ")}`);
    },
  },
  connect: {
    usage: "connect slack|notion|jira|aws|gmail|drive|claude|github [--server NAME] [--login]",
    help: "Connects Slack, Notion or Jira through Claude: signs you in with Claude Code's own sign-in if needed, then checks it can read; sets up the Notion board",
    async run(args, f) {
      const name = (args[0] === "atlassian" ? "jira" : args[0]) as ConnectionName;
      if (!(CONNECTIONS as readonly string[]).includes(name)) throw new Error(`connect one of: ${CONNECTIONS.join(", ")}`);
      const info = INFO[name];
      out(`${info.label}: ${info.neededFor}.${info.via ? ` Uses: ${info.via}.` : ""}`);
      const check = async () => {
        out("Checking...");
        const c = await call<Connection & { server?: string }>("connections.connect", { name, server: str(f.server) });
        out(`${info.label}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`);
        return c;
      };
      let c = await check();
      const connector = name !== "claude" && name !== "github";
      // Signing in again only helps a server that asked for it; a server whose tools don't load stays broken after a login.
      if (connector && c.server && (c.status === "expired" || f.login)) {
        out(`\nSigning in to ${c.server} with Claude Code (claude mcp login). Finish in your browser.`);
        await mcpLogin(c.server);
        await ask("Press Enter once you've finished signing in: ");
        c = await check();
      } else if (connector && !c.server) {
        out(`\nClaude Code has no ${info.label} connector yet. Opening Claude's connector settings: add ${info.label} there (or add an MCP server with claude mcp add).`);
        openUrl(info.fix.url!);
        await ask(`Press Enter once ${info.label} is added: `);
        c = await check();
        if (c.server && c.status === "expired") {
          out(`\nSigning in to ${c.server} with Claude Code (claude mcp login).`);
          await mcpLogin(c.server);
          await ask("Press Enter once you've finished signing in: ");
          c = await check();
        }
      }
      if (c.status !== "connected") {
        out("\nStill not working. To fix it:");
        for (const [i, s] of info.fix.steps.entries()) out(`  ${i + 1}. ${s}`);
        if (connector) out(`\nIf Claude Code has more than one ${info.label} server, pick one with --server "<name from claude mcp list>".`);
        else if (info.fix.url) openUrl(info.fix.url);
        return;
      }
      if (name === "notion") {
        const status = await call<{ ready: boolean }>("notion.status");
        if (status.ready) return out("Your factory board is already set up.");
        const page = await ask("Name of a Notion page for your factory board (Jobs, Tickets and Reviews go there), or Enter to skip: ");
        if (page) {
          out("Creating the board (one call to Notion)...");
          await call("notion.setup", { page });
          out("Created Jobs, Tickets and Reviews on that page.");
        }
      }
    },
  },
  disconnect: {
    usage: "disconnect slack|notion|jira|aws|gmail|drive",
    help: "Stop the factory using a connector; Claude keeps it (remove it in Claude to revoke access)",
    async run(args) {
      const name = (args[0] === "atlassian" ? "jira" : args[0]) as ConnectionName;
      if (!(SERVICES as readonly string[]).includes(name)) throw new Error(`disconnect one of: ${SERVICES.join(", ")}`);
      const c = await call<Connection>("connections.disconnect", { name });
      out(`${c.label}: the factory no longer uses it, and work that needs it is paused. factory connect ${name} turns it back on.`);
      out("Claude still has the connector. To remove Claude's access too: https://claude.ai/customize/connectors");
    },
  },
  inbox: {
    usage: "inbox [--all]",
    help: "What intake picked up and how triage sorted it",
    async run(_a, f) {
      const items = await call<IntakeItem[]>("intake.list", { status: f.all ? undefined : ["Inbox", "Triage", "ReplyDrafted"], limit: 50 });
      if (!items.length) return out("Nothing waiting in the inbox.");
      out(
        table([
          ["ID", "STATUS", "SOURCE", "FROM", "TRIAGE", "TEXT"],
          ...items.map((i) => [i.id, i.status, i.channel ?? i.source, i.author ?? "", i.triage ?? "", i.text.replace(/\s+/g, " ").slice(0, 70)]),
        ]),
      );
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
    usage: 'routines [run|pause|resume|history|rm ID] [set ID --every 1h] [add NAME --every 1d --command "factory add ..."] [mac]',
    help: "Everything the factory does on a schedule: last run, result, next run, on or paused",
    async run(args, f) {
      const [sub, id] = args;
      if (sub === "run") return out(`${(await call<Routine>("routines.run", { id })).lastResult}: ${(await call<Routine[]>("routines.list")).find((r) => r.id === id)?.lastDetail ?? ""}`);
      if (sub === "pause" || sub === "resume") return out(`${id}: ${(await call<Routine>("routines.update", { id, enabled: sub === "resume" })).enabled ? "on" : "paused"}`);
      if (sub === "rm") return out(JSON.stringify(await call("routines.remove", { id })));
      if (sub === "set") return out(`${id}: every ${(await call<Routine>("routines.update", { id, every: str(f.every) })).everySeconds}s`);
      if (sub === "mac") {
        const rs = await call<{ kind: string; name: string; schedule: string; state: string; detail?: string }[]>("routines.machine");
        if (!rs.length) return out("No launch agents, crontab entries or Claude scheduled tasks for your user.");
        return out(table([["KIND", "NAME", "SCHEDULE", "STATE"], ...rs.map((r) => [r.kind, r.name, r.schedule, r.state + (r.detail ? ` (${r.detail})` : "")])]));
      }
      if (sub === "add") return out(`Added ${(await call<Routine>("routines.add", { name: args.slice(1).join(" "), every: str(f.every) ?? "1d", command: str(f.command) ?? "" })).id}`);
      if (sub === "history") {
        const rows = await call<{ started_at: string; result: string; detail: string }[]>("routines.history", { id });
        return out(table([["STARTED", "RESULT", "DETAIL"], ...rows.map((r) => [r.started_at.slice(5, 16).replace("T", " "), r.result, r.detail ?? ""])]));
      }
      const list = await call<Routine[]>("routines.list");
      const every = (s: number) => (s % 86400 === 0 ? `${s / 86400}d` : s % 3600 === 0 ? `${s / 3600}h` : `${Math.round(s / 60)}m`);
      out(
        table([
          ["ID", "ON", "EVERY", "LAST RUN", "RESULT", "NEXT", "DETAIL"],
          ...list.map((r) => [
            r.id,
            r.enabled ? "on" : "paused",
            every(r.everySeconds) + (r.workingHours ? " (work hours)" : ""),
            ago(r.lastRunAt),
            r.lastResult ?? "",
            r.enabled ? until(r.nextRunAt) : "",
            (r.lastDetail ?? "").slice(0, 60),
          ]),
        ]),
      );
    },
  },
  notion: {
    usage:
      'notion setup "PAGE NAME" | intake "BOARD NAME" [--status "Ready for agent"] [--server NAME] [--folder PATH] | folder "BOARD NAME" [PATH] | boards | unwatch "BOARD NAME" | meetings [--server NAME] [--on|--off] | status',
    help: "setup creates the factory board (Jobs, Tickets, Reviews) on a page you can edit; intake adds one of your own boards to watch (through --server when its workspace differs) and queues cards moved to its ready column; run it once per board. --folder, or folder, says where its cards' work lives: one repo, or a folder of repos that the card's text picks from",
    async run(args, f) {
      if (args[0] === "setup") return out(JSON.stringify(await call("notion.setup", { page: args[1] }), null, 2));
      if (args[0] === "intake") {
        const r = await call<{ board: string; status: string; routine: { lastResult?: string; lastDetail?: string } }>("notion.intake", {
          board: args[1],
          status: f.status,
          server: str(f.server),
          folder: str(f.folder) ? resolve(str(f.folder)!) : undefined,
          wait: true,
        });
        const { lastResult, lastDetail } = r.routine;
        return out(lastResult === "ok" ? `Watching ${r.board}. Cards moved to "${r.status}" go to the queue. Now: ${lastDetail}.` : `Saved, but the check ${lastResult}: ${lastDetail}`);
      }
      if (args[0] === "folder") {
        const r = await call<{ board: string; folder: string | null }>("notion.folder", { board: args[1], folder: args[2] ? resolve(args[2]) : undefined });
        return out(r.folder ? `Cards from ${r.board} work in ${r.folder}.` : `${r.board} has no folder; its cards use the repo their text names, else your default.`);
      }
      if (args[0] === "boards") {
        const s = await call<{ boards: { url: string; name?: string; server?: string; status: string; folder?: string }[] }>("notion.status");
        if (!s.boards.length) return out('No boards watched yet: factory notion intake "<board name>"');
        return out(s.boards.map((b) => `- ${b.name ?? b.url} · "${b.status}" · ${b.server ?? "the Notion connection's server"} · ${b.folder ?? "no folder"}`).join("\n"));
      }
      if (args[0] === "unwatch") {
        const r = await call<{ removed: string; boards: unknown[] }>("notion.unwatch", { board: args.slice(1).join(" ") });
        return out(`Stopped watching ${r.removed}. ${r.boards.length} board${r.boards.length === 1 ? "" : "s"} left.`);
      }
      if (args[0] === "meetings") {
        const r = await call<{ lastResult?: string; lastDetail?: string }>("notion.meetings", {
          server: f.server === undefined ? undefined : (str(f.server) ?? ""),
          on: f.off ? false : f.on ? true : undefined,
        });
        return out(r.lastResult === "ok" ? `Meetings: ${r.lastDetail}.` : `Meetings ${r.lastResult}: ${r.lastDetail}`);
      }
      out(JSON.stringify(await call("notion.status"), null, 2));
    },
  },
  repo: {
    usage: 'repo add PATH [--about "what it is for"] [--setup "cp ../.env .env && npm ci"] [--base main] [--default] | about NAME TEXT | default NAME | rm NAME | ls',
    help: "Register the repos work most likely lands in: triage matches incoming work to one by what it's for, else the default",
    async run(args, f) {
      if (args[0] === "add") {
        const { resolve } = await import("node:path");
        const r = await call<{ name: string }>("repo.add", { path: resolve(args[1] ?? "."), setup: str(f.setup), base: str(f.base), about: str(f.about) });
        if (f.default) await call("repo.update", { name: r.name, isDefault: true });
        return out(JSON.stringify(r));
      }
      if (args[0] === "about") return out(JSON.stringify(await call("repo.update", { name: args[1], about: args.slice(2).join(" ") })));
      if (args[0] === "default") return out(JSON.stringify(await call("repo.update", { name: args[1], isDefault: true })));
      if (args[0] === "rm") return out(JSON.stringify(await call("repo.remove", { name: args[1] })));
      const repos = await call<{ name: string; path: string; base: string; about: string; isDefault: boolean }[]>("repo.list");
      out(
        repos.length
          ? table([["NAME", "", "FOR", "BASE", "PATH"], ...repos.map((r) => [r.name, r.isDefault ? "default" : "", r.about || "–", r.base, r.path])])
          : 'No repos yet: factory repo add ~/code/app --about "what it\'s for"',
      );
    },
  },
};
