import { execFile } from "node:child_process";
import { extractJson, runner as claudePrint } from "./claude-print.js";
import { HttpError } from "./http.js";
import type { Store } from "./store.js";

/*
 * Slack, Notion and Jira come through Claude itself: the connectors (or MCP servers) the person already
 * has in Claude Code. The factory holds no tokens and needs no Slack app. It only:
 *  - finds the right server in `claude mcp list` (free: no model call), which also says whether the
 *    server is connected or needs signing in again;
 *  - runs small `claude -p` calls on Haiku that may use only that server's tools, and that answer in
 *    JSON. Reads are limited to the server's read-only tools when they're known; a write (posting a
 *    reply you pressed Send on, updating the Notion board) is the only call that gets the rest.
 */

export const SERVICES = ["slack", "notion", "jira"] as const;
export type Service = (typeof SERVICES)[number];

export interface McpServer {
  name: string;
  status: "connected" | "needs-auth" | "failed";
  detail: string;
}

const MATCH: Record<Service, RegExp> = { slack: /slack/i, notion: /notion/i, jira: /atlassian|jira/i };

/** Verbs in a tool name that change something (slack_send_message, notion-create-pages, addCommentToJiraIssue). Anything else is a read. */
const WRITE_VERBS = new Set("send post create update delete remove add edit move archive schedule upload reply react set write comment duplicate restore transition assign invite".split(" "));
export const isWriteTool = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => WRITE_VERBS.has(w));

/** Parses `claude mcp list`: lines like `claude.ai Slack: https://... - ✓ Connected`. */
export function parseMcpList(text: string): McpServer[] {
  const out: McpServer[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(.+?):\s.*\s-\s+(.*)$/);
    if (!m) continue;
    const detail = m[2]!.trim();
    const status = /connected/i.test(detail) && !/fail|not/i.test(detail) ? "connected" : /auth|sign|login|token|expired/i.test(detail) ? "needs-auth" : "failed";
    out.push({ name: m[1]!.trim(), status, detail: detail.replace(/^[^\w]+/, "") });
  }
  return out;
}

/** The tool-name prefix Claude Code gives a server's tools: mcp__<name with non-word characters as _>. */
export const toolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export type McpLister = () => Promise<string>;

let lister: McpLister = () =>
  new Promise((resolve, reject) =>
    execFile(process.env.FACTORY_CLAUDE ?? "claude", ["mcp", "list"], { encoding: "utf8", timeout: 90_000 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") reject(new HttpError(404, "the claude command isn't installed or isn't on PATH"));
      else if (err && !stdout) reject(new Error(`claude mcp list failed: ${String(stderr || err.message).trim().slice(0, 200)}`));
      else resolve(String(stdout));
    }),
  );

export function setMcpLister(l: McpLister) {
  lister = l;
  cache = undefined;
}

let cache: { at: number; servers: McpServer[] } | undefined;

/** Claude Code's MCP servers and connectors, cached for a minute (each listing checks every server). */
export async function servers(fresh = false): Promise<McpServer[]> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.servers;
  cache = { at: Date.now(), servers: parseMcpList(await lister()) };
  return cache.servers;
}

export interface ConnectorSettings {
  /** The server to use per service. Empty string: you turned it off. Unset: the first one that matches. */
  server?: Partial<Record<Service, string>>;
  /** Tool names seen when you connected, so reads can be limited to read-only tools. */
  tools?: Partial<Record<Service, string[]>>;
}

export const connectorSettings = (store: Store) => store.setting<ConnectorSettings>("connectors", {});

/** Which server serves this service, or undefined if there is none (or you turned it off). */
export async function serverFor(store: Store, service: Service, fresh = false): Promise<McpServer | undefined> {
  const chosen = connectorSettings(store).server?.[service];
  if (chosen === "") return undefined;
  const list = await servers(fresh);
  return chosen ? list.find((s) => s.name === chosen) : list.find((s) => MATCH[service].test(s.name));
}

export function allowedTools(store: Store, service: Service, server: string, write: boolean): string[] {
  const known = connectorSettings(store).tools?.[service] ?? [];
  const prefix = toolPrefix(server);
  if (write || !known.length) return [prefix];
  const reads = known.filter((t) => t.startsWith(prefix) && !isWriteTool(t.slice(prefix.length)));
  return reads.length ? reads : [prefix];
}

const LABEL: Record<Service, string> = { slack: "Slack", notion: "Notion", jira: "Jira (Atlassian)" };

/**
 * One small Claude call that may use only this service's connector. `task` says what to do and what
 * JSON to answer with. Throws an HttpError the health checks understand when the connector is missing.
 */
export async function ask<T>(store: Store, service: Service, task: string, opts: { write?: boolean; model?: string } = {}): Promise<T> {
  const server = await serverFor(store, service);
  if (!server) throw new HttpError(404, `no ${LABEL[service]} connector in Claude Code`);
  if (server.status === "needs-auth") throw new HttpError(401, `${server.name} needs you to sign in again in Claude`);
  const prompt = [
    `Use only the ${server.name} tools. ${opts.write ? "" : "Only read: don't send, post, create, edit or delete anything."}`,
    task,
    "Answer with only JSON, no prose. If a tool fails or you lack access, answer {\"error\": \"<what failed>\"}.",
  ].join("\n\n");
  const reply = await claudePrint(prompt, { model: opts.model ?? "haiku", allowedTools: allowedTools(store, service, server.name, !!opts.write), session: `factory-mcp-${service}` });
  const out = extractJson<T & { error?: string }>(reply);
  if (out && typeof out === "object" && !Array.isArray(out) && typeof out.error === "string") {
    throw new HttpError(/auth|permission|unauthori|forbidden|sign in/i.test(out.error) ? 401 : 502, `${LABEL[service]}: ${out.error}`);
  }
  return out;
}

/** `factory connect`: confirms the connector works with one cheap read, and remembers its tool names. */
export async function probe(store: Store, service: Service): Promise<{ who: string; server: string; tools: string[] }> {
  const server = await serverFor(store, service, true);
  if (!server) throw new HttpError(404, `no ${LABEL[service]} connector in Claude Code`);
  const r = await ask<{ who?: string; tools?: string[] }>(
    store,
    service,
    `Make one cheap read call to confirm you have access (for example, look up who I am). Then list the exact names of every ${server.name} tool you can use. Answer {"who": "<the account or workspace you're signed in as>", "tools": ["<tool name>", ...]}.`,
  );
  const tools = (r.tools ?? []).filter((t) => typeof t === "string");
  const s = connectorSettings(store);
  store.setSetting("connectors", { ...s, server: { ...s.server, [service]: server.name }, tools: { ...s.tools, [service]: tools } });
  return { who: r.who ?? "connected", server: server.name, tools };
}

/**
 * The read-only tools of every connector you've connected, for stage sessions' allowlists. Only tools
 * seen at `factory connect` count, so a write tool is never allowed by accident. No calls made.
 */
export function connectorReads(store: Store): string[] {
  const s = connectorSettings(store);
  return SERVICES.flatMap((svc) => {
    const server = s.server?.[svc];
    if (!server) return [];
    const prefix = toolPrefix(server);
    return (s.tools?.[svc] ?? []).filter((t) => t.startsWith(prefix) && !isWriteTool(t.slice(prefix.length)));
  });
}
