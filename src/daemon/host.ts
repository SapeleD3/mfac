import { mkdirSync } from "node:fs";
import { coreApi } from "./api.js";
import { Engine } from "../workflow/engine.js";
import { paths } from "../shared/paths.js";
import { type Handler, SocketServer } from "./server.js";
import { Store } from "../workflow/store.js";

export interface Plugin {
  name: string;
  api?: Record<string, Handler>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

export type PluginFactory = (ctx: { engine: Engine; store: Store; server: SocketServer }) => Plugin;

export const plugins: PluginFactory[] = [];

export async function startEngine(opts: { db?: string; socket?: string; plugins?: PluginFactory[] } = {}) {
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  const store = new Store(opts.db ?? paths.db());
  const engine = new Engine(store);
  const startedAt = new Date().toISOString();
  const handlers: Record<string, Handler> = coreApi(engine, startedAt);
  const server = new SocketServer(opts.socket ?? paths.socket(), handlers);
  const parts = (opts.plugins ?? plugins).map((f) => f({ engine, store, server }));
  for (const p of parts) Object.assign(handlers, p.api ?? {});
  for (const kind of ["change", "refused", "decision", "prompt", "alert", "routine", "session", "finished", "ticket", "intake", "connection"]) engine.on(kind, (data) => server.broadcast(kind, data));
  await server.listen();
  for (const p of parts) await p.start?.();
  const stop = async () => {
    for (const p of parts.reverse()) await p.stop?.();
    await server.close();
    store.close();
  };
  return { engine, store, server, stop };
}
