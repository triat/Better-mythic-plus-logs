// Everything hosted-only routes need, built once per server. Lives here (not in server.ts) so
// routes-auth.ts / routes-admin.ts can import the type without a server.ts <-> routes-* cycle.
import type { Database } from "bun:sqlite";
import type { HostedConfig } from "./config.ts";
import { openHosted } from "./db.ts";
import type { HostedDb } from "./db.ts";
import { OAuthStates } from "./oauth-state.ts";
import { setRateLimitObserver } from "../wcl/client.ts";
import { PointsMeter } from "../wcl/meter.ts";
import { QuotaGate } from "./quota.ts";

export interface HostedRuntime { config: HostedConfig; db: HostedDb; states: OAuthStates; fetchFn: typeof fetch; secure: boolean; meter: PointsMeter; quota: QuotaGate }

const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Builds the runtime and starts the hourly expired-session purge (unref'd: never keeps the process alive). */
export function createHostedRuntime(config: HostedConfig, db: Database, fetchFn: typeof fetch): HostedRuntime {
  const hostedDb = openHosted(db);
  const meter = new PointsMeter({ usage: hostedDb.usage });
  const runtime: HostedRuntime = {
    config,
    db: hostedDb,
    states: new OAuthStates(),
    fetchFn,
    secure: config.baseUrl.startsWith("https:"),
    meter,
    quota: new QuotaGate({ usage: hostedDb.usage, meter, limit: config.pointsPerUserHour }),
  };
  // Every WCL response of this process now feeds the meter (the CLI and local mode never install one).
  setRateLimitObserver((rl) => meter.observe(rl));
  setInterval(() => runtime.db.sessions.purgeExpired(Date.now()), SESSION_PURGE_INTERVAL_MS).unref();
  return runtime;
}
