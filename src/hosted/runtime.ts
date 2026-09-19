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

export interface HostedRuntime {
  config: HostedConfig;
  db: HostedDb;
  states: OAuthStates;
  fetchFn: typeof fetch;
  secure: boolean;
  meter: PointsMeter;
  quota: QuotaGate;
  audit: AuditLog;
  /** In-app rate limits (issue #9): `/auth/*` per IP, `POST /api/lookup` and `POST /api/deepdive` per user; `security` throttles the `origin_rejected` audit rows per IP; `signup` throttles new accounts under open signup, per IP. */
  limits: { auth: RateLimiter; lookup: RateLimiter; deepdive: RateLimiter; security: RateLimiter; signup: RateLimiter };
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Builds the runtime and starts the hourly purge of expired sessions, audit rows older than the
 * retention and idle rate-limit keys (unref'd: never keeps the process alive).
 */
export function createHostedRuntime(config: HostedConfig, db: Database, fetchFn: typeof fetch, rateLimits: RateLimits = DEFAULT_RATE_LIMITS): HostedRuntime {
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
    for (const l of Object.values(runtime.limits)) l.sweep(now);
  };
  purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
  return runtime;
}
