import type { Row, Store } from "../workflow/store.js";
import { type Embedder, cosine, textHash } from "./embed.js";

export type VectorKind = "digest" | "task" | "meeting";

export interface Item {
  kind: VectorKind;
  ref: string;
  text: string;
}

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/** Embeds only what is new or changed since it was last embedded with this model. */
export async function ensureVectors(store: Store, e: Embedder, items: Item[]): Promise<number> {
  const stale = items.filter((i) => {
    const r = store.db.prepare("SELECT model, hash FROM vectors WHERE kind = ? AND ref = ?").get(i.kind, i.ref) as Row | undefined;
    return !r || r.model !== e.model || r.hash !== textHash(i.text);
  });
  for (let at = 0; at < stale.length; at += 16) {
    const batch = stale.slice(at, at + 16);
    const vecs = await e.embed(batch.map((i) => i.text));
    const put = store.db.prepare("INSERT OR REPLACE INTO vectors (kind, ref, model, hash, vec) VALUES (?, ?, ?, ?, ?)");
    for (const [n, i] of batch.entries()) put.run(i.kind, i.ref, e.model, textHash(i.text), toBlob(vecs[n]!));
  }
  return stale.length;
}

/**
 * Exact cosine over the stored vectors of the given refs. The factory holds hundreds to a few thousand
 * tasks, where a full scan of 384-number vectors takes well under a millisecond, so there is no
 * approximate index to keep in step.
 */
export function nearest(store: Store, model: string, query: Float32Array, kind: VectorKind, refs?: string[]): { ref: string; score: number }[] {
  const rows = store.db.prepare("SELECT ref, vec FROM vectors WHERE kind = ? AND model = ?").all(kind, model) as Row[];
  const allow = refs ? new Set(refs) : undefined;
  return rows
    .filter((r) => !allow || allow.has(String(r.ref)))
    .map((r) => ({ ref: String(r.ref), score: cosine(query, fromBlob(r.vec as Uint8Array)) }))
    .sort((a, b) => b.score - a.score);
}
