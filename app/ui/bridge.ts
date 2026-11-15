/*
 * The only way the UI reaches the engine. Inside the app, Rust forwards each call to the engine's
 * Unix socket and relays its events; in the dev preview (preview.mjs) the same calls go over HTTP.
 * Design principle: one managed environment. The UI holds no state of its own that matters.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (inApp) return invoke<T>("engine_call", { method, params });
  const r = await fetch("/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
  const body = (await r.json()) as { ok: boolean; result?: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? "failed");
  return body.result as T;
}

/** Engine events (change, prompt, alert, routine, session...). Returns an unsubscribe. */
export function onEngineEvent(fn: (event: string, data: unknown) => void): () => void {
  if (inApp) {
    const p = listen<{ event: string; data: unknown }>("engine", (e) => fn(e.payload.event, e.payload.data));
    return () => void p.then((un) => un());
  }
  const es = new EventSource("/events");
  es.onmessage = (m) => {
    const { event, data } = JSON.parse(m.data);
    fn(event, data);
  };
  return () => es.close();
}

/** Whether the engine answered recently (the app restarts it if not). */
export function onEngineState(fn: (up: boolean) => void): () => void {
  if (!inApp) return () => {};
  const p = listen<boolean>("engine-state", (e) => fn(e.payload));
  return () => void p.then((un) => un());
}

/** Notion pages, PR links, vscode:// links: always the default app, never inside the factory. */
export async function openUrl(url: string) {
  if (inApp) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank");
}

export const openInVSCode = (path: string) => openUrl(`vscode://file${path.startsWith("/") ? "" : "/"}${encodeURI(path)}`);

/** Opens Terminal.app running a factory command (for example `factory attach F-001`). */
export async function openTerminal(command: string) {
  if (inApp) return invoke("open_terminal", { command });
  await navigator.clipboard?.writeText(command).catch(() => {});
}

/** Window helpers: the widget opens the full app at a route; the full app can hide or show the widget. */
export async function showMain(route?: string) {
  if (inApp) return invoke("show_main", { route: route ?? "" });
  window.open(`/#${route ?? ""}`, "_blank");
}
export async function setWidgetOpen(open: boolean) {
  if (inApp) return invoke("widget_open", { open });
}
export async function notify(title: string, body: string) {
  if (!inApp) return;
  const n = await import("@tauri-apps/plugin-notification");
  if (!(await n.isPermissionGranted()) && (await n.requestPermission()) !== "granted") return;
  n.sendNotification({ title, body });
}
