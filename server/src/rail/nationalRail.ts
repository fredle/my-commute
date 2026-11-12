// National Rail departures from the Live Departure Board web service (LDBWS) on the
// Rail Data Marketplace. Covers every GB station with a CRS code, including the
// Elizabeth line and London Overground.
import { fetchJson } from "../fetchJson.ts";
import { plainText, shortReason } from "../shorten.ts";
import type { LineStatus, Service, TrainSnapshot } from "../types.ts";

export interface NationalRailConfig {
  apiKey: string;
  /** e.g. https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120 */
  baseUrl: string;
}

interface Location {
  locationName?: string;
  crs?: string;
}

export interface ServiceDTO {
  std?: string;
  etd?: string;
  platform?: string | null;
  isCancelled?: boolean;
  cancelReason?: string | null;
  delayReason?: string | null;
  destination?: Location[];
}

export interface BoardDTO {
  trainServices?: ServiceDTO[] | null;
  nrccMessages?: { Value?: string; value?: string }[] | null;
}

export async function snapshot(config: NationalRailConfig, from: string, to: string, now: Date): Promise<TrainSnapshot> {
  const url = `${config.baseUrl}/GetDepBoardWithDetails/${encodeURIComponent(from)}?numRows=9&filterCrs=${encodeURIComponent(to)}&filterType=to&timeWindow=120`;
  const board = await fetchJson<BoardDTO>(url, { headers: { "x-apikey": config.apiKey }, ttlSeconds: 45 });
  return parseBoard(board, now);
}

export function parseBoard(board: BoardDTO, now: Date): TrainSnapshot {
  const services: Service[] = [];
  for (const s of board.trainServices ?? []) {
    const scheduled = s.std ? ukClockToUnix(s.std, now) : null;
    if (scheduled === null) continue;
    const etd = (s.etd ?? "").trim();
    const cancelled = s.isCancelled === true || /^cancel/i.test(etd);
    let expected: number | null = scheduled;
    if (cancelled) expected = null;
    else if (/^\d{2}:\d{2}$/.test(etd)) expected = ukClockToUnix(etd, now);
    else if (/^delayed$/i.test(etd)) expected = null;

    const why = cancelled ? s.cancelReason : s.delayReason;
    services.push({
      scheduled,
      expected,
      cancelled,
      platform: s.platform ? String(s.platform) : null,
      destination: (s.destination ?? []).map((d) => d.locationName ?? "").filter(Boolean).join(" & "),
      reason: why ? shortReason(why, 40) : null,
    });
  }
  services.sort((a, b) => a.scheduled - b.scheduled);
  return { status: summarise(board), services };
}

const disruption = /\b(disrupt|delay|cancel|clos|suspend|no trains|reduced service|strike|industrial action|block)/i;

/**
 * Station messages cover everything from broken lifts to blocked lines; only the ones
 * that sound like they affect trains count.
 */
function summarise(board: BoardDTO): LineStatus {
  const messages = (board.nrccMessages ?? []).map((m) => plainText(m.Value ?? m.value ?? "")).filter(Boolean);
  const relevant = messages.find((m) => disruption.test(m));
  if (!relevant) return { good: true, text: "Good service" };
  return { good: false, text: `Disruption: ${shortReason(relevant)}` };
}

/** "07:32" on the UK clock, taken as the nearest such moment to `now` (handles midnight). */
export function ukClockToUnix(hhmm: string, now: Date): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day);
  const wallNow = Date.UTC(y, mo - 1, d, Number(parts.hour), Number(parts.minute));
  const offset = wallNow - Math.floor(now.getTime() / 60_000) * 60_000;
  let t = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2])) - offset;
  const day = 86_400_000;
  if (t < now.getTime() - day / 2) t += day;
  if (t > now.getTime() + day / 2) t -= day;
  return Math.floor(t / 1000);
}
