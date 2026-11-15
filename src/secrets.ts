import { spawnSync } from "node:child_process";

/*
 * Tokens live in the macOS Keychain (service "factory", one account per connection), never in a file
 * or the database. Off the Mac (CI, tests) they come from FACTORY_<NAME>_TOKEN.
 */

const SERVICE = "factory";
const envName = (name: string) => `FACTORY_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
const isMac = process.platform === "darwin";

export function getSecret(name: string): string | undefined {
  const fromEnv = process.env[envName(name)];
  if (fromEnv) return fromEnv;
  if (!isMac) return undefined;
  const r = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

export function setSecret(name: string, value: string): void {
  if (!isMac) throw new Error(`no Keychain here; set ${envName(name)} instead`);
  // -U updates an existing item; the value goes through argv only to `security`, which is the documented way.
  const r = spawnSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", name, "-w", value], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`couldn't save to the Keychain: ${r.stderr.trim()}`);
}

export function deleteSecret(name: string): void {
  if (isMac) spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", name], { stdio: "ignore" });
}
