// Starts, refreshes and ends commutes. Live Activity content is only ever written
// from here (the phone reports where it is; it never edits the activity itself),
// so there is a single source of truth.
import { randomUUID } from "node:crypto";
import { endPayload, startPayload, updatePayload, type Apns, type Alert } from "./apns.ts";
import { bankHolidays } from "./bankHolidays.ts";
import type { CommuteRow, Store } from "./db.ts";
import type { DriveTimes } from "./drive.ts";
import { makeState, needs, newProblems, sameContent } from "./logic.ts";
import * as nationalRail from "./rail/nationalRail.ts";
import type { NationalRailConfig } from "./rail/nationalRail.ts";
import * as tfl from "./rail/tfl.ts";
import type { TflConfig } from "./rail/tfl.ts";
import { dueEntries, localTime, MAX_HOURS, nextStage, type RegionEvent } from "./schedule.ts";
import type { ActivityAttributes, ContentState, Direction, DriveEstimate, Stage, Station, TrainSnapshot, UserConfig } from "./types.ts";

/** Routine refresh interval while a commute runs. */
const REFRESH_SECONDS = 120;
/** Push even an unchanged state this often, so the Lock Screen never looks stale. */
const HEARTBEAT_SECONDS = 300;

export interface Deps {
  store: Store;
  apns: Apns | null;
  drive: DriveTimes | null;
  nationalRail: NationalRailConfig | null;
  tfl: TflConfig;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export function legs(config: UserConfig, direction: Direction): { from: Station; to: Station } | null {
  if (!config.homeStation || !config.workStation) return null;
  return direction === "toWork"
    ? { from: config.homeStation, to: config.workStation }
    : { from: config.workStation, to: config.homeStation };
}

export function attributesFor(config: UserConfig, commuteId: string, direction: Direction): ActivityAttributes | null {
  const route = legs(config, direction);
  if (!route) return null;
  return { commuteId, direction, fromName: route.from.name, toName: route.to.name };
}

export class Commutes {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  private async trains(config: UserConfig, direction: Direction, now: Date): Promise<TrainSnapshot | null> {
    const route = legs(config, direction);
    if (!route) return null;
    if (route.from.network === "nr" && route.to.network === "nr") {
      if (this.deps.nationalRail) {
        return nationalRail.snapshot(this.deps.nationalRail, route.from.id, route.to.id, now);
      }
      // No National Rail feed: TfL covers the stations on the Elizabeth line and Overground.
      const [from, to] = await Promise.all(
        [route.from, route.to].map((s) => tfl.railStationsNear(this.deps.tfl, s.lat, s.lon)),
      );
      if (!from?.length || !to?.length) {
        return { status: { good: false, text: "No live times for this route yet" }, services: [] };
      }
      return tfl.snapshot(this.deps.tfl, from, to, now);
    }
    if (route.from.network === "tfl" && route.to.network === "tfl") {
      return tfl.snapshot(this.deps.tfl, route.from.id, route.to.id, now);
    }
    return { status: { good: false, text: "Pick two stations on the same network" }, services: [] };
  }

  private async driveTime(config: UserConfig, direction: Direction): Promise<DriveEstimate | null> {
    if (!this.deps.drive || !config.home || !config.homeStation) return null;
    const station = { lat: config.homeStation.lat, lon: config.homeStation.lon };
    return direction === "toWork"
      ? this.deps.drive.estimate(config.home, station)
      : this.deps.drive.estimate(station, config.home);
  }

  /** What the Live Activity should show now. Feeds that fail are left out rather than failing it all. */
  async compute(config: UserConfig, direction: Direction, stage: Stage, now = new Date()): Promise<ContentState> {
    const want = needs(direction, stage);
    const [train, drive] = await Promise.all([
      want.trains
        ? this.trains(config, direction, now).catch((e: unknown) => {
            this.deps.log("trains failed", { error: String(e) });
            return null;
          })
        : null,
      want.drive
        ? this.driveTime(config, direction).catch((e: unknown) => {
            this.deps.log("drive failed", { error: String(e) });
            return null;
          })
        : null,
    ]);
    return makeState({
      direction,
      stage,
      train,
      drive,
      slowDriveMinutes: config.slowDriveMinutes,
      walkMinutes: config.walkMinutes,
      now,
      timeZone: config.timeZone,
    });
  }

  /**
   * A commute the app started itself (button, Shortcut or Siri). The app creates the
   * Live Activity from the returned attributes and state, then sends its push token.
   */
  async startManual(userId: string, config: UserConfig, direction: Direction, now = new Date()) {
    const id = randomUUID();
    const attributes = attributesFor(config, id, direction);
    if (!attributes) return null;
    // Starting a new one replaces any that is running.
    for (const running of this.deps.store.runningCommutesFor(userId)) await this.end(running, now);
    const state = await this.compute(config, direction, "beforeLeaving", now);
    this.deps.store.insertCommute({
      id,
      userId,
      direction,
      dayKey: null,
      started: now.getTime(),
      ends: now.getTime() + MAX_HOURS[direction] * 3_600_000,
      stage: "beforeLeaving",
      activityToken: null,
      lastState: state,
      lastPush: now.getTime(),
      ended: null,
    });
    return { attributes, state };
  }

  /** Starts any scheduled commutes that are due, by push-to-start. */
  async startDue(now = new Date()): Promise<void> {
    if (!this.deps.apns) return;
    for (const user of this.deps.store.schedulableUsers()) {
      const holidays = user.config.skipBankHolidays ? await bankHolidays(user.config.bankHolidayRegion) : new Set<string>();
      for (const entry of dueEntries(user.config, now, holidays)) {
        await this.startScheduled(user.id, user.config, entry.direction, now).catch((e: unknown) =>
          this.deps.log("scheduled start failed", { error: String(e) }),
        );
      }
    }
  }

