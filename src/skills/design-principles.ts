import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../shared/paths.js";

export const designPrinciplesDir = () =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "skills", "design-principles");

export const designPrinciplesCache = () => join(paths.home(), "cache", "design-principles");

export type Access = "free-pdf" | "open-licence" | "web" | "cite-only";

export interface Source {
  id: string;
  title: string;
  authors: string;
  year: number;
  published: string;
  access: Access;
  url: string;
  pdf?: string[];
}

export interface Principle {
  id: string;
  name: string;
  group: string;
  rule: string;
  sources: string[];
  related: string[];
  tensions: string[];
  pstack: string[];
  body: string;
}

export function loadSources(dir = designPrinciplesDir()): Source[] {
  return (JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")) as { sources: Source[] }).sources;
}

const list = (v: string | undefined) =>
  (v ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);

export function parsePrinciple(text: string): Principle {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("principle file has no frontmatter");
  const fields = new Map<string, string>();
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return {
    id: fields.get("id") ?? "",
    name: fields.get("name") ?? "",
    group: fields.get("group") ?? "",
    rule: fields.get("rule") ?? "",
    sources: list(fields.get("sources")),
    related: list(fields.get("related")),
    tensions: list(fields.get("tensions")),
    pstack: list(fields.get("pstack")),
    body: m[2]!,
  };
}

export function loadPrinciples(dir = designPrinciplesDir()): Principle[] {
  const folder = join(dir, "principles");
  return readdirSync(folder)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parsePrinciple(readFileSync(join(folder, f), "utf8")));
}

export interface FetchReport {
  fetched: string[];
  cached: string[];
  failed: { id: string; error: string }[];
}

interface CacheEntry { url: string; bytes: number; sha256: string; fetchedAt: string }

const isPdf = (b: Uint8Array) => b.length > 5 && Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-";

export async function fetchDesignPrincipleSources(opts: {
  fetch?: typeof fetch;
  dir?: string;
  cacheDir?: string;
  log?: (line: string) => void;
} = {}): Promise<FetchReport> {
  const get = opts.fetch ?? fetch;
  const cache = opts.cacheDir ?? designPrinciplesCache();
  const log = opts.log ?? (() => {});
  mkdirSync(cache, { recursive: true });
  const manifestFile = join(cache, "manifest.json");
  const manifest: Record<string, CacheEntry> = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, "utf8"))
    : {};
  const report: FetchReport = { fetched: [], cached: [], failed: [] };

  for (const s of loadSources(opts.dir)) {
    if (!s.pdf?.length) continue;
    const file = join(cache, `${s.id}.pdf`);
    if (existsSync(file) && isPdf(readFileSync(file))) {
      report.cached.push(s.id);
      continue;
    }
    const errors: string[] = [];
    for (const url of s.pdf) {
      try {
        const res = await get(url, { redirect: "follow", headers: { "user-agent": "factory-design-principles/0.1" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!isPdf(bytes)) throw new Error("response is not a PDF");
        writeFileSync(`${file}.part`, bytes);
        renameSync(`${file}.part`, file);
        manifest[s.id] = {
          url,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          fetchedAt: new Date().toISOString(),
        };
        report.fetched.push(s.id);
        log(`fetched ${s.id} (${Math.round(bytes.length / 1024)} KB) from ${url}`);
        break;
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }
    if (!report.fetched.includes(s.id)) {
      report.failed.push({ id: s.id, error: errors.join("; ") });
      log(`could not fetch ${s.id}: ${errors.join("; ")}`);
    }
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "fetch") {
    console.error("usage: node dist/src/skills/design-principles.js fetch");
    process.exit(2);
  }
  const r = await fetchDesignPrincipleSources({ log: (l) => console.log(l) });
  console.log(`${r.fetched.length} fetched, ${r.cached.length} already cached, ${r.failed.length} failed -> ${designPrinciplesCache()}`);
  process.exit(r.failed.length && !r.fetched.length && !r.cached.length ? 1 : 0);
}
