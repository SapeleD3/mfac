import { execFile } from "node:child_process";
import type { Engine } from "./engine.js";
import { HttpError } from "./http.js";
import { connectorSettings, probe, serverFor, servers } from "./connectors.js";
import { type Row, type Store, now, opt } from "./store.js";

/*
 * Connections and health. Slack, Notion and Jira are Claude's own connectors (connectors.ts); the
 * factory holds no tokens. Before each intake run the engine checks the connection with no model call. A failure raises a sticky alert that never auto-dismisses (fix it or snooze it), and
 * work that needs the connection pauses instead of failing; it catches up from its cursor once fixed.
 */

export const CONNECTIONS = ["slack", "notion", "jira", "claude", "github"] as const;
export type ConnectionName = (typeof CONNECTIONS)[number];
export type ConnectionStatus = "connected" | "expired" | "missing" | "error";

export interface Connection {
  name: ConnectionName;
  label: string;
  neededFor: string;
  required: boolean;
  status: ConnectionStatus;
  detail?: string;
  via?: string;
  checkedAt?: string;
  lastOkAt?: string;
  snoozedUntil?: string;
  fix: { url?: string; steps: string[] };
}

const CONNECTOR_STEPS = (app: string, also = "") => [
  `Run factory connect ${app.toLowerCase()}. If Claude needs you to sign in to ${app} again, it starts Claude Code's own sign-in (claude mcp login) and opens your browser.`,
  `If Claude doesn't have ${app}${also} at all yet, add it in Claude's connector settings (it opens them for you). Claude Code uses the same connectors when it's signed in with that account. Or add a ${app} MCP server yourself with claude mcp add.`,
  "The factory only ever uses Claude's access; it never asks for a token.",
];

export const INFO: Record<ConnectionName, Omit<Connection, "name" | "status">> = {
  slack: {
    label: "Slack",
    neededFor: "Intake, reply drafts, write-back to threads",
    required: true,
    via: "The Slack connector in Claude",
    fix: { url: "https://claude.ai/customize/connectors", steps: CONNECTOR_STEPS("Slack") },
  },
  notion: {
    label: "Notion",
    neededFor: "Review docs, comments, decisions, the factory board, learn-tagged artifacts",
    required: true,
    via: "The Notion connector in Claude",
    fix: { url: "https://claude.ai/customize/connectors", steps: CONNECTOR_STEPS("Notion") },
  },
  jira: {
    label: "Jira",
    neededFor: "Intake of tickets assigned to you, write-back",
    required: false,
    via: "The Atlassian connector in Claude",
    fix: { url: "https://claude.ai/customize/connectors", steps: CONNECTOR_STEPS("Jira", " (the Atlassian connector)") },
  },
  claude: {
    label: "Claude Code",
    neededFor: "Every session, and the Slack, Notion and Jira connectors",
    required: true,
    via: "The claude command, signed in with your subscription",
    fix: { steps: ["Run claude in a terminal and sign in with your Claude account (not an API key)."] },
  },
  github: {
    label: "GitHub",
    neededFor: "Pushing branches and opening PRs at the PR gate",
    required: false,
    via: "git credentials and the gh command",
    fix: { url: "https://cli.github.com", steps: ["brew install gh", "gh auth login"] },
  },
};

export type Tester = (name: ConnectionName) => Promise<string>;

/** Runs a command without blocking the engine (a sync spawn would freeze every client for its duration). */
const run = (cmd: string, args: string[]) =>
  new Promise<{ status: number | null; stdout: string; missing: boolean }>((resolve) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 15_000 }, (err, stdout) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      resolve({ status: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout ?? ""), missing: e?.code === "ENOENT" });
    });
  });

/** One cheap call per connection; throws on failure. */
export const realTester =
  (engine: Engine): Tester =>
  async (name) => {
    switch (name) {
      case "slack":
      case "notion":
      case "jira": {
        // Free: `claude mcp list` checks each server's connection without a model call.
        const s = await serverFor(engine.store, name);
        if (!s) throw new HttpError(404, connectorSettings(engine.store).server?.[name] === "" ? "turned off by you (factory connect " + name + " turns it back on)" : `no ${INFO[name].label} connector in Claude Code`);
        if (s.status === "needs-auth") throw new HttpError(401, `${s.name} needs you to sign in again in Claude`);
        if (s.status === "failed") throw new HttpError(502, `${s.name}: ${s.detail}`);
        return `via ${s.name}`;
      }
      case "claude": {
        const v = await run(process.env.FACTORY_CLAUDE ?? "claude", ["--version"]);
        if (v.status !== 0) throw new HttpError(404, "the claude command isn't installed or isn't on PATH");
        if (process.env.ANTHROPIC_API_KEY) throw new HttpError(403, "ANTHROPIC_API_KEY is set, so sessions would bill the API instead of your subscription");
        return v.stdout.trim();
      }
      case "github": {
        const r = await run("gh", ["auth", "status"]);
        if (r.missing) throw new HttpError(404, "gh isn't installed; PRs need it (branches are still pushed)");
        if (r.status !== 0) throw new HttpError(401, "gh isn't signed in");
        return "gh signed in";
      }
    }
  };

