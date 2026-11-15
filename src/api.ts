import type { Engine } from "./engine.js";
import type { Handler } from "./server.js";
import type { Event, State } from "./statechart.js";
import type { Actor } from "./store.js";

/** What clients may ask of the engine. Later milestones add their own methods with `extend`. */
export function coreApi(engine: Engine, startedAt: string): Record<string, Handler> {
  return {
    ping: () => ({ pong: true, pid: process.pid, startedAt, version: process.env.npm_package_version ?? "0.1.0" }),
    "task.add": (p) => engine.add(p),
    "task.list": (p: { all?: boolean }) => engine.list(p),
    "task.get": (p: { id: string }) => {
      const t = engine.get(p.id);
      if (!t) throw new Error(`no task ${p.id}`);
      return { task: t, events: engine.events(t.id) };
    },
    /** Low-level move; the coordinator and stages use it, and the statechart has the last word. */
    "task.move": (p: { id: string; event: Event; actor?: Actor; data?: Record<string, unknown> }) => {
      // Sessions may only report their own work; verdicts at gates are reserved for people.
      const actor = p.actor ?? "coordinator";
      if (actor !== "human" && ["approve", "drop", "park", "unpark", "promote", "dismiss", "send_reply"].includes(p.event.type))
        throw new Error(`${p.event.type} is a person's decision; the ${actor} can't make it`);
      return engine.move(p.id, p.event, actor, p.data);
    },
    "task.decide": (p: { id: string; verdict: "approve" | "send_back" | "drop"; to?: State; note?: string }) => engine.decide(p.id, p.verdict, p),
    "task.park": (p: { id: string }) => engine.move(p.id, { type: "park" }, "human"),
    "task.unpark": (p: { id: string }) => engine.move(p.id, { type: "unpark" }, "human"),
    "task.interrupt": (p: { id: string; note?: string }) => engine.move(p.id, { type: "interrupt" }, "human", { note: p.note ?? "" }),
    "task.tag": (p: { id: string; add?: string[]; remove?: string[] }) => engine.tag(p.id, p.add, p.remove),
    "task.update": (p: { id: string; patch: Record<string, unknown> }) => {
      const allowedKeys = ["title", "body", "repo", "recipe", "priority"];
      const patch = Object.fromEntries(Object.entries(p.patch ?? {}).filter(([k]) => allowedKeys.includes(k)));
      return engine.update(p.id, patch);
    },
    "task.rules": (p: { id: string }) => engine.rules(p.id),
    "settings.get": () => engine.settings(),
    "settings.set": (p) => engine.updateSettings(p),
  };
}
