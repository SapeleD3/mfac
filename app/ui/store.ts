import { useEffect, useState } from "preact/hooks";
import { call, notify, onEngineEvent, onEngineState } from "./bridge";
import type { Alert, Connection, IntakeItem, Prompt, Routine, Settings, Status, Task, TriageRule } from "./types";

export interface Toast {
  id: number;
  level: Alert["level"];
  message: string;
}

export interface AppState {
  up: boolean;
  loaded: boolean;
  error?: string;
  tasks: Task[];
  prompts: Prompt[];
  connections: Connection[];
  alerts: Connection[];
  routines: Routine[];
  status?: Status;
  settings?: Settings;
  intake: IntakeItem[];
  rules: TriageRule[];
  toasts: Toast[];
  tick: number;
}

let state: AppState = { up: false, loaded: false, tasks: [], prompts: [], connections: [], alerts: [], routines: [], intake: [], rules: [], toasts: [], tick: 0 };
const subs = new Set<() => void>();
const set = (patch: Partial<AppState>) => {
  state = { ...state, ...patch };
  for (const s of subs) s();
};

const loaders = {
  tasks: async () => set({ tasks: await call<Task[]>("task.list", { all: true }) }),
  prompts: async () => set({ prompts: await call<Prompt[]>("prompt.list", { status: "pending" }) }),
  connections: async () => set({ connections: await call<Connection[]>("connections.list"), alerts: await call<Connection[]>("connections.alerts") }),
  routines: async () => set({ routines: await call<Routine[]>("routines.list") }),
  status: async () => set({ status: await call<Status>("factory.status") }),
  settings: async () => set({ settings: await call<Settings>("settings.get") }),
  intake: async () => set({ intake: await call<IntakeItem[]>("intake.list", { limit: 200 }) }),
  rules: async () => set({ rules: await call<TriageRule[]>("rules.list") }),
};
type Key = keyof typeof loaders;

const due = new Set<Key>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function refresh(...keys: Key[]) {
  for (const k of keys.length ? keys : (Object.keys(loaders) as Key[])) due.add(k);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const run = [...due];
    due.clear();
    const results = await Promise.allSettled(run.map((k) => loaders[k]()));
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    set({ loaded: true, up: results.some((r) => r.status === "fulfilled"), error: failed ? String(failed.reason?.message ?? failed.reason) : undefined, tick: state.tick + 1 });
  }, 120);
}

let toastId = 0;
export function toast(message: string, level: Alert["level"] = "info") {
  const t = { id: ++toastId, level, message };
  set({ toasts: [...state.toasts, t].slice(-4) });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), level === "error" ? 9000 : 5000);
}

export async function act<T>(method: string, params: Record<string, unknown> = {}, after: Key[] = []): Promise<T | undefined> {
  try {
    const r = await call<T>(method, params);
    const refused = r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok === false ? (r as unknown as { reason: string }).reason : undefined;
    if (refused) toast(`The engine refused: ${refused}`, "warn");
    refresh(...after);
    return r;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  }
}

let started = false;
export function start(opts: { notifications?: boolean } = {}) {
  if (started) return;
  started = true;
  refresh();
  onEngineState((up) => {
    set({ up });
    if (up) refresh();
  });
  onEngineEvent((event, data) => {
    const d = (data ?? {}) as Record<string, unknown>;
    switch (event) {
      case "change":
        refresh("tasks", "status", ...(d.kind === "settings" ? (["settings"] as Key[]) : []));
        if (opts.notifications && d.kind === "task") gateNotice(d.task as Task, d.action as string);
        break;
      case "decision":
        refresh("tasks", "status");
        break;
      case "refused":
        refresh("tasks");
        break;
      case "prompt":
        refresh("prompts");
        if (opts.notifications) void notify("Factory needs you", "A session is asking for permission or has a question.");
        break;
      case "alert": {
        const a = d as unknown as Alert;
        if (a.connection) refresh("connections");
        toast(a.message, a.level);
        if (opts.notifications && (a.sticky || a.level === "error")) void notify("Factory", a.message);
        break;
      }
      case "routine":
        refresh("routines");
        break;
      case "session":
      case "finished":
        refresh("status", "tasks");
        break;
      case "intake":
        refresh("intake");
        break;
      case "connection":
        refresh("connections");
        break;
    }
  });
  setInterval(() => refresh("tasks", "prompts", "status", "connections"), 30_000);
}

function gateNotice(t: Task | undefined, action: string | undefined) {
  if (!t || !action) return;
  const s = t.machine.state;
  if (s === "ResearchGate" || s === "PlanGate") void notify("Ready for your review", `${t.id} · ${t.title}`);
  else if (s === "PRGate") void notify("PR ready", `${t.id} · ${t.title}`);
  else if (s === "NeedsYou") void notify("Needs you", `${t.id} · ${t.title}`);
}

export function useApp(): AppState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => void subs.delete(fn);
  }, []);
  return state;
}

export function useCall<T>(method: string | undefined, params: Record<string, unknown> = {}, deps: unknown[] = []): { data?: T; error?: string; reload: () => void } {
  const app = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!method) return;
    let live = true;
    call<T>(method, params)
      .then((d) => live && (setData(d), setError(undefined)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => void (live = false);
  }, [method, app.tick, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
