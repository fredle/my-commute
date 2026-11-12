// Drive time with live traffic from the Apple Maps Server API, together with the
// same drive with no traffic, which stands in for "your usual drive".
import type { KeyObject } from "node:crypto";
import { fetchJson } from "./fetchJson.ts";
import { cachedToken, es256 } from "./jwt.ts";
import type { Coordinate, DriveEstimate } from "./types.ts";

export interface MapsConfig {
  teamId: string;
  keyId: string;
  key: KeyObject;
}

interface EtaResponse {
  etas?: { expectedTravelTimeSeconds: number; staticTravelTimeSeconds: number }[];
}

export class DriveTimes {
  private readonly authToken: () => string;
  private access: { token: string; expires: number } | null = null;
  private readonly config: MapsConfig;

  constructor(config: MapsConfig) {
    this.config = config;
    this.authToken = cachedToken(() => {
      const iat = Math.floor(Date.now() / 1000);
      return es256({ kid: config.keyId, typ: "JWT" }, { iss: config.teamId, iat, exp: iat + 3600 }, config.key);
    }, 1800);
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 60_000) return this.access.token;
    const res = await fetch("https://maps-api.apple.com/v1/token", {
      headers: { Authorization: `Bearer ${this.authToken()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Maps token: HTTP ${res.status}`);
    const body = (await res.json()) as { accessToken: string; expiresInSeconds: number };
    this.access = { token: body.accessToken, expires: Date.now() + body.expiresInSeconds * 1000 };
    return body.accessToken;
  }

  async estimate(from: Coordinate, to: Coordinate): Promise<DriveEstimate> {
    // Rounded so that neighbours share a cached answer, and the URL is stable for three minutes.
    const p = (c: Coordinate) => `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
    const url = `https://maps-api.apple.com/v1/etas?origin=${p(from)}&destinations=${p(to)}&transportType=Automobile`;
    const token = await this.accessToken();
    const res = await fetchJson<EtaResponse>(url, { headers: { Authorization: `Bearer ${token}` }, ttlSeconds: 180 });
    const eta = res.etas?.[0];
    if (!eta) throw new Error("Maps returned no ETA");
    return {
      minutes: Math.round(eta.expectedTravelTimeSeconds / 60),
      usualMinutes: Math.round(eta.staticTravelTimeSeconds / 60),
    };
  }
}
