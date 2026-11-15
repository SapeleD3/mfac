import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { paths } from "../shared/paths.js";

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const MODEL = "Xenova/all-MiniLM-L6-v2";
const PACKAGE = "@huggingface/transformers@4";
const dir = () => join(paths.home(), "embed");
const entry = () => join(dir(), "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs");

export const embedderInstalled = () => existsSync(entry());

/** Installs the local embedding runtime under ~/.factory/embed, so the engine itself keeps no dependencies. */
export function installEmbedder(): { ok: boolean; out: string } {
  mkdirSync(dir(), { recursive: true });
  const r = spawnSync("npm", ["install", "--prefix", dir(), "--no-audit", "--no-fund", "--omit=dev", PACKAGE], { encoding: "utf8" });
  // onnxruntime ships native builds for every platform; only this one's is ever loaded, and the rest are most of its size.
  const bins = join(dir(), "node_modules", "onnxruntime-node", "bin");
  if (existsSync(bins))
    for (const napi of readdirSync(bins)) for (const platform of readdirSync(join(bins, napi))) if (platform !== process.platform) rmSync(join(bins, napi, platform), { recursive: true, force: true });
  return { ok: r.status === 0 && embedderInstalled(), out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join("\n") };
}

type Pipeline = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let loading: Promise<Embedder | undefined> | undefined;
let override: Embedder | null | undefined;
let failure = "";

async function load(): Promise<Embedder | undefined> {
  if (!embedderInstalled()) {
    failure = "the embedding runtime isn't installed (factory memory install)";
    return undefined;
  }
  try {
    const t = (await import(pathToFileURL(entry()).href)) as {
      env: { cacheDir: string; allowRemoteModels: boolean };
      pipeline(task: string, model: string, opts: Record<string, unknown>): Promise<Pipeline>;
    };
    t.env.cacheDir = join(paths.home(), "models");
    const run = await t.pipeline("feature-extraction", MODEL, { dtype: "q8" });
    return {
      model: MODEL,
      async embed(texts) {
        if (!texts.length) return [];
        const out = await run(texts, { pooling: "mean", normalize: true });
        return out.tolist().map((v) => Float32Array.from(v));
      },
    };
  } catch (e) {
    failure = `the embedding model couldn't load: ${e instanceof Error ? e.message : e}`;
    return undefined;
  }
}

/** The on-device embedder, or nothing when it isn't installed; callers then fall back to keyword and graph search. */
export async function embedder(): Promise<Embedder | undefined> {
  if (override !== undefined) return override ?? undefined;
  loading ??= load();
  const e = await loading;
  if (!e) loading = undefined;
  return e;
}

export const embedderProblem = () => failure;

export function setEmbedder(e: Embedder | null | undefined) {
  override = e;
  loading = undefined;
}

export const textHash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
