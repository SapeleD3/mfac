import type { PluginFactory } from "./factoryd.js";
import { integrationsPart } from "./integrations.js";
import { runnerPart } from "./runner.js";
import { ticketsPart } from "./tickets.js";

/** The engine's parts, in start order. Each milestone adds its own here. */
export function register(list: PluginFactory[]) {
  list.length = 0;
  list.push(ticketsPart, runnerPart(), integrationsPart());
}
