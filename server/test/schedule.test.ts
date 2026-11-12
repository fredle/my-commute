import assert from "node:assert/strict";
import { test } from "node:test";
import { dueEntries, localTime, nextStage } from "../src/schedule.ts";
import type { UserConfig } from "../src/types.ts";

const config: UserConfig = {
  timeZone: "Europe/London",
  home: null,
  homeStation: null,
  workStation: null,
  schedule: [
    { day: 4, direction: "toWork", start: "07:00" },
    { day: 4, direction: "toHome", start: "17:30" },
    { day: 5, direction: "toWork", start: "07:00" },
  ],
  slowDriveMinutes: 10,
  walkMinutes: 5,
  skipBankHolidays: true,
  bankHolidayRegion: "england-and-wales",
  pausedUntil: null,
  pushToStartToken: "ab",
  apnsEnvironment: "production",
};

const none = new Set<string>();

test("local time follows the user's zone, including summer time", () => {
  assert.deepEqual(localTime(new Date("2026-11-12T07:05:00Z"), "Europe/London"), { date: "2026-11-12", weekday: 4, minutes: 425 });
  assert.equal(localTime(new Date("2026-07-02T06:05:00Z"), "Europe/London").minutes, 7 * 60 + 5);
});

test("an entry is due from its start time for the grace period, on its day only", () => {
  // Thursday 12 November 2026.
  assert.deepEqual(dueEntries(config, new Date("2026-11-12T06:59:00Z"), none), []);
  assert.deepEqual(dueEntries(config, new Date("2026-11-12T07:00:00Z"), none).map((e) => e.direction), ["toWork"]);
  assert.deepEqual(dueEntries(config, new Date("2026-11-12T07:19:00Z"), none).map((e) => e.direction), ["toWork"]);
  assert.deepEqual(dueEntries(config, new Date("2026-11-12T07:20:00Z"), none), []);
  assert.deepEqual(dueEntries(config, new Date("2026-11-12T17:31:00Z"), none).map((e) => e.direction), ["toHome"]);
});

test("pauses and bank holidays skip the day", () => {
  const thursday7 = new Date("2026-11-12T07:01:00Z");
  assert.deepEqual(dueEntries({ ...config, pausedUntil: "2026-11-12" }, thursday7, none), []);
  assert.equal(dueEntries({ ...config, pausedUntil: "2026-11-11" }, thursday7, none).length, 1);
  assert.deepEqual(dueEntries(config, thursday7, new Set(["2026-11-12"])), []);
  assert.equal(dueEntries({ ...config, skipBankHolidays: false }, thursday7, new Set(["2026-11-12"])).length, 1);
});

test("morning stages move forward with geofences", () => {
  let s = nextStage("toWork", "beforeLeaving", { region: "home", kind: "exit" });
  assert.equal(s, "driving");
  s = nextStage("toWork", s, { region: "homeStation", kind: "enter" });
  assert.equal(s, "atStation");
  s = nextStage("toWork", s, { region: "homeStation", kind: "exit" });
  assert.equal(s, "onTrain");
  // Never backwards.
  assert.equal(nextStage("toWork", s, { region: "home", kind: "exit" }), "onTrain");
  assert.equal(nextStage("toWork", s, { region: "workStation", kind: "enter" }), "arrived");
});

test("the first readings when monitoring starts don't move a commute on", () => {
  // At home at 07:00: "not at either station", "not at work".
  for (const region of ["homeStation", "workStation", "work"] as const) {
    assert.equal(nextStage("toWork", "beforeLeaving", { region, kind: "exit" }), "beforeLeaving");
  }
  assert.equal(nextStage("toWork", "beforeLeaving", { region: "home", kind: "enter" }), "beforeLeaving");
  // At work at 17:30, or working from home.
  for (const region of ["homeStation", "workStation", "home"] as const) {
    assert.equal(nextStage("toHome", "beforeLeaving", { region, kind: "exit" }), "beforeLeaving");
  }
  assert.equal(nextStage("toHome", "beforeLeaving", { region: "home", kind: "enter" }), "beforeLeaving");
});

test("evening stages move forward with geofences", () => {
  let s = nextStage("toHome", "beforeLeaving", { region: "work", kind: "exit" });
  assert.equal(s, "beforeLeaving");
  s = nextStage("toHome", s, { region: "workStation", kind: "enter" });
  assert.equal(s, "atStation");
  s = nextStage("toHome", s, { region: "workStation", kind: "exit" });
  assert.equal(s, "onTrain");
  s = nextStage("toHome", s, { region: "homeStation", kind: "enter" });
  assert.equal(s, "driving");
  assert.equal(nextStage("toHome", s, { region: "home", kind: "enter" }), "arrived");
});
