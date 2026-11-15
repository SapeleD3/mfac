import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const TLA_VERSION = "1.8.0";
export const TLA_SHA256 = "7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f";
const tools = join(process.env.FACTORY_HOME ?? join(homedir(), ".factory"), "tools");
export const jar = join(tools, `tla2tools-${TLA_VERSION}.jar`);

export async function ensureJar() {
  if (existsSync(jar) && sha(readFileSync(jar)) === TLA_SHA256) return jar;
  mkdirSync(tools, { recursive: true });
  const url = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't download TLC from ${url}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (sha(body) !== TLA_SHA256) throw new Error("the downloaded tla2tools.jar doesn't match its pinned checksum");
  writeFileSync(jar, body);
  return jar;
}

const sha = (b) => createHash("sha256").update(b).digest("hex");

export async function check(spec, { workers = "auto" } = {}) {
  await ensureJar();
  const file = resolve(spec);
  // Asynchronous on purpose: the engine calls this, and a long TLC run must not freeze it.
  const r = await new Promise((done) => {
    const child = spawn("java", ["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", String(workers), "-cleanup", basename(file, ".tla")], { cwd: dirname(file) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => done({ status: 127, stdout, stderr: stderr + String(e) }));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`
    .split("\n")
    .filter((l) => !l.startsWith("Picked up JAVA_TOOL_OPTIONS"))
    .join("\n");
  const ok = r.status === 0 && /Model checking completed\. No error has been found\./.test(output);
  const found = [...output.matchAll(/([\d,]+) distinct states found/g)].pop();
  const states = Number((found?.[1] ?? "0").replace(/,/g, ""));
  return { ok, states, output };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--fetch") {
  console.log(`TLC ${TLA_VERSION} ready at ${await ensureJar()}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
  } catch {
    console.error("TLC needs Java 11 or newer (brew install openjdk).");
    process.exit(2);
  }
  const spec = process.argv[2] ?? "spec/Factory.tla";
  const r = await check(spec);
  console.log(r.output.split("\n").slice(-12).join("\n"));
  console.log(r.ok ? `\nTLC: ${spec} passes (${r.states.toLocaleString()} distinct states).` : `\nTLC: ${spec} FAILED.`);
  process.exit(r.ok ? 0 : 1);
}
