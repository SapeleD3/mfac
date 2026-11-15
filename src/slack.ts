import { ask } from "./connectors.js";
import type { Store } from "./store.js";

export interface SlackItem {
  sourceId: string;
  author: string;
  channel: string;
  channelId: string;
  text: string;
  url?: string;
  ts: string;
  threadTs?: string;
}

export async function poll(store: Store, since: string, opts: { mutedChannels?: string[] } = {}): Promise<SlackItem[]> {
  const muted = opts.mutedChannels?.length ? ` Skip these channels: ${opts.mutedChannels.join(", ")}.` : "";
  const r = await ask<{ items?: Partial<SlackItem>[] }>(
    store,
    "slack",
    [
      `Find Slack messages aimed at me sent after ${since}: direct messages and group DMs to me, and messages anywhere that @-mention me.`,
      `Leave out messages I sent, and messages from bots or apps.${muted} At most 50, newest first.`,
      'Answer {"items": [{"channelId", "ts" (the message timestamp id), "threadTs" (the thread it\'s in, or its own ts), "channel" ("#name" or "DM"), "author" (display name), "text" (the full message), "url" (its permalink)}]}. If there are none, {"items": []}.',
    ].join("\n"),
  );
  return (r.items ?? [])
    .filter((i) => i.channelId && i.ts && typeof i.text === "string")
    .map((i) => ({
      sourceId: `${i.channelId}:${i.ts}`,
      author: i.author ?? "someone",
      channel: i.channel ?? "Slack",
      channelId: i.channelId!,
      text: i.text!,
      url: i.url,
      ts: String(i.ts),
      threadTs: i.threadTs ? String(i.threadTs) : undefined,
    }))
    .filter((i) => !(opts.mutedChannels ?? []).includes(i.channel));
}

export async function reply(store: Store, channelId: string, threadTs: string, text: string) {
  await ask(
    store,
    "slack",
    `Post this exact text as a reply in the thread ${threadTs} of channel ${channelId}, and nothing else:\n\n---\n${text}\n---\n\nAnswer {"ok": true} once it's posted.`,
    { write: true },
  );
}
