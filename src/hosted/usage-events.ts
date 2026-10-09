// Feature-usage counters (spec 2026-10-09-feature-usage-dashboard-design.md): one row per
// (event, UTC day, member) with a count and the last time it moved. Hosted mode only; the admin
// page reads `report`, the read-only ops route reads it without `top` and without user ids.
import type { Database } from "bun:sqlite";
import { DAY_MS, USAGE_CATALOG, USAGE_EVENTS, dayStart } from "./usage-catalog.ts";
import type { UsageCategory, UsageEvent, UsageSource } from "./usage-catalog.ts";

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];
export const isUsagePeriod = (n: number): n is UsagePeriod => (USAGE_PERIODS as readonly number[]).includes(n);

export interface FeatureTopUser { userId: number; username: string; uses: number; lastAt: number }
export interface FeatureUsage {
  event: UsageEvent;
  category: UsageCategory;
  source: UsageSource;
  /** Sum of counts over the period. */
  uses: number;
  /** Distinct members over the period. */
  users: number;
  /** `users` / members active over the period (0 when nobody was active). */
  share: number;
  lastAt: number | null;
  /** Uses per day, oldest first, one entry per day of the period. */
  daily: number[];
  /** The 5 members with the most uses, most first (empty in the ops view). */
  top: FeatureTopUser[];
}
export interface UsageReport {
  days: UsagePeriod;
  includeAdmins: boolean;
  /** UTC midnight of the first day of the period. */
  from: number;
  /** Non-banned accounts (admins only when `includeAdmins`). */
  members: number;
  /** Distinct members with any event: today (UTC), the last 7 and 30 days, and the whole period. */
  active: { today: number; d7: number; d30: number; period: number };
  /** Distinct active members per day, oldest first. */
  dailyActive: number[];
  /** Every catalogue entry, unused ones included (zeros), most members first. */
  features: FeatureUsage[];
}

export interface UsageEventsRepo {
  /** Adds `n` to the member's counter of `event` on the UTC day of `at`. */
  add(userId: number, event: UsageEvent, at: number, n?: number): void;
  /** Deletes rows whose day is before `at`'s day; returns how many. */
  purgeBefore(at: number): number;
  report(o: { now: number; days: UsagePeriod; includeAdmins: boolean; withTop: boolean }): UsageReport;
}

const TOP_N = 5;

export function openUsageEvents(db: Database): UsageEventsRepo {
  const add = db.query(
    "INSERT INTO usage_events (day, user_id, event, n, last_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(event, day, user_id) DO UPDATE SET n = n + excluded.n, last_at = max(last_at, excluded.last_at)",
  );
  const purge = db.query("DELETE FROM usage_events WHERE day < ?");
  const changes = (): number => Number(db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n);
  // `?2` = include admins (1/0): the role filter every read shares.
  const SCOPE = "FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.day >= ?1 AND u.banned_at IS NULL AND (?2 = 1 OR u.role <> 'admin')";
  const perEventDay = db.query<{ event: string; day: number; n: number }, [number, number]>(
    `SELECT e.event, e.day, SUM(e.n) AS n ${SCOPE} GROUP BY e.event, e.day`,
  );
  const perEventUser = db.query<{ event: string; user_id: number; username: string; n: number; last_at: number }, [number, number]>(
    `SELECT e.event, e.user_id, u.username, SUM(e.n) AS n, MAX(e.last_at) AS last_at ${SCOPE} GROUP BY e.event, e.user_id`,
  );
  const dayActive = db.query<{ day: number; n: number }, [number, number]>(
    `SELECT e.day, COUNT(DISTINCT e.user_id) AS n ${SCOPE} GROUP BY e.day`,
  );
  const activeSince = db.query<{ n: number }, [number, number]>(`SELECT COUNT(DISTINCT e.user_id) AS n ${SCOPE}`);
  const members = db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM users WHERE banned_at IS NULL AND (?1 = 1 OR role <> 'admin')");

  return {
    add(userId, event, at, n = 1) { add.run(dayStart(at), userId, event, n, at); },
    purgeBefore(at) { purge.run(dayStart(at)); return changes(); },
    report({ now, days, includeAdmins, withTop }) {
      const today = dayStart(now);
      const from = today - (days - 1) * DAY_MS;
      const adm = includeAdmins ? 1 : 0;
      const since = (d: number): number => activeSince.get(today - (d - 1) * DAY_MS, adm)!.n;
      const index = (day: number): number => Math.round((day - from) / DAY_MS);

      const daily = new Map<string, number[]>();
      for (const r of perEventDay.all(from, adm)) {
        const i = index(r.day);
        if (i < 0 || i >= days) continue;
        let row = daily.get(r.event);
        if (!row) daily.set(r.event, (row = new Array<number>(days).fill(0)));
        row[i] = (row[i] ?? 0) + r.n;
      }
      const byUser = new Map<string, Array<{ userId: number; username: string; uses: number; lastAt: number }>>();
      for (const r of perEventUser.all(from, adm)) {
        let list = byUser.get(r.event);
        if (!list) byUser.set(r.event, (list = []));
        list.push({ userId: r.user_id, username: r.username, uses: r.n, lastAt: r.last_at });
      }
      const dailyActive = new Array<number>(days).fill(0);
      for (const r of dayActive.all(from, adm)) {
        const i = index(r.day);
        if (i >= 0 && i < days) dailyActive[i] = r.n;
      }
      const period = since(days);
      const features: FeatureUsage[] = USAGE_EVENTS.map((event) => {
        const list = (byUser.get(event) ?? []).sort((a, b) => b.uses - a.uses || b.lastAt - a.lastAt);
        const uses = list.reduce((s, u) => s + u.uses, 0);
        return {
          event,
          category: USAGE_CATALOG[event].category,
          source: USAGE_CATALOG[event].source,
          uses,
          users: list.length,
          share: period > 0 ? list.length / period : 0,
          lastAt: list.length > 0 ? Math.max(...list.map((u) => u.lastAt)) : null,
          daily: daily.get(event) ?? new Array<number>(days).fill(0),
          top: withTop ? list.slice(0, TOP_N) : [],
        };
      }).sort((a, b) => b.users - a.users || b.uses - a.uses || a.event.localeCompare(b.event));
      return {
        days,
        includeAdmins,
        from,
        members: members.get(adm)!.n,
        active: { today: since(1), d7: since(7), d30: since(30), period },
        dailyActive,
        features,
      };
    },
  };
}

/** `?days=7|30|90` (default 30) and `?admins=0|1` (default 0) of the two usage report routes. */
export function parseUsageQuery(params: URLSearchParams): { ok: true; days: UsagePeriod; includeAdmins: boolean } | { ok: false; error: string } {
  const rawDays = params.get("days");
  const days = rawDays === null ? 30 : Number(rawDays);
  if (!isUsagePeriod(days)) return { ok: false, error: `\`days\` must be one of ${USAGE_PERIODS.join(", ")}` };
  const rawAdmins = params.get("admins");
  if (rawAdmins !== null && rawAdmins !== "0" && rawAdmins !== "1") return { ok: false, error: "`admins` must be 0 or 1" };
  return { ok: true, days, includeAdmins: rawAdmins === "1" };
}
