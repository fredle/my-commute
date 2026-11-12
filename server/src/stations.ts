// Station search across National Rail (bundled list) and the Tube/DLR (TfL search).
import { readFileSync } from "node:fs";
import * as tfl from "./rail/tfl.ts";
import type { TflConfig } from "./rail/tfl.ts";
import type { Station } from "./types.ts";

interface RawStation {
  stationName: string;
  lat: number;
  long: number;
  crsCode: string;
}

// data/stations.json: UK railway stations by David Wheatley (github.com/davwheat/uk-railway-stations), ODbL 1.0.
const nationalRail: Station[] = (
  JSON.parse(readFileSync(new URL("../data/stations.json", import.meta.url), "utf8")) as RawStation[]
).map((s) => ({ id: s.crsCode, name: s.stationName, lat: s.lat, lon: s.long, network: "nr" as const }));

const byCrs = new Map(nationalRail.map((s) => [s.id, s]));

export function nationalRailStation(crs: string): Station | undefined {
  return byCrs.get(crs.toUpperCase());
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.?\b/g, "st")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best matches first: exact CRS code, then name prefix, then word prefix, then substring. */
export function searchNationalRail(query: string, limit = 10): Station[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const crs = query.trim().toUpperCase();
  const scored: { s: Station; score: number }[] = [];
  for (const s of nationalRail) {
    const name = normalise(s.name);
    let score = 0;
    if (s.id === crs) score = 4;
    else if (name.startsWith(q)) score = 3;
    else if (name.split(" ").some((w) => w.startsWith(q)) || name.includes(` ${q}`)) score = 2;
    else if (name.includes(q)) score = 1;
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

/** The closest National Rail stations to a point, for suggesting the one you drive to. */
export function nearestNationalRail(lat: number, lon: number, limit = 5): Station[] {
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const dist = (s: Station) => Math.hypot((s.lat - lat) * 110.57, (s.lon - lon) * kmPerDegLon);
  return [...nationalRail].sort((a, b) => dist(a) - dist(b)).slice(0, limit);
}

export async function search(config: TflConfig, query: string): Promise<Station[]> {
  const rail = searchNationalRail(query, 8);
  const underground = await tfl.search(config, query).catch(() => []);
  return [
    ...rail,
    ...underground.map((s) => ({ ...s, network: "tfl" as const })),
  ].slice(0, 15);
}
