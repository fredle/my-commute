// The JSON API the app talks to. Each install identifies itself with a random secret
// it generated (kept in its Keychain); the server stores only that secret's hash, so
// there are no accounts, emails or passwords.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Commutes } from "./commutes.ts";
import type { Store } from "./db.ts";
import type { TflConfig } from "./rail/tfl.ts";
import { nearestNationalRail, search } from "./stations.ts";
import * as validate from "./validate.ts";

export interface ApiDeps {
  store: Store;
  commutes: Commutes;
  tfl: TflConfig;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

class HttpFailure extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 32 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpFailure(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpFailure(400, "Body is not JSON");
  }
}

function userId(req: IncomingMessage): string {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization ?? "");
  if (!m?.[1]) throw new HttpFailure(401, "Missing or malformed bearer token");
  return createHash("sha256").update(m[1]).digest("hex");
}

/** A small per-client budget so one broken or hostile client can't run up the upstream APIs. */
function limiter(perMinute: number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string) => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    if (b.tokens < 1) throw new HttpFailure(429, "Too many requests");
    b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 50_000) buckets.clear();
  };
}

export function createApi(deps: ApiDeps) {
  const { store, commutes } = deps;
  const limit = limiter(60);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/healthz") return { ok: true };

    const user = userId(req);
    limit(user);

    if (path === "/v1/stations" && method === "GET") {
      const near = /^(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)$/.exec(url.searchParams.get("near") ?? "");
      if (near) return { stations: nearestNationalRail(Number(near[1]), Number(near[2])) };
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
      return { stations: q.length < 2 ? [] : await search(deps.tfl, q) };
    }

    if (path === "/v1/me") {
      if (method === "GET") return store.getUser(user) ?? new HttpFailure(404, "Not set up");
      if (method === "PUT") {
        const config = validate.userConfig(await readJson(req));
        store.putUser(user, config);
        return { ok: true };
      }
      if (method === "DELETE") {
        for (const c of store.runningCommutesFor(user)) await commutes.end(c);
        store.deleteUser(user);
        res.statusCode = 204;
        return null;
      }
    }

    const config = store.getUser(user);
    if (!config) throw new HttpFailure(409, "Send your settings (PUT /v1/me) first");

    if (path === "/v1/status" && method === "GET") {
      const direction = validate.direction(url.searchParams.get("direction"));
      return await commutes.compute(config, direction, "beforeLeaving");
    }

    if (path === "/v1/commutes" && method === "POST") {
      const body = (await readJson(req)) as { direction?: unknown } | null;
      const started = await commutes.startManual(user, config, validate.direction(body?.direction));
      if (!started) throw new HttpFailure(409, "Choose your stations first");
      return started;
    }

    const m = /^\/v1\/commutes\/([0-9a-f-]{36})(\/token|\/events)?$/.exec(path);
    if (m?.[1]) {
      const commute = store.getCommute(m[1]);
      if (!commute || commute.userId !== user) throw new HttpFailure(404, "No such commute");
      if (m[2] === "/token" && method === "PUT") {
        commutes.setActivityToken(commute, validate.activityToken(await readJson(req)));
        return { ok: true };
      }
      if (m[2] === "/events" && method === "POST") {
        if (commute.ended) return { stage: commute.stage, ended: true };
        const stage = await commutes.regionEvent(commute, config, validate.regionEvent(await readJson(req)));
        return { stage, ended: stage === "arrived" };
      }
      if (!m[2] && method === "DELETE") {
        if (!commute.ended) await commutes.end(commute);
        res.statusCode = 204;
        return null;
      }
    }

    throw new HttpFailure(404, "Not found");
  }

  return createServer((req, res) => {
    route(req, res)
      .then((result) => {
        if (result instanceof HttpFailure) throw result;
        if (res.statusCode === 204) return res.end();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result));
      })
      .catch((error: unknown) => {
        const status = error instanceof HttpFailure ? error.status : error instanceof validate.Invalid ? 400 : 500;
        if (status === 500) deps.log("request failed", { path: req.url, error: String(error) });
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: status === 500 ? "Server error" : (error as Error).message }));
      });
  });
}
