import { type Socket, connect } from "node:net";
import { paths } from "./paths.js";

export class Client {
  private socket?: Socket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners: ((event: string, data: unknown) => void)[] = [];

  constructor(readonly path = paths.socket()) {}

  connect(timeoutMs = 2000): Promise<this> {
    return new Promise((resolve, reject) => {
      const s = connect(this.path);
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`the engine didn't answer on ${this.path}`));
      }, timeoutMs);
      s.setEncoding("utf8");
      let buffer = "";
      s.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim()) this.onLine(line);
        }
      });
      s.once("connect", () => {
        clearTimeout(timer);
        this.socket = s;
        resolve(this);
      });
      s.once("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const why = e.code === "ENOENT" || e.code === "ECONNREFUSED" ? "the engine isn't running (start it with `factory engine start`)" : e.message;
        reject(new Error(why));
      });
      s.on("close", () => {
        for (const p of this.pending.values()) p.reject(new Error("the engine closed the connection"));
        this.pending.clear();
      });
    });
  }

  private onLine(line: string) {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; data?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event) {
      for (const l of this.listeners) l(msg.event, msg.data);
      return;
    }
    const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id!);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error ?? "failed"));
  }

  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.socket) return Promise.reject(new Error("not connected"));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket!.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async subscribe(fn: (event: string, data: unknown) => void): Promise<void> {
    this.listeners.push(fn);
    await this.call("subscribe");
  }

  close() {
    this.socket?.end();
    this.socket?.destroy();
  }
}

export async function call<T = unknown>(method: string, params: unknown = {}, path?: string): Promise<T> {
  const c = await new Client(path).connect();
  try {
    return await c.call<T>(method, params);
  } finally {
    c.close();
  }
}
