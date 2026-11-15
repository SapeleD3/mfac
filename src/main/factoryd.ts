#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { plugins, startEngine } from "../daemon/host.js";
import { paths } from "../shared/paths.js";
import { register } from "./plugins.js";

register(plugins);
const running = await startEngine();
writeFileSync(paths.pid(), String(process.pid));
console.log(`${new Date().toISOString()} factoryd ${process.pid} listening on ${paths.socket()}`);
const shutdown = async (signal: string) => {
  console.log(`${new Date().toISOString()} ${signal}: stopping`);
  await running.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
