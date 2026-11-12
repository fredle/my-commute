// London Underground and DLR from the TfL Unified API. National Rail stations go
// through nationalRail.ts; until that's set up, TfL's own rail lines (Elizabeth line,
// Overground) stand in for the stations they serve (see railStationsNear).
import { fetchJson } from "../fetchJson.ts";
import { shortReason } from "../shorten.ts";
import type { LineStatus, Service, TrainSnapshot } from "../types.ts";

/** Modes offered in station search. */
export const TFL_MODES = ["tube", "dlr"];
/** Modes whose trains we can follow from station to station. */
const RAIL_MODES = ["tube", "dlr", "elizabeth-line", "overground"];
const BASE = "https://api.tfl.gov.uk";

export interface TflConfig {
  /** Optional; raises the rate limit from 50 to 500 requests a minute. */
  appKey: string | null;
}

function url(config: TflConfig, path: string): string {
  if (!config.appKey) return BASE + path;
  return `${BASE}${path}${path.includes("?") ? "&" : "?"}app_key=${encodeURIComponent(config.appKey)}`;
}

interface StopPointDTO {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  stopType?: string;
  modes?: string[];
  lineModeGroups?: { modeName: string; lineIdentifier: string[] }[];
  children?: StopPointDTO[];
}

interface ArrivalDTO {
  lineId: string;
  naptanId?: string;
  platformName?: string;
  direction?: string;
  destinationNaptanId?: string;
  destinationName?: string;
  towards?: string;
  expectedArrival: string;
}

interface RouteSequenceDTO {
  orderedLineRoutes?: { naptanIds: string[] }[];
}

interface LineStatusDTO {
  id: string;
  name: string;
  lineStatuses: { statusSeverity: number; statusSeverityDescription: string; reason?: string }[];
}

export interface TflStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Station search, with interchange hubs ("Bank") expanded into their Tube and DLR stations. */
export async function search(config: TflConfig, query: string): Promise<TflStation[]> {
  const res = await fetchJson<{ matches?: { id: string; name: string; lat: number; lon: number }[] }>(
    url(config, `/StopPoint/Search/${encodeURIComponent(query)}?modes=${TFL_MODES.join(",")}&maxResults=8`),
    { ttlSeconds: 3600 },
  );
  const out: TflStation[] = [];
  for (const m of res.matches ?? []) {
    if (!m.id.startsWith("HUB")) {
      out.push({ id: m.id, name: tidyName(m.name), lat: m.lat, lon: m.lon });
      continue;
    }
    const hub = await fetchJson<StopPointDTO>(url(config, `/StopPoint/${m.id}`), { ttlSeconds: 86_400 }).catch(() => null);
    for (const c of hub?.children ?? []) {
      if (c.stopType !== "NaptanMetroStation" || !(c.modes ?? []).some((x) => TFL_MODES.includes(x))) continue;
      out.push({ id: c.id, name: tidyName(c.commonName), lat: c.lat, lon: c.lon });
    }
  }
  return out;
}

export function tidyName(name: string): string {
  return name
    .replace(/ (Underground|DLR) Station$/, (_, mode: string) => (mode === "DLR" ? " (DLR)" : ""))
    .replace(/ Rail Station$/, "")
    .trim();
}

/**
 * TfL's ids for the Elizabeth line and Overground stations at a National Rail
 * station's position. A big station can have several (Liverpool Street has one
 * record for the Overground and one for the Elizabeth line's deep platforms).
 */
export async function railStationsNear(config: TflConfig, lat: number, lon: number): Promise<string[]> {
  const res = await fetchJson<{ stopPoints?: StopPointDTO[] }>(
    url(config, `/StopPoint?lat=${lat}&lon=${lon}&stopTypes=NaptanRailStation&radius=400&modes=elizabeth-line,overground`),
    { ttlSeconds: 86_400 },
  );
  return (res.stopPoints ?? []).map((s) => s.id);
}

/** Lines that serve one of the `from` stations and one of the `to` stations. */
async function sharedLines(config: TflConfig, from: string[], to: string[]): Promise<string[]> {
  const lines = async (ids: string[]) => {
    const stops = await Promise.all(
      ids.map((id) => fetchJson<StopPointDTO>(url(config, `/StopPoint/${id}`), { ttlSeconds: 86_400 }).catch(() => null)),
    );
    return new Set(
      stops.flatMap((s) => (s?.lineModeGroups ?? []).filter((g) => RAIL_MODES.includes(g.modeName)).flatMap((g) => g.lineIdentifier)),
    );
  };
  const [a, b] = await Promise.all([lines(from), lines(to)]);
  return [...a].filter((l) => b.has(l));
}

