import { execFile } from "node:child_process";
import { extractJson, runner as claudePrint } from "../claude/print.js";
import { HttpError } from "../shared/http.js";
import type { Store } from "../workflow/store.js";

export const SERVICES = ["slack", "notion", "jira"] as const;
export type Service = (typeof SERVICES)[number];

export interface McpServer {
  name: string;
  status: "connected" | "needs-auth" | "failed";
  detail: string;
  kind: ServerKind;
  target?: string;
  unlisted?: boolean;
}

export type ServerKind = "claude.ai" | "plugin" | "local";

export const serverKind = (name: string): ServerKind => (/^claude\.ai /i.test(name) ? "claude.ai" : /^plugin:/i.test(name) ? "plugin" : "local");

const MATCH: Record<Service, RegExp> = { slack: /slack/i, notion: /notion/i, jira: /atlassian|jira/i };
const OWN: Record<Service, string> = { slack: "Slack", notion: "Notion", jira: "Atlassian" };

const WRITE_VERBS = new Set("send post create update delete remove add edit move archive schedule upload reply react set write comment duplicate restore transition assign invite".split(" "));
export const isWriteTool = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => WRITE_VERBS.has(w));

export function parseMcpList(text: string): McpServer[] {
  const out: McpServer[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(.+?):\s(.*)\s-\s+(.*)$/);
    if (!m) continue;
    const detail = m[3]!.trim();
    const status = /connected/i.test(detail) && !/fail|not/i.test(detail) ? "connected" : /auth|sign|login|token|expired/i.test(detail) ? "needs-auth" : "failed";
    const name = m[1]!.trim();
    out.push({ name, status, detail: detail.replace(/^[^\w]+/, ""), kind: serverKind(name), target: m[2]!.trim() || undefined });
  }
  return out;
}

export const toolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export type McpLister = () => Promise<string>;

let lister: McpLister = () =>
  new Promise((resolve, reject) =>
    execFile(process.env.FACTORY_CLAUDE ?? "claude", ["mcp", "list"], { encoding: "utf8", timeout: 90_000 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") reject(new HttpError(404, "the claude command isn't installed or isn't on PATH"));
      else if (err && !stdout)
        reject(
          new Error(
            `claude mcp list failed: ${String(stderr || err.message)
              .trim()
              .slice(0, 200)}`,
          ),
        );
      else resolve(String(stdout));
    }),
  );

export function setMcpLister(l: McpLister) {
  lister = l;
  cache = undefined;
}

let cache: { at: number; servers: McpServer[] } | undefined;

export async function servers(fresh = false): Promise<McpServer[]> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.servers;
  cache = { at: Date.now(), servers: parseMcpList(await lister()) };
  return cache.servers;
}

export interface ConnectorSettings {
  server?: Partial<Record<Service, string>>;
  pinned?: Partial<Record<Service, boolean>>;
  tools?: Partial<Record<Service, string[]>>;
}

export interface ConnectorCall {
  at: string;
  ok: boolean;
  server: string;
  error?: string;
  lastOkAt?: string;
}

export const connectorSettings = (store: Store) => store.setting<ConnectorSettings>("connectors", {});

const KIND_RANK: Record<ServerKind, number> = { "claude.ai": 0, local: 1, plugin: 2 };

/**
 * Every server that could serve this service, best first: the one you pinned with --server, then
 * Claude's own connectors, then servers you added, then plugin servers, working ones before broken ones.
 */
export async function candidates(store: Store, service: Service, fresh = false): Promise<McpServer[]> {
  const s = connectorSettings(store);
  const chosen = s.server?.[service];
  if (chosen === "") return [];
  const listed = await servers(fresh);
  const list = listed.filter((x) => MATCH[service].test(x.name) || x.name === chosen);
  // Claude's own connector loads in background sessions even on Claude Code versions whose
  // claude mcp list leaves claude.ai connectors out, so it's always worth one try.
  const own = `claude.ai ${OWN[service]}`;
  if (!listed.some((x) => x.name === own)) list.push({ name: own, status: "connected", detail: "Claude's own connector (not listed by claude mcp list)", kind: "claude.ai", unlisted: true });
  const rank = (x: McpServer) => (s.pinned?.[service] && x.name === chosen ? -10 : 0) + (x.status === "connected" ? 0 : 5) + KIND_RANK[x.kind] + (x.unlisted ? 1.5 : 0);
  return list.sort((a, b) => rank(a) - rank(b));
}

/** The server the connection check reports: the one you pinned, else a working listed one, else the first listed. */
export async function serverFor(store: Store, service: Service, fresh = false): Promise<McpServer | undefined> {
  const listed = (await candidates(store, service, fresh)).filter((x) => !x.unlisted);
  const s = connectorSettings(store);
  if (s.pinned?.[service] && listed[0]?.name === s.server?.[service]) return listed[0];
  return listed.find((x) => x.status === "connected") ?? listed[0];
}

export function cachedServer(store: Store, service: Service): McpServer | undefined {
  const last = lastCall(store, service)?.server;
  const list = cache?.servers ?? [];
  if (last && !list.some((x) => x.name === last) && last === `claude.ai ${OWN[service]}`)
    return { name: last, status: "connected", detail: "Claude's own connector (not listed by claude mcp list)", kind: "claude.ai", unlisted: true };
  return list.find((x) => x.name === last) ?? list.find((x) => MATCH[service].test(x.name));
}

/** A last call that failed because the server's tools never loaded or it needs a sign-in, not one that merely timed out. */
export const brokenCall = (c?: ConnectorCall) => !!c && !c.ok && /none of Claude's|tools in a background session|sign in|auth|unauthori|forbidden/i.test(c.error ?? "");

