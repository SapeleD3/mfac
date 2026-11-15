import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cronEntries, launchdSchedule, machineRoutines } from "../src/integrations/machine-routines.js";

test("launchd schedules read the way a person would say them", () => {
  assert.equal(launchdSchedule({ StartInterval: 300 }), "every 5 min");
  assert.equal(launchdSchedule({ StartCalendarInterval: { Hour: 9, Minute: 30 } }), "daily at 09:30");
  assert.equal(launchdSchedule({ StartCalendarInterval: [{ Weekday: 1, Hour: 8 }, { Minute: 15 }] }), "Mondays at 08:00, hourly at :15");
  assert.equal(launchdSchedule({ RunAtLoad: true, KeepAlive: { SuccessfulExit: false } }), "kept running, at login");
  assert.equal(launchdSchedule({}), "on demand");
});

test("crontab lines are split into schedule and command, skipping comments and variables", () => {
  assert.deepEqual(cronEntries("# backups\nMAILTO=\"\"\n*/10 * * * * ~/bin/sync.sh\n0 9 * * 1-5 brew update\n@reboot ~/bin/start\n"), [
    { schedule: "every 10 min", command: "~/bin/sync.sh" },
    { schedule: "weekdays at 09:00", command: "brew update" },
    { schedule: "at startup", command: "~/bin/start" },
  ]);
});

test("the Mac's own routines are listed with their launchctl state, the factory's marked as its own", async () => {
  const home = mkdtempSync(join(tmpdir(), "factory-mac-"));
  const agents = join(home, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  const plists: Record<string, object> = {
    "com.sapeled3.factoryd.plist": { Label: "com.sapeled3.factoryd", ProgramArguments: ["/usr/bin/node", "factoryd.js"], RunAtLoad: true, KeepAlive: true },
    "com.example.backup.plist": { Label: "com.example.backup", ProgramArguments: ["/bin/sh", "backup.sh"], StartInterval: 3600 },
    "com.example.broken.plist": { Label: "com.example.broken", Program: "/bin/false", StartCalendarInterval: { Hour: 2, Minute: 0 } },
    "com.example.off.plist": { Label: "com.example.off", Program: "/bin/true", Disabled: true },
  };
  for (const f of Object.keys(plists)) writeFileSync(join(agents, f), "<plist/>");
  mkdirSync(join(home, ".claude", "scheduled-tasks", "standup"), { recursive: true });
  writeFileSync(join(home, ".claude", "scheduled-tasks", "standup", "SKILL.md"), "---\nname: Morning standup\ndescription: Summarise yesterday\n---\nBody");
  const run = async (cmd: string, args: string[]) => {
    if (cmd === "launchctl") return "PID\tStatus\tLabel\n412\t0\tcom.sapeled3.factoryd\n-\t0\tcom.example.backup\n-\t78\tcom.example.broken\n";
    if (cmd === "plutil") return JSON.stringify(plists[args.at(-1)!.split("/").pop()!]);
    if (cmd === "crontab") return "0 * * * * ~/bin/hourly\n";
    return "";
  };
  const rs = await machineRoutines({ home, platform: "darwin", run });
  const by = Object.fromEntries(rs.map((r) => [r.name, r]));
  assert.equal(by["com.sapeled3.factoryd"]!.state, "running");
  assert.equal(by["com.sapeled3.factoryd"]!.factory, true);
  assert.equal(by["com.example.backup"]!.state, "loaded");
  assert.equal(by["com.example.backup"]!.schedule, "every hour");
  assert.equal(by["com.example.broken"]!.state, "failing");
  assert.equal(by["com.example.broken"]!.detail, "last exit 78");
  assert.equal(by["com.example.off"]!.state, "disabled");
  assert.equal(by.hourly!.kind, "cron");
  assert.equal(by["Morning standup"]!.kind, "claude");
  assert.equal(rs.length, 6);
});
