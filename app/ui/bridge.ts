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

export function onEngineState(fn: (up: boolean) => void): () => void {
  if (!inApp) return () => {};
  const p = listen<boolean>("engine-state", (e) => fn(e.payload));
  return () => void p.then((un) => un());
}

export async function openUrl(url: string) {
  if (inApp) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank");
}

export const openInVSCode = (path: string) => openUrl(`vscode://file${path.startsWith("/") ? "" : "/"}${encodeURI(path)}`);

export async function openTerminal(command: string) {
  if (inApp) return invoke("open_terminal", { command });
  await navigator.clipboard?.writeText(command).catch(() => {});
}

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

export async function pickFolder(title: string): Promise<string | null> {
  if (!inApp) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}