export const lastCall = (store: Store, service: Service) => store.setting<Partial<Record<Service, ConnectorCall>>>("connector_calls", {})[service];

function recordCall(store: Store, service: Service, server: string, error?: string) {
  const all = store.setting<Partial<Record<Service, ConnectorCall>>>("connector_calls", {});
  const at = new Date().toISOString();
  store.setSetting("connector_calls", { ...all, [service]: { at, ok: !error, server, ...(error ? { error: error.slice(0, 300) } : {}), lastOkAt: error ? all[service]?.lastOkAt : at } });
}

export function allowedTools(store: Store, service: Service, server: string, write: boolean): string[] {
  const known = connectorSettings(store).tools?.[service] ?? [];
  const prefix = toolPrefix(server);
  if (write || !known.length) return [prefix];
  const reads = known.filter((t) => t.startsWith(prefix) && !isWriteTool(t.slice(prefix.length)));
  return reads.length ? reads : [prefix];
}

const LABEL: Record<Service, string> = { slack: "Slack", notion: "Notion", jira: "Jira (Atlassian)" };

const TOOLS_MISSING =
  /(?:not|n't) (?:available|loaded|exposed|present)|no (?:[\w:./-]+ )?tools|no such tool|can't find (?:the |any )?tools|don't have (?:access to )?(?:the |any )?tools|told not to use/i;

class ServerUnusable extends Error {}

async function askOne<T>(store: Store, service: Service, server: McpServer, task: string, opts: AskOptions): Promise<T> {
  const prompt = [
    `Use the ${LABEL[service]} tools from ${server.name}. ${opts.write ? "" : "Only read: don't send, post, create, edit or delete anything."}`,
    task,
    'Answer with only JSON, no prose. If a tool fails or you lack access, answer {"error": "<what failed>"}.',
  ].join("\n\n");
  const reply = await claudePrint(prompt, {
    model: opts.model ?? "haiku",
    allowedTools: allowedTools(store, service, server.name, !!opts.write),
    session: opts.session ?? `factory-mcp-${service}`,
    timeoutMs: opts.timeoutMs,
  });
  let out: T & { error?: string };
  try {
    out = extractJson<T & { error?: string }>(reply);
  } catch {
    if (TOOLS_MISSING.test(reply)) throw new ServerUnusable(reply.slice(0, 300));
    throw new HttpError(502, `${LABEL[service]} gave no usable answer: ${reply.slice(0, 200)}`);
  }
  if (out && typeof out === "object" && !Array.isArray(out) && typeof out.error === "string") {
    if (TOOLS_MISSING.test(out.error)) throw new ServerUnusable(out.error);
    throw new HttpError(/auth|permission|unauthori|forbidden|sign in/i.test(out.error) ? 401 : 502, `${LABEL[service]}: ${out.error}`);
  }
  return out;
}

export interface AskOptions {
  write?: boolean;
  model?: string;
  session?: string;
  timeoutMs?: number;
}

/** Tries each candidate server in turn when one's tools don't load in a headless session, and remembers the one that answered. */
export async function askVia<T>(store: Store, service: Service, task: string, opts: AskOptions = {}): Promise<{ out: T; server: string }> {
  const all = await candidates(store, service);
  if (!all.length) throw new HttpError(404, `no ${LABEL[service]} connector in Claude Code`);
  const usable = all.filter((x) => x.status === "connected");
  if (!usable.length) {
    const first = all[0]!;
    if (first.status === "needs-auth") throw new HttpError(401, `${first.name} needs you to sign in again in Claude`);
    throw new HttpError(502, `${first.name}: ${first.detail}`);
  }
  const failures: string[] = [];
  for (const server of usable) {
    try {
      const out = await askOne<T>(store, service, server, task, opts);
      recordCall(store, service, server.name);
      return { out, server: server.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordCall(store, service, server.name, msg);
      if (!(e instanceof ServerUnusable)) throw e;
      failures.push(`${server.name}: ${msg}`);
    }
  }
  throw new HttpError(502, `none of Claude's ${LABEL[service]} servers loaded their tools in a background session (${failures.join("; ")})`);
}

export async function ask<T>(store: Store, service: Service, task: string, opts: AskOptions = {}): Promise<T> {
  return (await askVia<T>(store, service, task, opts)).out;
}

export async function probe(store: Store, service: Service): Promise<{ who: string; server: string; tools: string[] }> {
  await servers(true);
  const all = await candidates(store, service);
  const names = all.map((x) => x.name).join(", ");
  const { out: r, server } = await askVia<{ who?: string; tools?: string[] }>(
    store,
    service,
    `Make one cheap read call to confirm you have access (for example, look up who I am). Then list the exact names of every tool you can use from these servers: ${names}. Answer {"who": "<the account or workspace you're signed in as>", "tools": ["<tool name>", ...]}.`,
  );
  const prefix = toolPrefix(server);
  const tools = (r.tools ?? []).filter((t) => typeof t === "string" && t.startsWith(prefix));
  const s = connectorSettings(store);
  store.setSetting("connectors", { ...s, tools: { ...s.tools, [service]: tools } });
  return { who: r.who ?? "connected", server, tools };
}

export function connectorReads(store: Store): string[] {
  const s = connectorSettings(store);
  return SERVICES.flatMap((svc) => (s.tools?.[svc] ?? []).filter((t) => t.startsWith("mcp__") && !isWriteTool(t.split("__").slice(2).join("__"))));
}
