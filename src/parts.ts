import type { PluginFactory } from "./factoryd.js";

/** The engine's parts, in start order. Each milestone adds its own here. */
export function register(list: PluginFactory[]) {
  list.length = 0;
}
