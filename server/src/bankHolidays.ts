// UK bank holidays from GOV.UK, refreshed daily.
import { fetchJson } from "./fetchJson.ts";
import type { BankHolidayRegion } from "./types.ts";

type Feed = Record<BankHolidayRegion, { events: { date: string }[] }>;

let cached: { at: number; byRegion: Map<BankHolidayRegion, Set<string>> } | null = null;

export async function bankHolidays(region: BankHolidayRegion): Promise<Set<string>> {
  if (!cached || Date.now() - cached.at > 86_400_000) {
    try {
      const feed = await fetchJson<Feed>("https://www.gov.uk/bank-holidays.json");
      const byRegion = new Map<BankHolidayRegion, Set<string>>();
      for (const key of Object.keys(feed) as BankHolidayRegion[]) {
        byRegion.set(key, new Set(feed[key].events.map((e) => e.date)));
      }
      cached = { at: Date.now(), byRegion };
    } catch {
      // Keep yesterday's list rather than start commutes on a bank holiday; retry in an hour.
      if (cached) cached.at = Date.now() - 23 * 3_600_000;
    }
  }
  return cached?.byRegion.get(region) ?? new Set();
}
