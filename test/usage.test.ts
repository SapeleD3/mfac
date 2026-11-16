import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, parseLimits, reading } from "../src/claude/usage.js";

test("the meter shows Claude's own plan limits, and unknown instead of a guess once they reset", () => {
  const now = Date.parse("2026-11-16T15:20:00Z");
  const input = {
    rate_limits: { five_hour: { used_percentage: 32, resets_at: Date.parse("2026-11-16T16:00:00Z") / 1000 }, seven_day: { used_percentage: 16, resets_at: Date.parse("2026-11-22T13:00:00Z") / 1000 } },
  };
  const limits = parseLimits(input, now)!;
  const r = reading(limits, { ceiling: 0.85, now });
  assert.equal(r.share, 0.32);
  assert.equal(r.weekly, 0.16);
  assert.equal(r.basis, "claude");
  assert.equal(r.blocked, false);
  assert.equal(r.windowEndsAt, "2026-11-16T16:00:00.000Z");
  assert.equal(describe(r), "5h 32% · week 16%");

  const full = reading(parseLimits({ rate_limits: { five_hour: { used_percentage: 90, resets_at: input.rate_limits.five_hour.resets_at } } }, now), { ceiling: 0.85, now });
  assert.equal(full.blocked, true);
  assert.match(full.reason!, /90% of the 5-hour limit; resumes/);
  const weekFull = reading(parseLimits({ rate_limits: { seven_day: { used_percentage: 86, resets_at: input.rate_limits.seven_day.resets_at } } }, now), { ceiling: 0.85, now });
  assert.equal(weekFull.blocked, true);
  assert.match(weekFull.reason!, /86% of the weekly limit/);

  const later = reading(limits, { ceiling: 0.85, now: Date.parse("2026-11-16T16:01:00Z") });
  assert.equal(later.share, undefined, "the 5-hour reading is dropped once its window resets");
  assert.equal(later.weekly, 0.16);
  assert.equal(parseLimits({}), undefined, "a session without rate_limits (API keys, before the first reply) changes nothing");
  const none = reading(undefined, { ceiling: 0.85, now });
  assert.deepEqual([none.basis, none.share, none.blocked], ["unknown", undefined, false]);
  assert.equal(describe(none), "plan usage unknown");
});
