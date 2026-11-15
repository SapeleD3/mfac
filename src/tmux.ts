import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/*
 * Every stage runs as a real Claude Code session in the factory's own tmux server (socket file
 * "factory", never the person's tmux). Sessions outlive the engine and the app, so a crash or a
 * restart loses nothing, and the app can stream a session or let you take it over.
 *
 * Adapted from Sapele's src/tmux.ts (reuse before build).
 */

export const SOCKET = process.env.FACTORY_TMUX_SOCKET ?? "factory";
const BASE = ["-u", "-L", SOCKET, "-f", "/dev/null"];
const PREFIX = "factory-";

const LANG = /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "") ? undefined : "en_US.UTF-8";

const SERVER_OPTIONS: [string, string][] = [
  ["status", "off"],
  ["mouse", "off"],
  ["prefix", "C-]"],
  ["escape-time", "0"],
  ["history-limit", "50000"],
  ["default-terminal", "screen-256color"],
  ["terminal-overrides", "xterm*:RGB:smcup@:rmcup@"],
  ["window-size", "latest"],
  // A finished stage's pane stays for a moment so its last screen can be saved.
  ["remain-on-exit", "off"],
];

export const nameOf = (id: string) => `${PREFIX}${id}`;

function tmux(args: string[], input?: string): string {
  return execFileSync("tmux", [...BASE, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

export function available(): boolean {
  return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

export function isAlive(id: string): boolean {
  try {
    tmux(["has-session", "-t", `=${nameOf(id)}`]);
    return true;
  } catch {
    return false;
  }
}

export function start(id: string, cwd: string, command: string[], env: Record<string, string> = {}): void {
  const envArgs = Object.entries({ ...(LANG && { LANG }), COLORTERM: "truecolor", ...env }).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const options = SERVER_OPTIONS.flatMap(([k, v]) => [";", "set-option", "-g", k, v]);
  tmux(["new-session", "-d", "-s", nameOf(id), "-c", cwd, "-x", "200", "-y", "50", ...envArgs, "--", ...command, ...options]);
}

/** Ids of every factory session that's running, in one call. */
export function live(): Set<string> {
  try {
    return new Set(
      tmux(["list-sessions", "-F", "#{session_name}"])
        .split("\n")
        .filter((n) => n.startsWith(PREFIX))
        .map((n) => n.slice(PREFIX.length)),
    );
  } catch {
    return new Set();
  }
}

/** The last `lines` lines of the session's screen and scrollback. `escapes` keeps colours for the live view. */
export function capture(id: string, lines = 200, escapes = false): string {
  return tmux(["capture-pane", "-p", ...(escapes ? ["-e"] : ["-J"]), "-t", `=${nameOf(id)}:`, "-S", `-${lines}`]).trimEnd();
}

/** Seconds since the pane last printed anything. */
export function idleSeconds(id: string): number {
  try {
    const at = Number(tmux(["display-message", "-p", "-t", `=${nameOf(id)}:`, "#{window_activity}"]).trim());
    return at ? Math.max(0, Date.now() / 1000 - at) : 0;
  } catch {
    return 0;
  }
}

/** One message into the session as a single bracketed paste, then Enter, so multi-line text stays one message. */
export function paste(id: string, text: string): void {
  const target = `=${nameOf(id)}:`;
  const buffer = `factory-send-${id}`;
  tmux(["load-buffer", "-b", buffer, "-"], text);
  tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", target]);
  // Claude Code reads a paste and the Enter that follows it separately; a short gap keeps them apart.
  spawnSync("sleep", ["0.2"]);
  tmux(["send-keys", "-t", target, "Enter"]);
}

/** Press keys (tmux names: "1", "Enter", "Escape", "Down"). */
export function keys(id: string, ...names: string[]): void {
  tmux(["send-keys", "-t", `=${nameOf(id)}:`, ...names]);
}

/** Save the last screen (with colours) so a finished stage can still be watched, then end it. */
export function stop(id: string, saveTo?: string): void {
  if (saveTo && isAlive(id)) {
    try {
      mkdirSync(dirname(saveTo), { recursive: true });
      writeFileSync(saveTo, `${capture(id, 50_000, true)}\n`);
    } catch {
      // Losing the old screen shouldn't stop the session from stopping.
    }
  }
  try {
    tmux(["kill-session", "-t", `=${nameOf(id)}`]);
  } catch {
    // Already gone.
  }
}

/** Hand this terminal to the session until the person detaches (Ctrl-] d). */
export function attach(id: string): number {
  const inside = process.env.TMUX?.includes(`/${SOCKET},`);
  const args = inside ? ["switch-client", "-t", `=${nameOf(id)}`] : ["attach-session", "-t", `=${nameOf(id)}`];
  return spawnSync("tmux", [...BASE, ...args], { stdio: "inherit", env: { ...process.env, TMUX: inside ? process.env.TMUX : "" } }).status ?? 1;
}

/** Commands that can't be found leave a shell with the reason, instead of a pane that vanishes. */
export function inLoginShell(command: string[]): string[] {
  const script = [
    `"$0" "$@"; code=$?`,
    `case $code in 0|130) exit $code;; esac`,
    String.raw`printf '\n\033[31m%s exited with code %s\033[0m\n' "$0" "$code"`,
    `sleep 30`,
  ].join("\n");
  return [process.env.SHELL ?? "/bin/zsh", "-l", "-c", script, ...command];
}
