import { ask } from "./connectors.js";
import type { Store } from "./store.js";

/*
 * Jira, read through the Atlassian connector you have in Claude (see connectors.ts): tickets assigned
 * to you that changed since the cursor. Comments go back only on a gate decision or when you press Send.
 */

export interface JiraItem {
  sourceId: string;
  key: string;
  summary: string;
  text: string;
  url?: string;
  updated: string;
  reporter: string;
  priority?: string;
  due?: string;
}

export async function poll(store: Store, since: string): Promise<JiraItem[]> {
  const r = await ask<{ items?: Partial<JiraItem>[] }>(
    store,
    "jira",
    [
      `Find Jira issues assigned to me that were updated after ${since} and aren't done (JQL: assignee = currentUser() AND statusCategory != Done AND updated >= "<that time>").`,
      'At most 50. Answer {"items": [{"key", "summary", "text" (the description as plain text), "url", "updated" (ISO time), "reporter" (display name), "priority", "due" (YYYY-MM-DD or null)}]}. If there are none, {"items": []}.',
    ].join("\n"),
  );
  return (r.items ?? [])
    .filter((i) => i.key && i.updated)
    .map((i) => ({
      sourceId: `${i.key}@${i.updated}`,
      key: i.key!,
      summary: i.summary ?? i.key!,
      text: i.text ?? "",
      url: i.url,
      updated: i.updated!,
      reporter: i.reporter ?? "",
      priority: i.priority ?? undefined,
      due: i.due ?? undefined,
    }));
}

export async function comment(store: Store, key: string, text: string) {
  await ask(store, "jira", `Add this exact comment to Jira issue ${key}, and nothing else:\n\n---\n${text}\n---\n\nAnswer {"ok": true} once it's added.`, { write: true });
}
