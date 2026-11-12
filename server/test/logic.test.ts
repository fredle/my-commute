import assert from "node:assert/strict";
import { test } from "node:test";
import { makeState, newProblems, sameContent, type StateInput } from "../src/logic.ts";
import type { Service, TrainSnapshot } from "../src/types.ts";

const now = new Date("2026-11-12T07:00:00Z"); // 07:00 in London (GMT)
const t0 = now.getTime() / 1000;
const at = (min: number) => t0 + min * 60;

function service(min: number, extra: Partial<Service> = {}): Service {
  return { scheduled: at(min), expected: at(min), cancelled: false, platform: "4", destination: "Abbey Wood", reason: null, ...extra };
}

function input(train: TrainSnapshot | null, extra: Partial<StateInput> = {}): StateInput {
  return {
    direction: "toWork",
    stage: "atStation",
    train,
    drive: null,
    slowDriveMinutes: 10,
    walkMinutes: 8,
    now,
    timeZone: "Europe/London",
    ...extra,
  };
}

const good = { good: true, text: "Good service" };

test("all clear shows the next catchable trains and no problems", () => {
  const s = makeState(input({ status: good, services: [service(1), service(5), service(12), service(20), service(30)] }));
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.departures.map((d) => d.time), [at(5), at(12), at(20)]);
  assert.equal(s.departures[0]?.late, null);
});

test("before leaving in the morning, trains you can't reach after the drive are hidden", () => {
  const s = makeState(
    input(
      { status: good, services: [service(10), service(30), service(50)] },
      { stage: "beforeLeaving", drive: { minutes: 20, usualMinutes: 18 } },
    ),
  );
  // 20 min drive + 5 min parking: the 10-minute train is gone.
  assert.deepEqual(s.departures.map((d) => d.time), [at(30), at(50)]);
  assert.equal(s.driveMinutes, 20);
  assert.deepEqual(s.problems, []);
});

test("a slow drive is a problem", () => {
  const s = makeState(
    input({ status: good, services: [service(40)] }, { stage: "beforeLeaving", drive: { minutes: 35, usualMinutes: 20 } }),
  );
  assert.deepEqual(s.problems, ["🚗 Drive 35 min (+15)"]);
});

test("line disruption comes first, then cancelled and late trains", () => {
  const s = makeState(
    input({
      status: { good: false, text: "Severe delays: signal failure" },
      services: [
        service(5, { cancelled: true, expected: null, reason: "a broken down train" }),
        service(9, { expected: at(17) }),
        service(14),
      ],
    }),
  );
  assert.deepEqual(s.problems, [
    "🚆 Severe delays: signal failure",
    "🚆 07:05 cancelled: a broken down train",
    "🚆 07:09 8 min late",
  ]);
  // The cancelled train isn't offered; the late one shows its real time.
  assert.deepEqual(s.departures.map((d) => [d.time, d.late]), [[at(14), null], [at(17), 8]]);
});

test("a long gap to the next train is a problem", () => {
  const s = makeState(input({ status: good, services: [service(35)] }));
  assert.deepEqual(s.problems, ["🚆 Next train 07:35"]);
});

test("no trains at all is a problem", () => {
  const s = makeState(input({ status: good, services: [] }));
  assert.deepEqual(s.problems, ["🚆 No trains listed"]);
});

test("on the way home, the drive is shown even on the train", () => {
  const s = makeState(input(null, { direction: "toHome", stage: "onTrain", drive: { minutes: 30, usualMinutes: 28 } }));
  assert.equal(s.driveMinutes, 30);
  assert.deepEqual(s.departures, []);
});

test("in the evening, the walk to the station decides what's catchable", () => {
  const s = makeState(
    input({ status: good, services: [service(5), service(15)] }, { direction: "toHome", stage: "beforeLeaving" }),
  );
  assert.deepEqual(s.departures.map((d) => d.time), [at(15)]);
});

test("change detection ignores the timestamp, and only new problems alert", () => {
  const a = makeState(input({ status: good, services: [service(10)] }));
  const b = { ...a, updated: a.updated + 120 };
  assert.ok(sameContent(a, b));
  const c = { ...a, problems: ["🚆 X", "🚗 Y"] };
  assert.deepEqual(newProblems({ ...a, problems: ["🚆 X"] }, c), ["🚗 Y"]);
  assert.deepEqual(newProblems(null, c), ["🚆 X", "🚗 Y"]);
});