  private async startScheduled(userId: string, config: UserConfig, direction: Direction, now: Date) {
    const id = randomUUID();
    const attributes = attributesFor(config, id, direction);
    if (!attributes || !config.pushToStartToken || !this.deps.apns) return;
    const inserted = this.deps.store.insertCommute({
      id,
      userId,
      direction,
      dayKey: localTime(now, config.timeZone).date,
      started: now.getTime(),
      ends: now.getTime() + MAX_HOURS[direction] * 3_600_000,
      stage: "beforeLeaving",
      activityToken: null,
      lastState: null,
      lastPush: 0,
      ended: null,
    });
    if (!inserted) return; // Already started today.

    for (const running of this.deps.store.runningCommutesFor(userId)) {
      if (running.id !== id) await this.end(running, now);
    }
    const state = await this.compute(config, direction, "beforeLeaving", now);
    const alert = startAlert(attributes, state);
    const result = await this.deps.apns.send(
      config.apnsEnvironment,
      config.pushToStartToken,
      startPayload(attributes, state, alert, sec(now)),
      10,
    );
    this.deps.log("push-to-start", { status: result.status, reason: result.reason });
    if (result.ok) {
      this.deps.store.updateCommute(id, { lastState: state, lastPush: now.getTime() });
    } else {
      this.deps.store.updateCommute(id, { ended: now.getTime() });
      if (result.gone) this.deps.store.putUser(userId, { ...config, pushToStartToken: null });
    }
  }

  /** The app reports the update token of an activity it now shows. */
  setActivityToken(commute: CommuteRow, token: string): void {
    this.deps.store.updateCommute(commute.id, { activityToken: token });
  }

  /** The phone crossed a geofence. Moves the commute on and pushes straight away if that changes it. */
  async regionEvent(commute: CommuteRow, config: UserConfig, event: RegionEvent, now = new Date()): Promise<Stage> {
    const stage = nextStage(commute.direction, commute.stage, event);
    if (stage === commute.stage) return stage;
    this.deps.store.updateCommute(commute.id, { stage });
    const updated = { ...commute, stage };
    if (stage === "arrived") await this.end(updated, now);
    else await this.refresh(updated, config, now, true);
    return stage;
  }

  async end(commute: CommuteRow, now = new Date()): Promise<void> {
    this.deps.store.updateCommute(commute.id, { ended: now.getTime() });
    const user = this.deps.store.getUser(commute.userId);
    if (!commute.activityToken || !this.deps.apns || !user) return;
    const state = { ...(commute.lastState ?? emptyState(commute.stage, now)), stage: commute.stage, updated: sec(now) };
    await this.deps.apns.send(user.apnsEnvironment, commute.activityToken, endPayload(state, sec(now)), 10);
  }

  /** Refreshes every running commute that is due a refresh, and ends the ones that ran out. */
  async refreshAll(now = new Date()): Promise<void> {
    for (const commute of this.deps.store.runningCommutes()) {
      const config = this.deps.store.getUser(commute.userId);
      if (!config) continue;
      if (now.getTime() >= commute.ends) {
        await this.end(commute, now);
        continue;
      }
      // Without an update token there's nobody to push to yet. Give up after 15 minutes.
      if (!commute.activityToken) {
        if (now.getTime() - commute.started > 15 * 60_000) this.deps.store.updateCommute(commute.id, { ended: now.getTime() });
        continue;
      }
      if (now.getTime() - commute.lastPush < REFRESH_SECONDS * 1000 - 5_000) continue;
      await this.refresh(commute, config, now, false).catch((e: unknown) =>
        this.deps.log("refresh failed", { error: String(e) }),
      );
    }
  }

  private async refresh(commute: CommuteRow, config: UserConfig, now: Date, force: boolean): Promise<void> {
    if (!commute.activityToken || !this.deps.apns) return;
    const state = await this.compute(config, commute.direction, commute.stage, now);
    const changed = !commute.lastState || !sameContent(commute.lastState, state);
    const heartbeat = now.getTime() - commute.lastPush >= HEARTBEAT_SECONDS * 1000;
    if (!force && !changed && !heartbeat) return;

    const fresh = newProblems(commute.lastState, state);
    const alert: Alert | null = fresh.length > 0 ? { title: "Commute problem", body: fresh.join("\n") } : null;
    const result = await this.deps.apns.send(
      config.apnsEnvironment,
      commute.activityToken,
      updatePayload(state, alert, sec(now)),
      alert || force ? 10 : 5,
    );
    if (result.ok) {
      this.deps.store.updateCommute(commute.id, { lastState: state, lastPush: now.getTime() });
    } else if (result.gone) {
      // The user dismissed the activity, or it expired.
      this.deps.store.updateCommute(commute.id, { ended: now.getTime(), activityToken: null });
    } else {
      this.deps.log("update push failed", { status: result.status, reason: result.reason });
    }
  }
}

function sec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function emptyState(stage: Stage, now: Date): ContentState {
  return { problems: [], departures: [], driveMinutes: null, stage, updated: sec(now) };
}

function startAlert(a: ActivityAttributes, state: ContentState): Alert {
  const title = a.direction === "toWork" ? "Commute to work" : "Commute home";
  return { title, body: state.problems[0] ?? `${a.fromName} → ${a.toName}: all clear` };
}
