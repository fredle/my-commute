// Turns train and drive readings into what the Live Activity shows. It leads with
// whatever is wrong and stays quiet when nothing is.
import type { ContentState, Departure, Direction, DriveEstimate, Stage, TrainSnapshot } from "./types.ts";

/** A next train further off than this is a problem in itself. */
export const TRAIN_GAP_MINUTES = 20;
/** Time to park and get to the platform after the drive. */
export const PARK_MINUTES = 5;
/** Trains leaving sooner than this can't be caught even from the platform. */
export const PLATFORM_MINUTES = 2;
/** A train at least this late is called out. */
export const LATE_MINUTES = 5;
/** Only trains leaving within this window are checked for cancellations and delays. */
const WATCH_MINUTES = 30;

export interface StateInput {
  direction: Direction;
  stage: Stage;
  train: TrainSnapshot | null;
  drive: DriveEstimate | null;
  slowDriveMinutes: number;
  /** Walk between work and its station, for the evening. */
  walkMinutes: number;
  now: Date;
  timeZone: string;
}

/** Which data a stage needs: no point fetching trains once you're on one. */
export function needs(direction: Direction, stage: Stage): { trains: boolean; drive: boolean } {
  if (stage === "arrived") return { trains: false, drive: false };
  if (direction === "toWork") {
    return { trains: stage !== "onTrain", drive: stage === "beforeLeaving" };
  }
  return { trains: stage === "beforeLeaving" || stage === "atStation", drive: true };
}

/** Minutes from now until you could be on the platform. */
export function minutesToPlatform(input: Pick<StateInput, "direction" | "stage" | "drive" | "walkMinutes">): number {
  if (input.stage !== "beforeLeaving") return PLATFORM_MINUTES;
  if (input.direction === "toWork") {
    return input.drive ? input.drive.minutes + PARK_MINUTES : PLATFORM_MINUTES;
  }
  return input.walkMinutes + PLATFORM_MINUTES;
}

export function makeState(input: StateInput): ContentState {
  const { train, drive, now, timeZone } = input;
  const problems: string[] = [];
  let departures: Departure[] = [];
  const nowSec = Math.floor(now.getTime() / 1000);

  if (train) {
    const earliest = nowSec + minutesToPlatform(input) * 60;
    // A train counts as catchable on whichever of its times is later.
    const reachable = train.services.filter((s) => Math.max(s.scheduled, s.expected ?? s.scheduled) >= earliest);

    if (!train.status.good) problems.push(`🚆 ${train.status.text}`);

    for (const s of reachable.filter((s) => s.scheduled - earliest <= WATCH_MINUTES * 60).slice(0, 3)) {
      const why = s.reason ? `: ${s.reason}` : "";
      if (s.cancelled) {
        problems.push(`🚆 ${clock(s.scheduled, timeZone)} cancelled${why}`);
      } else if (s.expected === null) {
        problems.push(`🚆 ${clock(s.scheduled, timeZone)} delayed${why}`);
      } else if (s.expected - s.scheduled >= LATE_MINUTES * 60) {
        problems.push(`🚆 ${clock(s.scheduled, timeZone)} ${Math.round((s.expected - s.scheduled) / 60)} min late${why}`);
      }
    }

    departures = reachable
      .filter((s) => !s.cancelled && s.expected !== null)
      .sort((a, b) => (a.expected as number) - (b.expected as number))
      .slice(0, 3)
      .map((s) => ({
        time: s.expected as number,
        late: s.expected === s.scheduled ? null : Math.round(((s.expected as number) - s.scheduled) / 60),
        platform: s.platform,
        destination: s.destination,
      }));

    const first = departures[0];
    if (!first) {
      problems.push("🚆 No trains listed");
    } else if (problems.length === 0 && first.time - earliest > TRAIN_GAP_MINUTES * 60) {
      problems.push(`🚆 Next train ${clock(first.time, timeZone)}`);
    }
  }

  const showDrive = drive !== null && needs(input.direction, input.stage).drive;
  if (showDrive && drive.minutes - drive.usualMinutes >= input.slowDriveMinutes) {
    problems.push(`🚗 Drive ${drive.minutes} min (+${drive.minutes - drive.usualMinutes})`);
  }

  return {
    problems,
    departures,
    driveMinutes: showDrive ? drive.minutes : null,
    stage: input.stage,
    updated: nowSec,
  };
}

/** Same content, ignoring when it was worked out. */
export function sameContent(a: ContentState, b: ContentState): boolean {
  return JSON.stringify({ ...a, updated: 0 }) === JSON.stringify({ ...b, updated: 0 });
}

/** Problems in `next` that weren't in `previous`: worth an alert, not just a quiet update. */
export function newProblems(previous: ContentState | null, next: ContentState): string[] {
  const seen = new Set(previous?.problems ?? []);
  return next.problems.filter((p) => !seen.has(p));
}

export function clock(unixSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(unixSeconds * 1000),
  );
}
