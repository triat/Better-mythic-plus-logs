// Everything hosted-only routes need, built once per server. Lives here (not in server.ts) so
// routes-auth.ts / routes-admin.ts can import the type without a server.ts <-> routes-* cycle.
import type { Database } from "bun:sqlite";
import type { HostedConfig } from "./config.ts";
import { HOUR_MS, hourStart, openHosted } from "./db.ts";
import type { HostedDb } from "./db.ts";
import { OAuthStates } from "./oauth-state.ts";
import { BnetAppToken } from "./bnet.ts";
import { BNET_CHECK_INTERVAL_MS, BNET_FIRST_CHECK_MS, checkBnetCharacters } from "./bnet-check.ts";
import { setRateLimitObserver, setWclErrorObserver } from "../wcl/client.ts";
import { memberMarker } from "../calibration/marker.ts";
import { PointsMeter } from "../wcl/meter.ts";
import { AUDIT_RETENTION_MS, AuditLog, clip, workTarget } from "./audit.ts";
import { QuotaGate } from "./quota.ts";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./ratelimit.ts";
import type { RateLimits } from "./ratelimit.ts";
import { ErrorRing } from "./error-ring.ts";
import { UserWclClients, verifyWithPing } from "./wcl-clients.ts";
import type { Verify } from "./wcl-clients.ts";
import { USAGE_RETENTION_DAYS, DAY_MS } from "./usage-catalog.ts";
import type { UsageEvent } from "./usage-catalog.ts";
import { instrumentFetch, setUpstreamObserver, upstreamFields } from "../upstream.ts";
import { errorFields, log, userRef } from "../log.ts";
import { statSync } from "node:fs";
import { dirname } from "node:path";
import { resolveEnvPath } from "../setup.ts";
import { lastBackupAt } from "./instance.ts";

