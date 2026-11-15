import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { designPrinciplesDir, fetchDesignPrincipleSources, loadPrinciples, loadSources } from "../src/design-principles.js";

const dir = designPrinciplesDir();
const principles = loadPrinciples();
const sources = loadSources();
const ids = new Set(principles.map((p) => p.id));
const sourceIds = new Set(sources.map((s) => s.id));
const SECTIONS = ["## Apply when", "## Watch for", "## Trade-offs", "## Tensions", "## Example", "## Cite as", "## Sources"];
const GROUPS = new Set(["modularity", "solid", "collaboration", "simplicity", "architecture", "data", "reliability"]);
const PSTACK = new Set([
  "laziness-protocol", "foundational-thinking", "redesign-from-first-principles", "attack-the-premise",
  "subtract-before-you-add", "minimize-reader-load", "outcome-oriented-execution", "experience-first",
  "exhaust-the-design-space", "build-the-lever", "model-the-domain", "boundary-discipline",
  "type-system-discipline", "make-operations-idempotent", "migrate-callers-then-delete-legacy-apis",
  "separate-before-serializing-shared-state", "prove-it-works", "fix-root-causes", "sequence-verifiable-units",
  "test-behavior-not-implementation", "explain-the-number", "guard-the-context-window",
  "never-block-on-the-human", "encode-lessons-in-structure",
].map((n) => `principle-${n}`));

function walk(d: string): string[] {
  return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
}

test("SKILL.md is a valid skill and indexes every principle exactly once", () => {
  const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: design-principles\ndescription: .+\n---\n/);
  const index = skill.slice(skill.indexOf("## Index"), skill.indexOf("## Sources"));
  for (const id of ids) {
    const links = index.split(`](principles/${id}.md)`).length - 1;
    assert.equal(links, 1, `${id} should be listed once in the index, found ${links}`);
  }
  assert.match(skill, new RegExp(`${principles.length} sourced principles`), "the description's count matches the files");
});

test("every principle file is complete and consistent", () => {
  assert.ok(principles.length >= 40, `expected at least 40 principles, found ${principles.length}`);
  for (const p of principles) {
    const file = join(dir, "principles", `${p.id}.md`);
    assert.ok(existsSync(file), `${p.id}: file name matches id`);
    assert.ok(p.name && p.rule, `${p.id}: has a name and a one-line rule`);
    assert.ok(GROUPS.has(p.group), `${p.id}: unknown group ${p.group}`);
    assert.ok(p.body.startsWith(`# `), `${p.id}: starts with a title`);
    assert.match(p.body, /\*\*Rule\.\*\*/, `${p.id}: states its rule`);
    for (const s of SECTIONS) assert.ok(p.body.includes(`\n${s}\n`), `${p.id}: missing section ${s}`);
    assert.ok(p.sources.length > 0, `${p.id}: cites at least one source`);
    for (const s of p.sources) assert.ok(sourceIds.has(s), `${p.id}: unknown source ${s}`);
    for (const r of [...p.related, ...p.tensions]) assert.ok(ids.has(r) && r !== p.id, `${p.id}: bad reference ${r}`);
    for (const r of p.pstack) assert.ok(PSTACK.has(r), `${p.id}: ${r} is not a pstack principle`);
    for (const [, ref] of p.body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) assert.ok(ids.has(ref!), `${p.id}: [[${ref}]] does not exist`);
    assert.ok(p.body.includes(`\`${p.id}\``), `${p.id}: "Cite as" shows the id to cite`);
  }
});

test("tensions are listed on both sides", () => {
  const byId = new Map(principles.map((p) => [p.id, p]));
  for (const p of principles) {
    for (const t of p.tensions) {
      const other = byId.get(t)!;
      assert.ok(other.tensions.includes(p.id) || other.related.includes(p.id) || p.body.includes(`[[${t}]]`),
        `${p.id} lists a tension with ${t}, but ${t} never mentions ${p.id}`);
    }
  }
});

