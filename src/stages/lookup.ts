type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

const HEADERS = { "user-agent": "factory-lookup/1", accept: "application/json, text/html" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface StoreHit {
  store: string;
  name: string;
  by?: string;
  genre?: string;
  url?: string;
  exact: boolean;
}

export interface DomainResult {
  domain: string;
  status: "registered" | "available" | "unknown";
  since?: string;
  detail?: string;
}

export async function appStores(name: string, opts: { countries?: string[]; limit?: number; fetch?: Fetch } = {}): Promise<{ hits: StoreHit[]; failed: string[] }> {
  const get = opts.fetch ?? (fetch as unknown as Fetch);
  const limit = opts.limit ?? 8;
  const hits: StoreHit[] = [];
  const failed: string[] = [];
  const want = norm(name);
  for (const country of opts.countries ?? ["us"]) {
    for (const entity of ["software", "macSoftware"]) {
      const store = `Apple ${entity === "software" ? "iOS" : "Mac"} (${country.toUpperCase()})`;
      try {
        const r = await get(`https://itunes.apple.com/search?entity=${entity}&country=${country}&limit=${limit}&term=${encodeURIComponent(name)}`, { headers: HEADERS });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { results?: { trackName?: string; sellerName?: string; primaryGenreName?: string; trackViewUrl?: string }[] };
        for (const a of body.results ?? [])
          if (a.trackName) hits.push({ store, name: a.trackName, by: a.sellerName, genre: a.primaryGenreName, url: a.trackViewUrl, exact: norm(a.trackName).includes(want) });
      } catch (e) {
        failed.push(`${store}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  try {
    const r = await get(`https://play.google.com/store/search?c=apps&hl=en&q=${encodeURIComponent(name)}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ids = [...new Set([...(await r.text()).matchAll(/\/store\/apps\/details\?id=([\w.]+)/g)].map((m) => m[1]!))].slice(0, limit);
    for (const id of ids) hits.push({ store: "Google Play", name: id, url: `https://play.google.com/store/apps/details?id=${id}`, exact: norm(id).includes(want) });
  } catch (e) {
    failed.push(`Google Play: ${e instanceof Error ? e.message : e}`);
  }
  return { hits, failed };
}

export async function domains(name: string, tlds: string[], opts: { fetch?: Fetch } = {}): Promise<DomainResult[]> {
  const get = opts.fetch ?? (fetch as unknown as Fetch);
  const label = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const out: DomainResult[] = [];
  for (const tld of tlds) {
    const domain = `${label}.${tld.replace(/^\./, "")}`;
    try {
      const r = await get(`https://rdap.org/domain/${domain}`, { headers: { ...HEADERS, accept: "application/rdap+json, application/json" } });
      if (r.status === 404) out.push({ domain, status: "available" });
      else if (r.ok) {
        const body = (await r.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
        out.push({ domain, status: "registered", since: body.events?.find((e) => e.eventAction === "registration")?.eventDate?.slice(0, 10) });
      } else out.push({ domain, status: "unknown", detail: `HTTP ${r.status}` });
    } catch (e) {
      out.push({ domain, status: "unknown", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
