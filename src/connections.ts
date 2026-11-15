import { execFile } from "node:child_process";
import type { Engine } from "./engine.js";
import { HttpError } from "./http.js";
import * as jira from "./jira.js";
import * as notion from "./notion.js";
import { getSecret } from "./secrets.js";
import * as slack from "./slack.js";
import { type Row, type Store, now, opt } from "./store.js";

/*
 * Connections and health. Before each intake run the engine makes one cheap test call per connection,
 * without Claude. A failure raises a sticky alert that never auto-dismisses (fix it or snooze it), and
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

export const INFO: Record<ConnectionName, Omit<Connection, "name" | "status">> = {
  slack: {
    label: "Slack",
    neededFor: "Intake, reply drafts, write-back to threads",
    required: true,
    via: "Slack user token in the Keychain",
    fix: {
      url: "https://api.slack.com/apps?new_app=1",
      steps: [
        'Create an app "Factory (local)" from scratch in your workspace (or reuse it).',
        "Under OAuth & Permissions, add user scopes: search:read, im:history, mpim:history, im:read, mpim:read, users:read, chat:write.",
        "Install it to the workspace (an admin may need to approve it), then copy the User OAuth Token (xoxp-...).",
        "Paste it when factory connect slack asks. It's stored in your Keychain.",
      ],
    },
  },
  notion: {
    label: "Notion",
    neededFor: "Review docs, comments, decisions, the factory board, learn-tagged artifacts",
    required: true,
    via: "Notion internal integration token in the Keychain",
    fix: {
      url: "https://www.notion.so/profile/integrations",
      steps: [
        'Create an internal integration called "Factory" for your workspace and copy its secret.',
        "Make or pick a private page for the factory, open its ... menu, Connections, and add Factory.",
        "Paste the secret and the page's link when factory connect notion asks.",
      ],
    },
  },
  jira: {
    label: "Jira",
    neededFor: "Intake of tickets assigned to you, write-back",
    required: false,
    via: "Atlassian API token in the Keychain",
    fix: {
      url: "https://id.atlassian.com/manage-profile/security/api-tokens",
      steps: ["Create an API token named Factory.", "Paste it with your Atlassian email and site (yourco.atlassian.net) when factory connect jira asks."],
    },
  },
  claude: {
    label: "Claude Code",
    neededFor: "Every session",
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
        return slack.test();
      case "notion":
        return notion.test();
      case "jira":
        return jira.test(engine.store.setting("jira", {}));
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

  /** Is the connection set up at all (a token exists)? Unset optional ones aren't tested. */
  configured(name: ConnectionName): boolean {
    if (name === "claude" || name === "github") return true;
    return !!getSecret(name);
  }

  async test(name: ConnectionName): Promise<Connection> {
    const before = this.get(name);
    let status: ConnectionStatus;
    let detail: string;
    if (!this.configured(name)) {
      status = "missing";
      detail = "not set up";
    } else {
      try {
        detail = await this.tester(name);
        status = "connected";
      } catch (e) {
        status = e instanceof HttpError && e.auth ? "expired" : e instanceof HttpError && e.status === 404 ? "missing" : "error";
        detail = e instanceof Error ? e.message : String(e);
      }
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
      const needed = INFO[name].required || this.configured(name);
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
    return this.list().filter((c) => c.checkedAt && c.status !== "connected" && (c.required || this.configured(c.name)) && !this.snoozed(c));
  }
}