export interface HostedRuntime {
  config: HostedConfig;
  db: HostedDb;
  states: OAuthStates;
  /** Battle.net link states, their own instance so a Discord state is never consumed by the Battle.net callback. */
  bnetStates: OAuthStates;
  /** Blizzard application token (client credentials) for the 30-day character check. */
  bnetApp: BnetAppToken;
  fetchFn: typeof fetch;
  secure: boolean;
  meter: PointsMeter;
  quota: QuotaGate;
  audit: AuditLog;
  /** In-app rate limits (issue #9): `/auth/*` per IP; `lookup` covers `POST /api/lookup`, `PUT /api/me/wcl-client` and `POST /api/me/wcl-client/verify` per user, `deepdive` `POST /api/deepdive` and `POST /api/season/sync` per user; `security` throttles the `origin_rejected` audit rows per IP; `signup` throttles brand-new accounts admitted through open signup (not invited, not a config admin), per IP; `usage` `POST /api/usage/events` per user. */
  limits: { auth: RateLimiter; lookup: RateLimiter; deepdive: RateLimiter; security: RateLimiter; signup: RateLimiter; usage: RateLimiter; clientError: RateLimiter };
  /** A member's own WCL client (issue #11 Task 2): encrypted secret storage, verification, own-client rate-limit snapshot. */
  wclClients: UserWclClients;
  /** The last uncaught server errors with their stack, for the read-only `/api/ops/logs`. */
  errors: ErrorRing;
  /** Counts one feature use for a signed-in member (no-op for `null`); never throws, like `audit.record`. */
  track(userId: number | null, event: UsageEvent, n?: number): void;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** The `wcl_hour` line for the hour starting at `start`: points members spent on the shared client and on their own,
 *  how many members spent any, and the shared limit last seen (the Budget panels; the meter keeps no history). */
export function wclHourFields(db: HostedDb, start: number, limitPerHour: number | null): Record<string, unknown> {
  const shared = db.usage.byUser(start);
  const own = db.usageOwn.byUser(start);
  const sum = (rows: Array<{ points: number }>): number => Math.round(rows.reduce((a, r) => a + r.points, 0) * 10) / 10;
  return {
    hour: new Date(start).toISOString(), shared_points: sum(shared), own_points: sum(own),
    members: new Set([...shared, ...own].filter((r) => r.points > 0).map((r) => r.userId)).size, limit: limitPerHour,
  };
}

/** Bytes of a SQLite file and its WAL, 0 for what does not exist (`:memory:`). */
const fileBytes = (path: string): number => {
  let n = 0;
  for (const p of [path, `${path}-wal`]) { try { n += statSync(p).size; } catch { /* absent */ } }
  return n;
};

/**
 * Builds the runtime and starts the hourly purge of expired sessions, audit rows and feature-usage
 * counters older than their retention and idle rate-limit keys, and the Battle.net check round (60 s
 * after start, then every 6 hours). Both timers are unref'd: they never keep the process alive.
 */
export function createHostedRuntime(
  config: HostedConfig,
  db: Database,
  rawFetch: typeof fetch,
  rateLimits: RateLimits = DEFAULT_RATE_LIMITS,
  hooks: { verifyWclClient?: Verify } = {},
): HostedRuntime {
  // Discord and Battle.net calls go through this fetch: each one becomes an `upstream` line (src/upstream.ts).
  const fetchFn = instrumentFetch(rawFetch);
  const hostedDb = openHosted(db);
  const meter = new PointsMeter({ usage: hostedDb.usage });
  const audit = new AuditLog(hostedDb.audit);
  const runtime: HostedRuntime = {
    config,
    db: hostedDb,
    states: new OAuthStates(),
    bnetStates: new OAuthStates(),
    bnetApp: new BnetAppToken(config, fetchFn),
    fetchFn,
    secure: config.baseUrl.startsWith("https:"),
    meter,
    quota: new QuotaGate({ usage: hostedDb.usage, meter, limit: config.pointsPerUserHour }),
    audit,
    limits: {
      auth: new RateLimiter(rateLimits.auth),
      lookup: new RateLimiter(rateLimits.lookup),
      deepdive: new RateLimiter(rateLimits.deepdive),
      security: new RateLimiter(rateLimits.security),
      signup: new RateLimiter(rateLimits.signup),
      usage: new RateLimiter(rateLimits.usage),
      clientError: new RateLimiter(rateLimits.clientError),
    },
    wclClients: new UserWclClients({ repo: hostedDb.wclClients, key: config.encryptionKey, verify: hooks.verifyWclClient ?? verifyWithPing, usage: hostedDb.usageOwn }),
    errors: new ErrorRing(),
    track(userId, event, n = 1) {
      if (userId === null) return;
      try {
        hostedDb.features.add(userId, event, Date.now(), n);
      } catch (err) {
        log.error("usage_write_failed", { usage: event, ...errorFields(err) });
      }
    },
  };
  // Every WCL response of this process now feeds the meter, every WCL failure the audit log (the CLI
  // and local mode never install either).
  // The marker tells the recalibration collector (another process) that a member just used the shared client.
  const touchMarker = memberMarker();
  setRateLimitObserver((rl) => { meter.observe(rl); touchMarker(); });
  // Every outbound call (WCL, Raider.IO, Discord, Battle.net) of this process: the Dependencies dashboard.
  setUpstreamObserver((c) => {
    const fields = { ...upstreamFields(c), req: audit.current()?.req };
    if (c.ok) log.info("upstream", fields);
    else log.warn("upstream", fields);
  });
  setWclErrorObserver((e) => {
    audit.record("wcl_error", { detail: { kind: e.kind, status: e.status, message: clip(e.publicMessage, 300) } });
    const s = audit.current();
    log.warn("wcl_error", { kind: e.kind, status: e.status, message: clip(e.publicMessage, 300), user: userRef(s?.userId), req: s?.req, target: workTarget(s?.target) });
  });
  const purge = (): void => {
    const now = Date.now();
    // One `health` line an hour (with the purge): what the logs stack's backup alert reads.
    void resolveEnvPath().then((env) => {
      const backupAt = lastBackupAt(dirname(env));
      const mem = process.memoryUsage();
      log.info("health", {
        backupAgeS: backupAt === null ? null : Math.round((now - backupAt) / 1000), users: runtime.db.users.count(), sessions: runtime.db.sessions.countActive(now),
        // The System dashboard: the process and the database, once an hour (no metrics database: a non-goal of the logs spec).
        rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576), db_bytes: fileBytes(db.filename), uptime_s: Math.round(process.uptime()),
      });
    }).catch(() => {});
    runtime.db.sessions.purgeExpired(now);
    runtime.db.audit.purgeBefore(now - AUDIT_RETENTION_MS);
    runtime.db.features.purgeBefore(now - (USAGE_RETENTION_DAYS - 1) * DAY_MS);
    // The hourly WCL usage keeps the same 90 days (it had no purge before 2026-10-15).
    runtime.db.usage.purgeBefore(now - USAGE_RETENTION_DAYS * DAY_MS);
    runtime.db.usageOwn.purgeBefore(now - USAGE_RETENTION_DAYS * DAY_MS);
    for (const l of Object.values(runtime.limits)) l.sweep(now);
  };
  purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
  // One `wcl_hour` line per finished clock hour, a minute after it ends (the last request of the hour is charged by then).
  const logHour = (): void => {
    try {
      log.info("wcl_hour", wclHourFields(hostedDb, hourStart(Date.now()) - HOUR_MS, meter.snapshot()?.limitPerHour ?? null));
    } catch (err) {
      log.error("wcl_hour_failed", errorFields(err));
    }
  };
  setTimeout(() => {
    logHour();
    setInterval(logHour, HOUR_MS).unref();
  }, hourStart(Date.now()) + HOUR_MS + 60_000 - Date.now()).unref();
  // The 30-day Battle.net rule (bnet-check.ts); a round still running when the next is due skips it.
  let checking = false;
  const bnetRound = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const r = await checkBnetCharacters({ db: hostedDb, audit, app: runtime.bnetApp, fetchFn, now: Date.now(), errors: runtime.errors });
      if (r.checked > 0) log.info("bnet_check", { checked: r.checked, kept: r.kept, removed: r.removed, failed: r.failed });
    } finally {
      checking = false;
    }
  };
  setTimeout(() => void bnetRound(), BNET_FIRST_CHECK_MS).unref();
  setInterval(() => void bnetRound(), BNET_CHECK_INTERVAL_MS).unref();
  return runtime;
}
