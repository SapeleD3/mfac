import type { PluginFactory } from "../daemon/host.js";
import { integrationsPart } from "../integrations/integrations.js";
import { runnerPart } from "../stages/runner.js";
import { ticketsPart } from "../board/tickets.js";
import { memoryPart } from "../memory/memory.js";
import { upkeepPart } from "../upkeep/upkeep.js";

export function register(list: PluginFactory[]) {
  list.length = 0;
  list.push(ticketsPart, runnerPart(), integrationsPart(), upkeepPart, memoryPart);
}
