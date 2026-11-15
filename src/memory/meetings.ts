import type { MeetingNote } from "../connectors/notion.js";
import { type Row, type Store, type Task, now, parseJson } from "../workflow/store.js";
import { embedder } from "./embed.js";
import { link } from "./graph.js";
import { rank } from "./rank.js";
import { ensureVectors, nearest } from "./vectors.js";

export interface Meeting extends MeetingNote {
  server?: string;
}

const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

const toMeeting = (r: Row): Meeting => ({
  id: String(r.id),
  title: String(r.title),
  date: r.at ? String(r.at) : undefined,
  attendees: parseJson<string[]>(String(r.attendees), []),
  summary: String(r.summary),
  url: r.url ? String(r.url) : undefined,
  server: r.server ? String(r.server) : undefined,
});

export const meetings = (store: Store): Meeting[] => (store.db.prepare("SELECT * FROM meetings ORDER BY at DESC").all() as Row[]).map(toMeeting);

export const meeting = (store: Store, id: string): Meeting | undefined => {
  const r = store.db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as Row | undefined;
  return r ? toMeeting(r) : undefined;
};

export const meetingText = (m: Meeting) => `${m.title}\n${m.title}\n${m.summary}`;

/** The day to list meetings from: the newest one already kept, or a month back the first time. */
export function meetingsSince(store: Store): string {
  const r = store.db.prepare("SELECT MAX(at) AS at FROM meetings").get() as Row;
  return r.at ? String(r.at) : new Date(Date.now() - 30 * 86_400_000).toISOString();
}

/** Keeps the summaries, embeds them on this machine and links each meeting to the tickets it names. */
export async function saveMeetings(store: Store, notes: MeetingNote[], server?: string): Promise<number> {
  const put = store.db.prepare(
    `INSERT INTO meetings (id, title, at, attendees, summary, url, server, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, at = COALESCE(excluded.at, meetings.at), attendees = excluded.attendees, summary = excluded.summary, url = excluded.url, server = excluded.server, indexed_at = excluded.indexed_at`,
  );
  let added = 0;
  for (const n of notes) {
    if (!meeting(store, n.id)) added++;
    put.run(n.id, n.title, n.date ?? null, JSON.stringify(n.attendees), n.summary, n.url ?? null, server ?? null, now());
    store.db.prepare("DELETE FROM edges WHERE src = ?").run(`meeting:${n.id}`);
    for (const k of new Set(`${n.title}\n${n.summary}`.match(JIRA_KEY) ?? [])) link(store, `meeting:${n.id}`, "mentions", `ticket:${k}`);
  }
  const e = await embedder();
  if (e && notes.length)
    await ensureVectors(
      store,
      e,
      notes.map((n) => ({ kind: "meeting", ref: n.id, text: meetingText(n) })),
    );
  return added;
}

export interface MeetingPick {
  meeting: Meeting;
  why: string;
  score: number;
}

/** Meetings that likely discussed this task: a ticket both name, then embedding and keyword closeness. */
export async function relatedMeetings(store: Store, task: Pick<Task, "title" | "body" | "sourceRef" | "source">, limit = 2): Promise<MeetingPick[]> {
  const pool = meetings(store);
  if (!pool.length) return [];
  const text = `${task.title}\n${task.body}`;
  const keys = new Set([...(text.match(JIRA_KEY) ?? []), ...(task.source === "jira" && task.sourceRef ? [task.sourceRef.split("@")[0]!] : [])]);
  const byTicket = new Map<string, string>();
  for (const k of keys) for (const r of store.db.prepare("SELECT src FROM edges WHERE dst = ? AND src LIKE 'meeting:%'").all(`ticket:${k}`) as Row[]) byTicket.set(String(r.src).slice(8), k);
  const query = `${task.title}\n${task.title}\n${task.body.slice(0, 1500)}`;
  const kwRanked = rank(
    query,
    pool.map((m) => ({ item: m.id, text: meetingText(m) })),
  );
  const top = kwRanked[0]?.score ?? 0;
  const kw = new Map(kwRanked.map((r) => [r.item, top ? r.score / top : 0]));
  const vec = new Map<string, number>();
  const e = await embedder();
  if (e) {
    await ensureVectors(
      store,
      e,
      pool.map((m) => ({ kind: "meeting", ref: m.id, text: meetingText(m) })),
    );
    const [q] = await e.embed([query]);
    for (const r of nearest(store, e.model, q!, "meeting")) vec.set(r.ref, Math.max(0, Math.min(1, (r.score - 0.3) / 0.45)));
  }
  const w = e ? { vec: 0.7, kw: 0.3 } : { vec: 0, kw: 1 };
  return pool
    .map((m) => {
      const k = byTicket.get(m.id);
      const score = k ? 2 : w.vec * (vec.get(m.id) ?? 0) + w.kw * (kw.get(m.id) ?? 0);
      return { meeting: m, why: k ? `it names ${k}` : "it discussed something close to this ask", score };
    })
    .filter((p) => p.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const meetingLine = (p: MeetingPick) =>
  `- Meeting ${p.meeting.id} "${p.meeting.title}"${p.meeting.date ? ` (${p.meeting.date.slice(0, 10)})` : ""}: ${p.meeting.summary.slice(0, 220).replace(/\s+/g, " ")}. Why: ${p.why}.`;
