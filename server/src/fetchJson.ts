// GET a JSON document, sharing results for a short while so that many commuters on
// the same route cost one upstream call.

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

const cache = new Map<string, Entry>();

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.status = status;
  }
}

export async function fetchJson<T>(
  url: string,
  options: { headers?: Record<string, string>; ttlSeconds?: number; timeoutMs?: number } = {},
): Promise<T> {
  const ttl = (options.ttlSeconds ?? 0) * 1000;
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = (async () => {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "commute-server", ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new HttpError(response.status, url);
    return (await response.json()) as T;
  })();

  if (ttl > 0) {
    cache.set(url, { expires: now + ttl, value });
    // Failures aren't worth remembering.
    value.catch(() => cache.delete(url));
    if (cache.size > 5_000) {
      for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
    }
  }
  return value;
}
