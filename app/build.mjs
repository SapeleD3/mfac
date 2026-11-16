import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "dist-app");
rmSync(join(out, "chunks"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["index.html", "styles.css"]) copyFileSync(join(here, "ui", f), join(out, f));

const opts = {
  entryPoints: [join(here, "ui", "main.tsx")],
  bundle: true,
  format: "esm",
  target: "safari16",
  outdir: out,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  minify: !process.argv.includes("--watch"),
  logLevel: "info",
};
if (process.argv.includes("--watch")) await (await esbuild.context(opts)).watch();
else await esbuild.build(opts);
