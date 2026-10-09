// Everything hosted-only routes need, built once per server. Lives here (not in server.ts) so
// routes-auth.ts / routes-admin.ts can import the type without a server.ts <-> routes-* cycle.
import type { Database } from "bun:sqlite";
import type { HostedConfig } from "./config.ts";
import { openHosted } from "./db.ts";
import type { HostedDb } from "./db.ts";
import { OAuthStates } from "./oauth-state.ts";
import { setRateLimitObserver, setWclErrorObserver } from "../wcl/client.ts";
import { PointsMeter } from "../wcl/meter.ts";
import { AUDIT_RETENTION_MS, AuditLog, clip } from "./audit.ts";
import { QuotaGate } from "./quota.ts";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./ratelimit.ts";
import type { RateLimits } from "./ratelimit.ts";
import { ErrorRing } from "./error-ring.ts";
import { UserWclClients, verifyWithPing } from "./wcl-clients.ts";
import type { Verify } from "./wcl-clients.ts";
import { USAGE_RETENTION_DAYS, DAY_MS } from "./usage-catalog.ts";
import type { UsageEvent } from "./usage-catalog.ts";

export interface HostedRuntime {
  config: HostedConfig;
  db: HostedDb;
  states: OAuthStates;
  fetchFn: typeof fetch;
  secure: boolean;
  meter: PointsMeter;
  quota: QuotaGate;
  audit: AuditLog;
  /** In-app rate limits (issue #9): `/auth/*` per IP; `lookup` covers `POST /api/lookup`, `PUT /api/me/wcl-client` and `POST /api/me/wcl-client/verify` per user, `deepdive` `POST /api/deepdive` and `POST /api/season/sync` per user; `security` throttles the `origin_rejected` audit rows per IP; `signup` throttles brand-new accounts admitted through open signup (not invited, not a config admin), per IP; `usage` `POST /api/usage/events` per user. */
  limits: { auth: RateLimiter; lookup: RateLimiter; deepdive: RateLimiter; security: RateLimiter; signup: RateLimiter; usage: RateLimiter };
  /** A member's own WCL client (issue #11 Task 2): encrypted secret storage, verification, own-client rate-limit snapshot. */
  wclClients: UserWclClients;
  /** The last uncaught server errors with their stack, for the read-only `/api/ops/logs`. */
  errors: ErrorRing;
  /** Counts one feature use for a signed-in member (no-op for `null`); never throws, like `audit.record`. */
  track(userId: number | null, event: UsageEvent, n?: number): void;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Builds the runtime and starts the hourly purge of expired sessions, audit rows and feature-usage
 * counters older than their retention and idle rate-limit keys (unref'd: never keeps the process alive).
 */
export function createHostedRuntime(
  config: HostedConfig,
  db: Database,
  fetchFn: typeof fetch,
  rateLimits: RateLimits = DEFAULT_RATE_LIMITS,
  hooks: { verifyWclClient?: Verify } = {},
): HostedRuntime {
  const hostedDb = openHosted(db);
  const meter = new PointsMeter({ usage: hostedDb.usage });
  const audit = new AuditLog(hostedDb.audit);
  const runtime: HostedRuntime = {
    config,
    db: hostedDb,
    states: new OAuthStates(),
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
    },
    wclClients: new UserWclClients({ repo: hostedDb.wclClients, key: config.encryptionKey, verify: hooks.verifyWclClient ?? verifyWithPing, usage: hostedDb.usageOwn }),
    errors: new ErrorRing(),
    track(userId, event, n = 1) {
      if (userId === null) return;
      try {
        hostedDb.features.add(userId, event, Date.now(), n);
      } catch (err) {
        console.error(`usage: could not record ${event}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
  // Every WCL response of this process now feeds the meter, every WCL failure the audit log (the CLI
  // and local mode never install either).
  setRateLimitObserver((rl) => meter.observe(rl));
  setWclErrorObserver((e) => audit.record("wcl_error", { detail: { kind: e.kind, status: e.status, message: clip(e.publicMessage, 300) } }));
  const purge = (): void => {
    const now = Date.now();
    runtime.db.sessions.purgeExpired(now);
    runtime.db.audit.purgeBefore(now - AUDIT_RETENTION_MS);
    runtime.db.features.purgeBefore(now - (USAGE_RETENTION_DAYS - 1) * DAY_MS);
    for (const l of Object.values(runtime.limits)) l.sweep(now);
  };
  purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
  return runtime;
}
