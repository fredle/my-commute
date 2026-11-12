// Shapes shared with the iOS app. Keep in step with ios/Shared/CommuteAttributes.swift
// and ios/MyCommute/CommuteConfig.swift.

export type Direction = "toWork" | "toHome";
export type Network = "nr" | "tfl";

/** National Rail stations are keyed by CRS code ("HAY"), TfL ones by NaPTAN id ("940GZZLUOXC"). */
export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  network: Network;
}

export interface Coordinate {
  lat: number;
  lon: number;
}

/** One alert window: on `day` (1 = Monday … 7 = Sunday) at `start` ("HH:mm", user's time zone). */
export interface ScheduleEntry {
  day: number;
  direction: Direction;
  start: string;
}

export type BankHolidayRegion = "england-and-wales" | "scotland" | "northern-ireland";

export interface UserConfig {
  timeZone: string;
  /** Rounded on the device to about 100 m; used only for drive-time estimates. */
  home: Coordinate | null;
  /** The station you drive to in the morning, and the one you travel to. */
  homeStation: Station | null;
  workStation: Station | null;
  schedule: ScheduleEntry[];
  /** A drive this many minutes slower than it is with no traffic counts as a problem. */
  slowDriveMinutes: number;
  /** Walk from work to its station, so evening trains you can't reach aren't shown. */
  walkMinutes: number;
  skipBankHolidays: boolean;
  bankHolidayRegion: BankHolidayRegion;
  /** ISO date (YYYY-MM-DD); no scheduled commutes up to and including this day. */
  pausedUntil: string | null;
  /** Live Activity push-to-start token, hex. */
  pushToStartToken: string | null;
  apnsEnvironment: "production" | "sandbox";
}

export type Stage = "beforeLeaving" | "driving" | "atStation" | "onTrain" | "arrived";

export interface Departure {
  /** Unix seconds, expected (not scheduled) departure. */
  time: number;
  /** Minutes late against the timetable, when known. */
  late: number | null;
  platform: string | null;
  destination: string;
}

/** Mirrors CommuteAttributes.ContentState. Times are Unix seconds. */
export interface ContentState {
  problems: string[];
  departures: Departure[];
  driveMinutes: number | null;
  stage: Stage;
  updated: number;
}

/** Mirrors CommuteAttributes (the fixed part of a Live Activity). */
export interface ActivityAttributes {
  commuteId: string;
  direction: Direction;
  fromName: string;
  toName: string;
}

export interface LineStatus {
  good: boolean;
  /** Short, Lock Screen sized, e.g. "Severe delays: signal failure at Reading". */
  text: string;
}

/** One train from the origin that reaches the destination, as the feed reports it. */
export interface Service {
  /** Unix seconds. TfL gives no timetable, so this equals `expected` there. */
  scheduled: number;
  /** Unix seconds; null when cancelled or "Delayed" with no estimate. */
  expected: number | null;
  cancelled: boolean;
  platform: string | null;
  destination: string;
  /** Why it is cancelled or late, shortened, when the feed says. */
  reason: string | null;
}

export interface TrainSnapshot {
  status: LineStatus;
  /** Soonest first. */
  services: Service[];
}

export interface DriveEstimate {
  minutes: number;
  /** Minutes the same drive takes with no traffic. */
  usualMinutes: number;
}
