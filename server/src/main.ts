// Entry point: reads settings from the environment, serves the API and runs the
// scheduler. See server/README.md for the variables.
import { Apns } from "./apns.ts";
import { Commutes } from "./commutes.ts";
import { Store } from "./db.ts";
import { DriveTimes } from "./drive.ts";
import { createApi } from "./http.ts";
import { loadP8 } from "./jwt.ts";

import { existsSync, readFileSync } from "node:fs";

// A secret can be given directly (APNS_PRIVATE_KEY) or as a file path (APNS_PRIVATE_KEY_FILE),
// which suits multi-line .p8 keys mounted into a container. A file that isn't there yet
// just leaves that feature off, like a missing variable.
const env: Record<string, string | undefined> = { ...process.env };
for (const [name, path] of Object.entries(process.env)) {
  if (!name.endsWith("_FILE") || !path || !existsSync(path)) continue;
  const target = name.slice(0, -"_FILE".length);
  if (!env[target]) env[target] = readFileSync(path, "utf8").trim();
}

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));
}

function optional<T>(names: string[], make: () => T, what: string): T | null {
  const missing = names.filter((n) => !env[n]);
  if (missing.length === 0) return make();
  log(`${what} disabled`, { missing });
  return null;
}

const teamId = env.APPLE_TEAM_ID ?? "";
const store = new Store(env.DATABASE_PATH ?? "commute.db");

const apns = optional(
  ["APPLE_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY", "APP_BUNDLE_ID"],
  () => new Apns({ teamId, keyId: env.APNS_KEY_ID!, key: loadP8(env.APNS_PRIVATE_KEY!), bundleId: env.APP_BUNDLE_ID! }),
  "Live Activity pushes",
);
const drive = optional(
  ["APPLE_TEAM_ID", "MAPS_KEY_ID", "MAPS_PRIVATE_KEY"],
  () => new DriveTimes({ teamId, keyId: env.MAPS_KEY_ID!, key: loadP8(env.MAPS_PRIVATE_KEY!) }),
  "Drive times",
);
const nationalRail = optional(
  ["RAIL_DATA_API_KEY"],
  () => ({
    apiKey: env.RAIL_DATA_API_KEY!,
    baseUrl: env.RAIL_DATA_LDBWS_URL ?? "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120",
  }),
  "National Rail departures",
);
const tfl = { appKey: env.TFL_APP_KEY ?? null };

const commutes = new Commutes({ store, apns, drive, nationalRail, tfl, log });
const server = createApi({ store, commutes, tfl, log });
const port = Number(env.PORT ?? 8080);
server.listen(port, () => log("listening", { port }));

// One pass at a time: a slow upstream must not stack passes on top of each other.
let busy = false;
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const now = new Date();
    await commutes.startDue(now);
    await commutes.refreshAll(now);
    store.prune(now.getTime());
  } catch (error) {
    log("tick failed", { error: String(error) });
  } finally {
    busy = false;
  }
}
const timer = setInterval(() => void tick(), 30_000);
void tick();

function shutdown(): void {
  clearInterval(timer);
  server.close();
  apns?.close();
  store.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
