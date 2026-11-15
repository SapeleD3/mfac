import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call } from "../daemon/client.js";
import { isAlive } from "../daemon/server.js";
import { paths } from "../shared/paths.js";
import { kickstart } from "../upkeep/launchd.js";

const daemon = join(dirname(fileURLToPath(import.meta.url)), "..", "main", "factoryd.js");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startEngine(): Promise<string> {
  if (await isAlive(paths.socket())) return "Engine: already running";
  if (kickstart()) {
    for (let i = 0; i < 50; i++) {
      await wait(100);
      if (await isAlive(paths.socket())) return "Engine: started by launchd";
    }
  }
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  const log = openSync(paths.log(), "a");
  const child = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", daemon], { detached: true, stdio: ["ignore", log, log], env: process.env });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await wait(100);
    if (await isAlive(paths.socket())) return `Engine: started (pid ${child.pid})`;
  }
  throw new Error(`the engine didn't start; see ${paths.log()}`);
}

export async function restartEngine(): Promise<string> {
  if (kickstart(true)) return "Engine: restarted by launchd";
  if (await isAlive(paths.socket())) {
    process.kill((await call<{ pid: number }>("ping")).pid, "SIGTERM");
    for (let i = 0; i < 50 && (await isAlive(paths.socket())); i++) await wait(100);
  }
  return startEngine();
}
