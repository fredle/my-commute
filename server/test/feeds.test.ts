import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBoard, ukClockToUnix } from "../src/rail/nationalRail.ts";
import { dedupe, reaches, tidyName } from "../src/rail/tfl.ts";
import { shortReason } from "../src/shorten.ts";
import { nearestNationalRail, searchNationalRail } from "../src/stations.ts";

test("UK clock times land on the right day around midnight and in summer", () => {
  const winter = new Date("2026-11-12T07:00:00Z");
  assert.equal(ukClockToUnix("07:32", winter), Date.parse("2026-11-12T07:32:00Z") / 1000);
  const summer = new Date("2026-07-02T06:00:00Z"); // 07:00 BST
  assert.equal(ukClockToUnix("07:32", summer), Date.parse("2026-07-02T06:32:00Z") / 1000);
  const late = new Date("2026-11-12T23:50:00Z");
  assert.equal(ukClockToUnix("00:10", late), Date.parse("2026-11-13T00:10:00Z") / 1000);
  assert.equal(ukClockToUnix("23:40", new Date("2026-11-13T00:05:00Z")), Date.parse("2026-11-12T23:40:00Z") / 1000);
  assert.equal(ukClockToUnix("7:32", winter), null);
});

test("a departure board becomes services and a status", () => {
  const now = new Date("2026-11-12T07:00:00Z");
  const snap = parseBoard(
    {
      trainServices: [
        { std: "07:20", etd: "07:26", platform: "3", destination: [{ locationName: "Abbey Wood" }], delayReason: "This train has been delayed by a fault with the signalling system" },
        { std: "07:05", etd: "On time", platform: "4", destination: [{ locationName: "Shenfield" }] },
        { std: "07:12", etd: "Cancelled", isCancelled: true, destination: [{ locationName: "Abbey Wood" }], cancelReason: "This train has been cancelled because of a shortage of train crew" },
        { std: "07:40", etd: "Delayed", destination: [{ locationName: "Abbey Wood" }] },
      ],
      nrccMessages: [{ Value: "<p>The lift at platform 2 is out of order.</p>" }],
    },
    now,
  );
  assert.equal(snap.status.good, true);
  assert.deepEqual(
    snap.services.map((s) => [s.scheduled - now.getTime() / 1000, s.expected === null ? null : s.expected - now.getTime() / 1000, s.cancelled]),
    [
      [300, 300, false],
      [720, null, true],
      [1200, 1560, false],
      [2400, null, false],
    ],
  );
  assert.equal(snap.services[1]?.reason, "shortage of train crew");
  assert.equal(snap.services[0]?.platform, "4");

  const disrupted = parseBoard({ trainServices: [], nrccMessages: [{ value: "Disruption between Reading and London Paddington due to a points failure. More details..." }] }, now);
  assert.deepEqual(disrupted.status, { good: false, text: "Disruption: points failure" });
});

test("disruption reasons are cut down to the cause", () => {
  assert.equal(
    shortReason("ELIZABETH LINE: Severe delays between Paddington and Heathrow while we fix a track fault at Hayes and Harlington. Tickets accepted."),
    "track fault at Hayes & Harlington",
  );
  assert.equal(shortReason("x ".repeat(80)).length <= 60, true);
});

test("a Tube train counts only if its branch runs from → to → terminus", () => {
  const seqs = [
    ["A", "B", "C", "D"],
    ["A", "B", "E"],
  ];
  assert.equal(reaches(seqs, "A", "C", "D"), true);
  assert.equal(reaches(seqs, "A", "C", "E"), false);
  assert.equal(reaches(seqs, "A", "C", "B"), false); // terminates short
  assert.equal(reaches(seqs, "C", "A", "A"), false); // wrong way
  assert.equal(reaches(seqs, "A", "D", undefined), true);
  assert.equal(tidyName("Oxford Circus Underground Station"), "Oxford Circus");
  assert.equal(tidyName("Bank DLR Station"), "Bank (DLR)");
  assert.equal(tidyName("Abbey Wood Rail Station"), "Abbey Wood");
});

test("a Tube train listed twice counts once", () => {
  const s = (t: number, destination: string) => ({
    scheduled: t, expected: t, cancelled: false, platform: "8", destination, reason: null,
  });
  const out = dedupe([s(100, "Elephant & Castle"), s(400, "Elephant & Castle"), s(410, "Elephant & Castle"), s(410, "Queen's Park")]);
  assert.deepEqual(out.map((x) => [x.scheduled, x.destination]), [
    [100, "Elephant & Castle"],
    [400, "Elephant & Castle"],
    [410, "Queen's Park"],
  ]);
});

test("station search ranks codes and prefixes first", () => {
  assert.equal(searchNationalRail("HAY")[0]?.name, "Hayes & Harlington");
  assert.equal(searchNationalRail("liverpool st")[0]?.id, "LST");
  assert.equal(searchNationalRail("hayes and")[0]?.id, "HAY");
  assert.deepEqual(searchNationalRail("x"), []);
  assert.equal(nearestNationalRail(51.5031, -0.4207)[0]?.id, "HAY");
});
