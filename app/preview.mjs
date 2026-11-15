import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../dist/src/daemon/client.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "dist-app");
const port = Number(process.env.PORT ?? 5174);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const client = await new Client().connect();
const streams = new Set();
await client.subscribe((event, data) => {
  for (const res of streams) res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
});

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/call" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { method, params } = JSON.parse(body || "{}");
    try {
      const result = await client.call(method, params ?? {});
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  const file = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${port} (widget: /?view=widget)`));