const toConnection = (name: ConnectionName, r?: Row): Connection => ({
  name,
  ...INFO[name],
  status: (r?.status as ConnectionStatus) ?? "missing",
  detail: opt(r?.detail),
  checkedAt: opt(r?.checked_at),
  lastOkAt: opt(r?.last_ok_at),
  snoozedUntil: opt(r?.snoozed_until),
});

export class Connections {
  constructor(
    private store: Store,
    private engine: Engine,
    private tester: Tester,
  ) {}

  list(): Connection[] {
    const rows = new Map((this.store.db.prepare("SELECT * FROM connections").all() as Row[]).map((r) => [String(r.name), r]));
    return CONNECTIONS.map((n) => toConnection(n, rows.get(n)));
  }

  get(name: ConnectionName): Connection {
    return this.list().find((c) => c.name === name)!;
  }

  ok(name: ConnectionName): boolean {
    return this.get(name).status === "connected";
  }

  /** Was a connector found at the last check? Optional ones without one don't raise alerts. */
  configured(name: ConnectionName): boolean {
    if (name === "claude" || name === "github") return true;
    return this.get(name).status !== "missing";
  }

  async test(name: ConnectionName): Promise<Connection> {
    const before = this.get(name);
    let status: ConnectionStatus;
    let detail: string;
    try {
      detail = await this.tester(name);
      status = "connected";
    } catch (e) {
      status = e instanceof HttpError && e.auth ? "expired" : e instanceof HttpError && e.status === 404 ? "missing" : "error";
      detail = e instanceof Error ? e.message : String(e);
    }
    const t = now();
    this.store.db
      .prepare(
        `INSERT INTO connections (name, status, detail, checked_at, last_ok_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at,
           last_ok_at = COALESCE(excluded.last_ok_at, connections.last_ok_at)`,
      )
      .run(name, status, detail, t, status === "connected" ? t : null);
    const after = this.get(name);
    if (before.status !== after.status) {
      this.engine.emit("connection", { connection: after });
      const needed = INFO[name].required || after.status !== "missing";
      if (after.status !== "connected" && needed && !this.snoozed(after))
        this.engine.emit("alert", { level: "error", sticky: true, connection: name, message: `${INFO[name].label} is ${after.status}: ${detail}. Fix: factory connect ${name}` });
      if (after.status === "connected" && before.status !== "missing") this.engine.emit("alert", { level: "info", connection: name, clear: true, message: `${INFO[name].label} is connected again.` });
    }
    return after;
  }

  async testAll(): Promise<Connection[]> {
    const out: Connection[] = [];
    for (const n of CONNECTIONS) out.push(await this.test(n));
    return out;
  }

  /** `factory connect`: checks the connector with one cheap read (a small Haiku call) and remembers its tools. */
  async connect(name: ConnectionName, server?: string): Promise<Connection & { server?: string }> {
    if (name === "claude" || name === "github") return this.test(name);
    if (server !== undefined) {
      const s = connectorSettings(this.store);
      this.store.setSetting("connectors", { ...s, server: { ...s.server, [name]: server } });
    } else {
      // Connecting again undoes a disconnect: back to the first matching server.
      const s = connectorSettings(this.store);
      if (s.server?.[name] === "") this.store.setSetting("connectors", { ...s, server: { ...s.server, [name]: undefined } });
    }
    await servers(true);
    // The server's name is what `claude mcp login` needs to sign you in again.
    const found = (await serverFor(this.store, name))?.name;
    const c = await this.test(name);
    if (c.status !== "connected") return { ...c, server: found };
    try {
      const r = await probe(this.store, name);
      this.store.db.prepare("UPDATE connections SET detail = ? WHERE name = ?").run(`${r.who}, via ${r.server}`, name);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.store.db.prepare("UPDATE connections SET status = ?, detail = ? WHERE name = ?").run(e instanceof HttpError && e.auth ? "expired" : "error", detail, name);
    }
    return { ...this.get(name), server: found };
  }

  /** Stops the factory using a connector. Claude itself keeps it; remove it there to revoke access. */
  async disconnect(name: ConnectionName): Promise<Connection> {
    if (name === "claude" || name === "github") throw new Error(`${INFO[name].label} uses its own sign-in; sign out there instead`);
    const s = connectorSettings(this.store);
    this.store.setSetting("connectors", { ...s, server: { ...s.server, [name]: "" } });
    return this.test(name);
  }

  snooze(name: ConnectionName, hours: number) {
    const until = new Date(Date.now() + hours * 3_600_000).toISOString();
    this.store.db.prepare("INSERT INTO connections (name, status, snoozed_until) VALUES (?, 'missing', ?) ON CONFLICT(name) DO UPDATE SET snoozed_until = excluded.snoozed_until").run(name, until);
    return this.get(name);
  }

  private snoozed(c: Connection) {
    return !!c.snoozedUntil && Date.parse(c.snoozedUntil) > Date.now();
  }

  /** Sticky alerts still standing: required connections that aren't working and aren't snoozed. */
  alerts(): Connection[] {
    return this.list().filter((c) => c.checkedAt && c.status !== "connected" && (c.required || c.status !== "missing") && !this.snoozed(c));
  }
}
