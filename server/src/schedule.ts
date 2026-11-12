// When commutes start, and how they move from stage to stage.
import type { Direction, ScheduleEntry, Stage, UserConfig } from "./types.ts";

/** A scheduled start is still honoured this long after its time (missed ticks, restarts). */
export const GRACE_MINUTES = 20;
/** A commute ends by itself after this long, arrived or not. */
export const MAX_HOURS: Record<Direction, number> = { toWork: 3, toHome: 4 };

export interface LocalTime {
  /** YYYY-MM-DD in the user's time zone. */
  date: string;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  minutes: number;
}

const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function parseClock(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Schedule entries whose start time has just passed today, skipping pauses and bank holidays. */
export function dueEntries(config: UserConfig, now: Date, bankHolidays: ReadonlySet<string>): ScheduleEntry[] {
  const local = localTime(now, config.timeZone);
  if (config.pausedUntil && local.date <= config.pausedUntil) return [];
  if (config.skipBankHolidays && bankHolidays.has(local.date)) return [];
  return config.schedule.filter((entry) => {
    const start = parseClock(entry.start);
    if (start === null || entry.day !== local.weekday) return false;
    return local.minutes >= start && local.minutes < start + GRACE_MINUTES;
  });
}

export type Region = "home" | "work" | "homeStation" | "workStation";
export type RegionEvent = { region: Region; kind: "enter" | "exit" };

type Move = { from: Stage[]; to: Stage };

// Each move is allowed only from the stages it can follow. When the phone starts
// watching a region it reports that region's current state straight away (say, "not at
// the station" while you're still at home), and those first readings must not count.
// Moves only go forward, so a wobble at a region's edge can't send you back a stage.
const moves: Record<Direction, Partial<Record<string, Move>>> = {
  toWork: {
    "exit:home": { from: ["beforeLeaving"], to: "driving" },
    "enter:homeStation": { from: ["beforeLeaving", "driving"], to: "atStation" },
    "exit:homeStation": { from: ["atStation"], to: "onTrain" },
    "enter:workStation": { from: ["driving", "atStation", "onTrain"], to: "arrived" },
    "enter:work": { from: ["driving", "atStation", "onTrain"], to: "arrived" },
  },
  toHome: {
    "enter:workStation": { from: ["beforeLeaving"], to: "atStation" },
    "exit:workStation": { from: ["atStation"], to: "onTrain" },
    "enter:homeStation": { from: ["atStation", "onTrain"], to: "driving" },
    "exit:homeStation": { from: ["onTrain"], to: "driving" },
    "enter:home": { from: ["onTrain", "driving"], to: "arrived" },
  },
};

/** Moves a commute on from a geofence event reported by the phone. */
export function nextStage(direction: Direction, stage: Stage, event: RegionEvent): Stage {
  const move = moves[direction][`${event.kind}:${event.region}`];
  return move && move.from.includes(stage) ? move.to : stage;
}
