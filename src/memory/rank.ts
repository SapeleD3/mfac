const STOP = new Set(
  "the and for with that this from into when then than what which will would should could have has had are was were been being not but any all can our your their them they its it's about after before over under more most some such only also just like make makes made need needs use used using add adds added new old fix fixes fixed via per out off too very each other there here where while task tasks work please thanks".split(
    " ",
  ),
);

export const words = (text: string) => (text.toLowerCase().match(/[a-z0-9][a-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w));

/** BM25: the keyword leg of the search, and all of it when no embedder is installed. */
export function rank<T>(query: string, docs: { item: T; text: string }[]): { item: T; score: number }[] {
  const q = [...new Set(words(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => words(d.text));
  const avg = toks.reduce((a, t) => a + t.length, 0) / toks.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return docs
    .map((d, i) => {
      const t = toks[i]!;
      const tf = new Map<string, number>();
      for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (n - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * t.length) / avg));
      }
      return { item: d.item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
