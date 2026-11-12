import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Apns } from "../src/apns.ts";
import { Commutes } from "../src/commutes.ts";
import { Store } from "../src/db.ts";
import { createApi } from "../src/http.ts";
import type { UserConfig } from "../src/types.ts";

interface Sent {
  token: string;
  payload: { aps: Record<string, unknown> };
  priority: number;
}

function fakeApns(sent: Sent[], status = 200) {
  return {
    send: async (_env: string, token: string, payload: object, priority: number) => {
      sent.push({ token, payload: payload as Sent["payload"], priority });
      return { ok: status === 200, status, gone: status === 410 };
    },
    close() {},
  } as unknown as Apns;
}

const config: UserConfig = {
  timeZone: "Europe/London",
  home: { lat: 51.53, lon: -0.45 },
  homeStation: { id: "HAY", name: "Hayes & Harlington", lat: 51.503, lon: -0.419, network: "nr" },
  workStation: { id: "LST", name: "London Liverpool Street", lat: 51.518, lon: -0.081, network: "nr" },
  schedule: [{ day: 4, direction: "toWork", start: "07:00" }],
  slowDriveMinutes: 10,
  walkMinutes: 5,
  skipBankHolidays: false,
  bankHolidayRegion: "england-and-wales",
  pausedUntil: null,
  pushToStartToken: "aa".repeat(40),
  apnsEnvironment: "production",
};

function setup(status = 200) {
  const sent: Sent[] = [];
  const store = new Store(":memory:");
  const commutes = new Commutes({ store, apns: fakeApns(sent, status), drive: null, nationalRail: null, tfl: { appKey: null }, log: () => {} });
  return { sent, store, commutes };
}

test("a scheduled commute starts once by push-to-start, then refreshes and ends on arrival", async () => {
  const { sent, store, commutes } = setup();
  store.putUser("u1", config);
  const start = new Date("2026-11-12T07:01:00Z"); // Thursday

  await commutes.startDue(start);
  await commutes.startDue(new Date(start.getTime() + 30_000));
  assert.equal(sent.length, 1, "started once only");
  const aps = sent[0]!.payload.aps;
  assert.equal(aps.event, "start");
  assert.equal(aps["attributes-type"], "CommuteAttributes");
  const attributes = aps.attributes as { commuteId: string; fromName: string };
  assert.equal(attributes.fromName, "Hayes & Harlington");

  const commute = store.getCommute(attributes.commuteId)!;
  commutes.setActivityToken(commute, "bb".repeat(40));

  // Not yet due a refresh; then due.
  await commutes.refreshAll(new Date(start.getTime() + 60_000));
  assert.equal(sent.length, 1);
  await commutes.refreshAll(new Date(start.getTime() + 6 * 60_000));
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.payload.aps.event, "update");
  assert.equal(sent[1]!.token, "bb".repeat(40));

  const running = store.getCommute(attributes.commuteId)!;
  const stage = await commutes.regionEvent(running, config, { region: "home", kind: "exit" }, new Date(start.getTime() + 7 * 60_000));
  assert.equal(stage, "driving");
  assert.equal(sent.at(-1)!.priority, 10, "a stage change is pushed straight away");

  await commutes.regionEvent(store.getCommute(attributes.commuteId)!, config, { region: "workStation", kind: "enter" });
  assert.equal(sent.at(-1)!.payload.aps.event, "end");
  assert.ok(store.getCommute(attributes.commuteId)!.ended);
});

test("a push-to-start token Apple has dropped is forgotten", async () => {
  const { store, commutes } = setup(410);
  store.putUser("u1", config);
  await commutes.startDue(new Date("2026-11-12T07:01:00Z"));
  assert.equal(store.getUser("u1")!.pushToStartToken, null);
});

test("the API needs a token, validates settings and keeps users apart", async () => {
  const { store, commutes } = setup();
  const server = createApi({ store, commutes, tfl: { appKey: null }, log: () => {} });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, token: string | null, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    });
  const alice = "a".repeat(43);
  const bob = "b".repeat(43);

  try {
    assert.equal((await call("/v1/me", null)).status, 401);
    assert.equal((await call("/v1/me", alice, { method: "PUT", body: JSON.stringify({ ...config, timeZone: "Mars/Base" }) })).status, 400);
    assert.equal((await call("/v1/me", alice, { method: "PUT", body: JSON.stringify(config) })).status, 200);
    assert.equal(((await (await call("/v1/me", alice)).json()) as UserConfig).homeStation?.id, "HAY");

    const started = await call("/v1/commutes", alice, { method: "POST", body: JSON.stringify({ direction: "toWork" }) });
    assert.equal(started.status, 200);
    const { attributes } = (await started.json()) as { attributes: { commuteId: string } };

    // Bob can't touch Alice's commute.
    await call("/v1/me", bob, { method: "PUT", body: JSON.stringify(config) });
    const token = JSON.stringify({ token: "cc".repeat(40) });
    assert.equal((await call(`/v1/commutes/${attributes.commuteId}/token`, bob, { method: "PUT", body: token })).status, 404);
    assert.equal((await call(`/v1/commutes/${attributes.commuteId}/token`, alice, { method: "PUT", body: token })).status, 200);

    assert.equal((await call("/v1/me", alice, { method: "DELETE" })).status, 204);
    assert.equal(store.getUser(store.getCommute(attributes.commuteId)?.userId ?? "none"), null);
    assert.equal((await call("/v1/me", alice)).status, 404);
  } finally {
    server.close();
  }
});