async function routes(config: TflConfig, line: string): Promise<string[][]> {
  const both = await Promise.all(
    ["inbound", "outbound"].map((dir) =>
      fetchJson<RouteSequenceDTO>(url(config, `/Line/${line}/Route/Sequence/${dir}?excludeCrowding=true`), {
        ttlSeconds: 86_400,
      }).catch(() => ({}) as RouteSequenceDTO),
    ),
  );
  return both.flatMap((r) => (r.orderedLineRoutes ?? []).map((x) => x.naptanIds));
}

/**
 * Whether a train from `from` heading for `terminus` calls at `to`: some branch must
 * run from → to → terminus in that order. With no terminus given (TfL sometimes
 * says "Check Front of Train"), a branch with from before to is enough.
 */
export function reaches(sequences: string[][], from: string, to: string, terminus: string | undefined): boolean {
  return sequences.some((seq) => {
    const i = seq.indexOf(from), j = seq.indexOf(to);
    if (i < 0 || j < 0 || i >= j) return false;
    if (!terminus) return true;
    const k = seq.indexOf(terminus);
    return k >= j;
  });
}

/**
 * Trains from `from` that call at `to`. Either side can be several TfL ids for the
 * same place (see railStationsNear); a train counts if it runs from any of the one
 * to any of the other.
 */
export async function snapshot(
  config: TflConfig,
  from: string | string[],
  to: string | string[],
  now: Date,
): Promise<TrainSnapshot> {
  const froms = [from].flat(), tos = [to].flat();
  const lines = await sharedLines(config, froms, tos);
  if (lines.length === 0) {
    return { status: { good: false, text: "No direct line between these stations" }, services: [] };
  }
  const [arrivals, statuses, sequences] = await Promise.all([
    Promise.all(
      froms.map((id) =>
        fetchJson<ArrivalDTO[]>(url(config, `/StopPoint/${id}/Arrivals`), { ttlSeconds: 30 }).then((list) =>
          list.map((a) => ({ ...a, naptanId: a.naptanId ?? id })),
        ),
      ),
    ).then((all) => all.flat()),
    fetchJson<LineStatusDTO[]>(url(config, `/Line/${lines.join(",")}/Status`), { ttlSeconds: 60 }),
    Promise.all(lines.map((l) => routes(config, l).then((r) => [l, r] as const))),
  ]);
  const byLine = new Map(sequences);
  const nowSec = now.getTime() / 1000;
  const goes = (a: ArrivalDTO) =>
    tos.some((t) => reaches(byLine.get(a.lineId) ?? [], a.naptanId!, t, a.destinationNaptanId));

  const services: Service[] = arrivals
    .filter((a) => lines.includes(a.lineId) && goes(a))
    .map((a) => {
      const t = Math.floor(Date.parse(a.expectedArrival) / 1000);
      return {
        scheduled: t,
        expected: t,
        cancelled: false,
        platform: platformNumber(a.platformName),
        destination: tidyName(a.destinationName ?? a.towards ?? ""),
        reason: null,
      };
    })
    .filter((s) => Number.isFinite(s.scheduled) && s.scheduled >= nowSec - 30)
    .sort((x, y) => x.scheduled - y.scheduled);

  return { status: summarise(statuses), services: dedupe(services) };
}

/**
 * TfL sometimes lists the same train twice (one prediction per platform board, or
 * per line on shared track). Same terminus within 30 seconds counts as one train.
 */
export function dedupe(services: Service[]): Service[] {
  const out: Service[] = [];
  for (const s of services) {
    const twin = out.find((o) => o.destination === s.destination && Math.abs(o.scheduled - s.scheduled) <= 30);
    if (!twin) out.push(s);
  }
  return out;
}

/** "Westbound - Platform 3" → "3". */
function platformNumber(name: string | undefined): string | null {
  const m = /Platform\s+(\w+)/i.exec(name ?? "");
  return m?.[1] ?? null;
}

function summarise(lines: LineStatusDTO[]): LineStatus {
  // Severity 10 is Good Service; 18 and 19 are "No Issues" / information only.
  const bad = lines.flatMap((l) =>
    l.lineStatuses.filter((s) => ![10, 18, 19].includes(s.statusSeverity)).map((s) => ({ line: l.name, s })),
  );
  const first = bad[0];
  if (!first) return { good: true, text: "Good service" };
  const reason = first.s.reason ? `: ${shortReason(first.s.reason)}` : "";
  const prefix = lines.length > 1 ? `${first.line} ` : "";
  return { good: false, text: `${prefix}${first.s.statusSeverityDescription}${reason}` };
}
