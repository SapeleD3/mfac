import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./paths.js";

export const ENGINE_LABEL = "com.sapeled3.factoryd";
export const APP_LABEL = "com.sapeled3.factory.app";

const agents = () => join(homedir(), "Library", "LaunchAgents");
export const plistPath = (label: string) => join(agents(), `${label}.plist`);
const uid = () => process.getuid?.() ?? 501;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function enginePlist(opts: { node: string; script: string; path: string; home?: string }): string {
  const env: Record<string, string> = { PATH: opts.path };
  if (opts.home) env.FACTORY_HOME = opts.home;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ENGINE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(opts.node)}</string>
    <string>--no-warnings=ExperimentalWarning</string>
    <string>${esc(opts.script)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${esc(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(paths.log())}</string>
  <key>StandardErrorPath</key><string>${esc(paths.log())}</string>
</dict>
</plist>
`;
}

export function appPlist(app: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>${esc(app)}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
}

const launchctl = (...args: string[]) => spawnSync("launchctl", args, { encoding: "utf8" });

export function installed(label = ENGINE_LABEL): boolean {
  return existsSync(plistPath(label));
}

export function install(opts: { app?: string } = {}): string[] {
  if (process.platform !== "darwin") throw new Error("the launch agent is macOS only; on Linux run `factory engine start` from your session");
  mkdirSync(agents(), { recursive: true });
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  const script = join(dirname(fileURLToPath(import.meta.url)), "factoryd.js");
  const done: string[] = [];
  const write = (label: string, body: string) => {
    launchctl("bootout", `gui/${uid()}/${label}`);
    writeFileSync(plistPath(label), body);
    const r = launchctl("bootstrap", `gui/${uid()}`, plistPath(label));
    if (r.status !== 0 && !/already/i.test(r.stderr)) throw new Error(`launchctl couldn't load ${label}: ${r.stderr.trim()}`);
    done.push(plistPath(label));
  };
  write(ENGINE_LABEL, enginePlist({ node: process.execPath, script, path: process.env.PATH ?? "/usr/bin:/bin", home: process.env.FACTORY_HOME }));
  if (opts.app && existsSync(opts.app)) write(APP_LABEL, appPlist(opts.app));
  return done;
}

export function uninstall(): string[] {
  const removed: string[] = [];
  for (const label of [APP_LABEL, ENGINE_LABEL]) {
    if (!installed(label)) continue;
    launchctl("bootout", `gui/${uid()}/${label}`);
    rmSync(plistPath(label), { force: true });
    removed.push(plistPath(label));
  }
  return removed;
}

export function kickstart(restart = false): boolean {
  if (process.platform !== "darwin" || !installed()) return false;
  return launchctl("kickstart", ...(restart ? ["-k"] : []), `gui/${uid()}/${ENGINE_LABEL}`).status === 0;
}
