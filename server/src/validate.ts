// Checks what the app sends. Anything unexpected is refused with a reason rather
// than stored half-right.
import { parseClock, type Region, type RegionEvent } from "./schedule.ts";
import type { BankHolidayRegion, Coordinate, Direction, ScheduleEntry, Station, UserConfig } from "./types.ts";

export class Invalid extends Error {}

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid(`${what} must be an object`);
  return v as Json;
}

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new Invalid(`${what} must be a number from ${min} to ${max}`);
  }
  return v;
}

function str(v: unknown, what: string, pattern: RegExp): string {
  if (typeof v !== "string" || !pattern.test(v)) throw new Invalid(`${what} is not valid`);
  return v;
}

export function direction(v: unknown): Direction {
  if (v === "toWork" || v === "toHome") return v;
  throw new Invalid("direction must be toWork or toHome");
}

function coordinate(v: unknown, what: string): Coordinate {
  const o = obj(v, what);
  // UK and a margin around it; also stops a stray (0, 0).
  return { lat: num(o.lat, `${what}.lat`, 49, 61), lon: num(o.lon, `${what}.lon`, -9, 3) };
}

function station(v: unknown, what: string): Station {
  const o = obj(v, what);
  const network = o.network === "nr" || o.network === "tfl" ? o.network : null;
  if (!network) throw new Invalid(`${what}.network must be nr or tfl`);
  const id = str(o.id, `${what}.id`, network === "nr" ? /^[A-Z]{3}$/ : /^[0-9A-Z]{6,16}$/);
  const name = str(o.name, `${what}.name`, /^.{1,80}$/);
  const c = coordinate(o, what);
  return { id, name, lat: c.lat, lon: c.lon, network };
}

function scheduleEntry(v: unknown, i: number): ScheduleEntry {
  const o = obj(v, `schedule[${i}]`);
  const start = str(o.start, `schedule[${i}].start`, /^\d{2}:\d{2}$/);
  if (parseClock(start) === null) throw new Invalid(`schedule[${i}].start must be HH:mm`);
  return { day: num(o.day, `schedule[${i}].day`, 1, 7), direction: direction(o.direction), start };
}

const regions: BankHolidayRegion[] = ["england-and-wales", "scotland", "northern-ireland"];

export function userConfig(body: unknown): UserConfig {
  const o = obj(body, "body");
  const timeZone = str(o.timeZone, "timeZone", /^[A-Za-z_+\-/0-9]{1,64}$/);
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    throw new Invalid("timeZone is not a known time zone");
  }
  if (!Array.isArray(o.schedule) || o.schedule.length > 28) throw new Invalid("schedule must be a list of up to 28 entries");
  const bankHolidayRegion = regions.find((r) => r === o.bankHolidayRegion);
  if (!bankHolidayRegion) throw new Invalid(`bankHolidayRegion must be one of ${regions.join(", ")}`);
  const token = o.pushToStartToken;
  if (token !== null && token !== undefined) str(token, "pushToStartToken", /^[0-9a-f]{32,400}$/i);

  return {
    timeZone,
    home: o.home == null ? null : coordinate(o.home, "home"),
    homeStation: o.homeStation == null ? null : station(o.homeStation, "homeStation"),
    workStation: o.workStation == null ? null : station(o.workStation, "workStation"),
    schedule: o.schedule.map(scheduleEntry),
    slowDriveMinutes: num(o.slowDriveMinutes, "slowDriveMinutes", 1, 120),
    walkMinutes: num(o.walkMinutes, "walkMinutes", 0, 60),
    skipBankHolidays: o.skipBankHolidays === true,
    bankHolidayRegion,
    pausedUntil: o.pausedUntil == null ? null : str(o.pausedUntil, "pausedUntil", /^\d{4}-\d{2}-\d{2}$/),
    pushToStartToken: typeof token === "string" ? token.toLowerCase() : null,
    apnsEnvironment: o.apnsEnvironment === "sandbox" ? "sandbox" : "production",
  };
}

export function activityToken(body: unknown): string {
  return str(obj(body, "body").token, "token", /^[0-9a-f]{32,400}$/i).toLowerCase();
}

const regionNames: Region[] = ["home", "work", "homeStation", "workStation"];

export function regionEvent(body: unknown): RegionEvent {
  const o = obj(body, "body");
  const region = regionNames.find((r) => r === o.region);
  if (!region) throw new Invalid(`region must be one of ${regionNames.join(", ")}`);
  if (o.kind !== "enter" && o.kind !== "exit") throw new Invalid("kind must be enter or exit");
  return { region, kind: o.kind };
}