test("the decision guide and data-structure guide only link to principles that exist", () => {
  for (const f of ["decision-guide.md", "data-structures.md", "SKILL.md"]) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const [, id] of text.matchAll(/\(principles\/([a-z0-9-]+)\.md\)/g)) assert.ok(ids.has(id!), `${f}: ${id} does not exist`);
    for (const [, link] of text.matchAll(/\]\(([a-z-]+\.(?:md|json))\)/g)) assert.ok(existsSync(join(dir, link!)), `${f}: ${link} missing`);
  }
  const guide = readFileSync(join(dir, "decision-guide.md"), "utf8");
  const covered = new Set([...guide.matchAll(/\(principles\/([a-z0-9-]+)\.md\)/g)].map((m) => m[1]));
  for (const id of ids) assert.ok(covered.has(id), `decision guide never points to ${id}`);
});

test("sources are well formed, used, and no PDF is committed", () => {
  assert.equal(sourceIds.size, sources.length, "source ids are unique");
  const cited = new Set(principles.flatMap((p) => p.sources));
  for (const s of sources) {
    assert.ok(s.title && s.authors && s.year && s.url.startsWith("http"), `${s.id}: incomplete`);
    assert.ok(["free-pdf", "open-licence", "web", "cite-only"].includes(s.access), `${s.id}: bad access ${s.access}`);
    if (s.access === "free-pdf") assert.ok(s.pdf?.length, `${s.id}: free-pdf needs a pdf url`);
    if (s.access === "cite-only") assert.ok(!s.pdf, `${s.id}: cite-only sources must not be downloaded`);
    for (const u of s.pdf ?? []) assert.ok(u.startsWith("https://"), `${s.id}: pdf urls must be https`);
    assert.ok(cited.has(s.id) || s.id === "pstack", `${s.id} is not cited by any principle`);
  }
  const pdfs = walk(dir).filter((f) => /\.pdf$/i.test(f)).map((f) => relative(dir, f));
  assert.deepEqual(pdfs, [], "PDFs must not live in the repository");
});

test("fetch downloads real PDFs once, rejects HTML, and tries mirrors in order", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "dp-cache-"));
  const calls: string[] = [];
  const pdf = new TextEncoder().encode("%PDF-1.4 fake");
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("dtic.mil")) return new Response("<html>blocked</html>", { status: 200 });
    if (u.includes("columbia.edu")) return new Response("nope", { status: 404 });
    return new Response(pdf, { status: 200 });
  }) as typeof fetch;

  const first = await fetchDesignPrincipleSources({ fetch: fakeFetch, cacheDir });
  const withPdf = sources.filter((s) => s.pdf?.length);
  assert.ok(first.fetched.includes("parnas-1972"), "falls back to the second mirror after an HTML page");
  assert.deepEqual(first.failed.map((f) => f.id), ["liskov-wing-1994"]);
  assert.equal(first.fetched.length, withPdf.length - 1);
  assert.ok(readFileSync(join(cacheDir, "parnas-1972.pdf")).subarray(0, 5).toString() === "%PDF-");
  assert.ok(!existsSync(join(cacheDir, "liskov-wing-1994.pdf")), "no file for a failed download");
  const manifest = JSON.parse(readFileSync(join(cacheDir, "manifest.json"), "utf8"));
  assert.match(manifest["parnas-1972"].sha256, /^[0-9a-f]{64}$/);

  calls.length = 0;
  writeFileSync(join(cacheDir, "brooks-1986.pdf"), "<html>"); // a bad cached file is fetched again
  const second = await fetchDesignPrincipleSources({ fetch: fakeFetch, cacheDir });
  assert.deepEqual(second.fetched, ["brooks-1986"]);
  assert.equal(second.cached.length, withPdf.length - 2);
  assert.ok(calls.every((u) => u.includes("columbia.edu") || u.includes("unc.edu")), "only missing files are requested");
});
