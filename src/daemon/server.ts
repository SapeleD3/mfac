import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Server, type Socket, connect, createServer } from "node:net";
import { dirname } from "node:path";

export type Handler = (params: any, ctx: { socket: Socket }) => unknown | Promise<unknown>;

export interface Request {
  id?: number | string;
  method: string;
  params?: unknown;
}

const MAX_LINE = 4 * 1024 * 1024;

export class SocketServer {
  private server?: Server;
  private subscribers = new Set<Socket>();

  constructor(
    readonly path: string,
    private handlers: Record<string, Handler>,
  ) {}

  broadcast(event: string, data: unknown) {
    const line = `${JSON.stringify({ event, data })}\n`;
    for (const s of this.subscribers) {
      if (!s.destroyed) s.write(line);
    }
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    if (existsSync(this.path)) {
      if (await isAlive(this.path)) throw new Error(`another engine is already running on ${this.path}`);
      unlinkSync(this.path); // Left behind by a crash.
    }
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      // Created with a 0177 umask so no other user can ever connect, even for a moment.
      const old = process.umask(0o177);
      this.server!.listen(this.path, () => {
        process.umask(old);
        resolve();
      });
    });
    chmodSync(this.path, 0o600);
  }

  async close(): Promise<void> {
    for (const s of this.subscribers) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    try {
      unlinkSync(this.path);
    } catch {
    }
  }

  private accept(socket: Socket) {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) void this.handle(socket, line);
      }
    });
    socket.on("close", () => this.subscribers.delete(socket));
    socket.on("error", () => this.subscribers.delete(socket));
  }

  private async handle(socket: Socket, line: string) {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      return reply(socket, { id: null, ok: false, error: "not JSON" });
    }
    if (req.method === "subscribe") {
      this.subscribers.add(socket);
      return reply(socket, { id: req.id, ok: true, result: { subscribed: true } });
    }
    const handler = this.handlers[req.method];
    if (!handler) return reply(socket, { id: req.id, ok: false, error: `unknown method ${req.method}` });
    try {
      const result = await handler(req.params ?? {}, { socket });
      reply(socket, { id: req.id, ok: true, result: result ?? null });
    } catch (e) {
      reply(socket, { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function reply(socket: Socket, msg: unknown) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(msg)}\n`);
}

export function isAlive(path: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path);
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs).unref();
  });
}
