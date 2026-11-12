// SQLite storage (Node's built-in driver). Two tables: what each user set up, and
// the commutes that are running or have run.
import { DatabaseSync } from "node:sqlite";
import type { ContentState, Direction, Stage, UserConfig } from "./types.ts";

export interface CommuteRow {
  id: string;
  userId: string;
  direction: Direction;
  /** Local date for scheduled commutes, so each one starts at most once a day; null for manual ones. */
  dayKey: string | null;
  started: number;
  ends: number;
  stage: Stage;
  activityToken: string | null;
  lastState: ContentState | null;
  lastPush: number;
  ended: number | null;
}

interface RawCommute {
  id: string;
  user_id: string;
  direction: string;
  day_key: string | null;
  started: number;
  ends: number;
  stage: string;
  activity_token: string | null;
  last_state: string | null;
  last_push: number;
  ended: number | null;
}

function toCommute(r: RawCommute): CommuteRow {
  return {
    id: r.id,
    userId: r.user_id,
    direction: r.direction as Direction,
    dayKey: r.day_key,
    started: r.started,
    ends: r.ends,
    stage: r.stage as Stage,
    activityToken: r.activity_token,
    lastState: r.last_state ? (JSON.parse(r.last_state) as ContentState) : null,
    lastPush: r.last_push,
    ended: r.ended,
  };
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commutes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        day_key TEXT,
        started INTEGER NOT NULL,
        ends INTEGER NOT NULL,
        stage TEXT NOT NULL,
        activity_token TEXT,
        last_state TEXT,
        last_push INTEGER NOT NULL DEFAULT 0,
        ended INTEGER,
        UNIQUE (user_id, direction, day_key)
      );
      CREATE INDEX IF NOT EXISTS commutes_running ON commutes (ended);
    `);
  }

  getUser(id: string): UserConfig | null {
    const row = this.db.prepare("SELECT config FROM users WHERE id = ?").get(id) as { config: string } | undefined;
    return row ? (JSON.parse(row.config) as UserConfig) : null;
  }

  putUser(id: string, config: UserConfig): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (id, config, created, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET config = excluded.config, updated = excluded.updated`,
      )
      .run(id, JSON.stringify(config), now, now);
  }

  deleteUser(id: string): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  /** Users with a schedule and a way to start Live Activities. */
  schedulableUsers(): { id: string; config: UserConfig }[] {
    const rows = this.db.prepare("SELECT id, config FROM users").all() as { id: string; config: string }[];
    return rows
      .map((r) => ({ id: r.id, config: JSON.parse(r.config) as UserConfig }))
      .filter((u) => u.config.pushToStartToken && u.config.schedule.length > 0);
  }

  /**
   * Records a new commute. For a scheduled one, returns false if that day's commute in
   * that direction already exists.
   */
  insertCommute(c: CommuteRow): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO commutes (id, user_id, direction, day_key, started, ends, stage, activity_token, last_state, last_push, ended)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.userId,
        c.direction,
        c.dayKey,
        c.started,
        c.ends,
        c.stage,
        c.activityToken,
        c.lastState ? JSON.stringify(c.lastState) : null,
        c.lastPush,
        c.ended,
      );
    return result.changes > 0;
  }

  getCommute(id: string): CommuteRow | null {
    const row = this.db.prepare("SELECT * FROM commutes WHERE id = ?").get(id) as RawCommute | undefined;
    return row ? toCommute(row) : null;
  }

  runningCommutes(): CommuteRow[] {
    return (this.db.prepare("SELECT * FROM commutes WHERE ended IS NULL").all() as unknown as RawCommute[]).map(toCommute);
  }

  runningCommutesFor(userId: string): CommuteRow[] {
    return (
      this.db.prepare("SELECT * FROM commutes WHERE ended IS NULL AND user_id = ?").all(userId) as unknown as RawCommute[]
    ).map(toCommute);
  }

  updateCommute(id: string, fields: Partial<Pick<CommuteRow, "stage" | "activityToken" | "lastState" | "lastPush" | "ended">>): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const column: Record<string, string> = {
      stage: "stage",
      activityToken: "activity_token",
      lastState: "last_state",
      lastPush: "last_push",
      ended: "ended",
    };
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${column[key]} = ?`);
      values.push(key === "lastState" && value ? JSON.stringify(value) : (value as string | number | null));
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE commutes SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  /** Finished commutes are kept a week for troubleshooting, then dropped. */
  prune(now: number): void {
    this.db.prepare("DELETE FROM commutes WHERE ended IS NOT NULL AND ended < ?").run(now - 7 * 86_400_000);
  }

  close(): void {
    this.db.close();
  }
}
