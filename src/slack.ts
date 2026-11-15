import { HttpError, json } from "./http.js";
import { getSecret } from "./secrets.js";

/*
 * Slack, read with your user token (xoxp) straight from the engine: plain API calls, no Claude, so
 * an empty poll costs nothing. It picks up DMs to you and @-mentions of you newer than the cursor.
 * Replies are only ever posted after you press Send.
 */

export interface SlackItem {
  sourceId: string;
  author: string;
  authorId: string;
  channel: string;
  channelId: string;
  text: string;
  url?: string;
  ts: string;
  threadTs?: string;
  isBot: boolean;
}

const api = async <T = any>(method: string, params: Record<string, string> = {}, body?: Record<string, unknown>): Promise<T> => {
  const token = getSecret("slack");
  if (!token) throw new HttpError(401, "no Slack token (run factory connect slack)");
  const url = `https://slack.com/api/${method}${body ? "" : `?${new URLSearchParams(params)}`}`;
  const r = await json<{ ok: boolean; error?: string } & T>(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json; charset=utf-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new HttpError(["invalid_auth", "not_authed", "token_revoked", "token_expired", "missing_scope", "account_inactive"].includes(r.error ?? "") ? 401 : 500, `Slack ${method}: ${r.error}`);
  return r;
};

export async function whoAmI(): Promise<{ userId: string; team: string; url: string }> {
  const r = await api<{ user_id: string; team: string; url: string }>("auth.test");
  return { userId: r.user_id, team: r.team, url: r.url };
}

/** Everything aimed at you since `oldest` (a Slack ts): mentions via search, DMs via history. */
export async function poll(oldest: string, opts: { mutedChannels?: string[] } = {}): Promise<{ items: SlackItem[]; cursor: string }> {
  const me = await whoAmI();
  const items = new Map<string, SlackItem>();
  const after = Number(oldest) || Date.now() / 1000 - 86_400;
  const search = await api<{ messages?: { matches?: any[] } }>("search.messages", { query: `<@${me.userId}>`, sort: "timestamp", sort_dir: "desc", count: "50" });
  for (const m of search.messages?.matches ?? []) {
    if (Number(m.ts) <= after) continue;
    items.set(`${m.channel?.id}:${m.ts}`, toItem(m, m.channel?.id, m.channel?.name ? `#${m.channel.name}` : "Slack"));
  }
  const ims = await api<{ channels?: { id: string; user?: string }[] }>("users.conversations", { types: "im,mpim", limit: "100", exclude_archived: "true" });
  for (const c of ims.channels ?? []) {
    const h = await api<{ messages?: any[] }>("conversations.history", { channel: c.id, oldest: String(after), limit: "50" });
    for (const m of h.messages ?? []) items.set(`${c.id}:${m.ts}`, toItem(m, c.id, "DM"));
  }
  const kept = [...items.values()].filter((i) => i.authorId !== me.userId && !i.isBot && !(opts.mutedChannels ?? []).includes(i.channel));
  const newest = [...items.values()].reduce((max, i) => Math.max(max, Number(i.ts)), after);
  return { items: kept, cursor: String(newest) };
}

function toItem(m: any, channelId: string, channel: string): SlackItem {
  return {
    sourceId: `${channelId}:${m.ts}`,
    author: m.username ?? m.user_profile?.real_name ?? m.user ?? "someone",
    authorId: m.user ?? "",
    channel,
    channelId,
    text: String(m.text ?? ""),
    url: m.permalink,
    ts: String(m.ts),
    threadTs: m.thread_ts,
    isBot: !!m.bot_id || m.subtype === "bot_message",
  };
}

/** Post in the item's thread, as you. Only called after you press Send (or approve a write-back). */
export async function reply(channelId: string, threadTs: string, text: string) {
  await api("chat.postMessage", {}, { channel: channelId, thread_ts: threadTs, text });
}

export async function test(): Promise<string> {
  const me = await whoAmI();
  return `signed in to ${me.team}`;
}
