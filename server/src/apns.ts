// Live Activity pushes over APNs (HTTP/2, token auth).
import type { KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { cachedToken, es256 } from "./jwt.ts";
import type { ActivityAttributes, ContentState } from "./types.ts";

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  key: KeyObject;
  bundleId: string;
}

export type ApnsEnvironment = "production" | "sandbox";

export interface PushResult {
  ok: boolean;
  status: number;
  reason?: string;
  /** The token will never work again: forget it. */
  gone: boolean;
}

export interface Alert {
  title: string;
  body: string;
}

const STALE_SECONDS = 10 * 60;

export function startPayload(attributes: ActivityAttributes, state: ContentState, alert: Alert, now: number) {
  return {
    aps: {
      timestamp: now,
      event: "start",
      "content-state": state,
      "attributes-type": "CommuteAttributes",
      attributes,
      alert: { title: alert.title, body: alert.body },
      "stale-date": now + STALE_SECONDS,
    },
  };
}

export function updatePayload(state: ContentState, alert: Alert | null, now: number) {
  return {
    aps: {
      timestamp: now,
      event: "update",
      "content-state": state,
      "stale-date": now + STALE_SECONDS,
      ...(alert ? { alert: { title: alert.title, body: alert.body, sound: "default" } } : {}),
    },
  };
}

export function endPayload(state: ContentState, now: number) {
  return { aps: { timestamp: now, event: "end", "content-state": state, "dismissal-date": now } };
}

export class Apns {
  private readonly sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
  private readonly token: () => string;
  private readonly config: ApnsConfig;

  constructor(config: ApnsConfig) {
    this.config = config;
    // Apple refuses tokens older than an hour and throttles making new ones often.
    this.token = cachedToken(
      () => es256({ kid: config.keyId }, { iss: config.teamId, iat: Math.floor(Date.now() / 1000) }, config.key),
      45 * 60,
    );
  }

  private session(env: ApnsEnvironment): ClientHttp2Session {
    const existing = this.sessions.get(env);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const host = env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    const session = connect(host);
    session.on("error", () => this.sessions.delete(env));
    session.on("close", () => this.sessions.delete(env));
    session.on("goaway", () => this.sessions.delete(env));
    this.sessions.set(env, session);
    return session;
  }

  /** `priority` 10 shows straight away and counts against Apple's budget; 5 is for routine refreshes. */
  send(env: ApnsEnvironment, deviceToken: string, payload: object, priority: 5 | 10): Promise<PushResult> {
    return new Promise((resolve) => {
      let req;
      try {
        req = this.session(env).request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${this.token()}`,
          "apns-topic": `${this.config.bundleId}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          "apns-priority": String(priority),
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 300),
          "content-type": "application/json",
        });
      } catch (error) {
        resolve({ ok: false, status: 0, reason: String(error), gone: false });
        return;
      }
      let status = 0;
      let body = "";
      req.setTimeout(15_000, () => req.close());
      req.on("response", (headers) => (status = Number(headers[":status"])));
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("error", (error) => resolve({ ok: false, status, reason: String(error), gone: false }));
      req.on("end", () => {
        const reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
        resolve({
          ok: status === 200,
          status,
          reason,
          gone: status === 410 || reason === "BadDeviceToken" || reason === "Unregistered",
        });
      });
      req.end(JSON.stringify(payload));
    });
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
