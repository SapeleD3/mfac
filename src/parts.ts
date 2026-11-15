import type { PluginFactory } from "./factoryd.js";
import { integrationsPart } from "./integrations.js";
import { runnerPart } from "./runner.js";
import { ticketsPart } from "./tickets.js";
import { upkeepPart } from "./upkeep.js";

export function register(list: PluginFactory[]) {
  list.length = 0;
  list.push(ticketsPart, runnerPart(), integrationsPart(), upkeepPart);
}
