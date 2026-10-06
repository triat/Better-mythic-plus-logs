// Read-only ops routes for the operator's tooling (an agent diagnosing production errors): a static
// bearer token (`BMPL_OPS_TOKEN`, compared by SHA-256), no cookie, GET only. Spec:
// docs/superpowers/specs/2026-10-05-ops-read-access-design.md. Responses never carry an IP, a
// Discord id or a username: a user is an opaque `user#<id>`.
import { timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import pkg from "../../package.json";
import { actionsOf } from "../hosted/audit.ts";
import { sha256Hex } from "../hosted/config.ts";
import { describeConfig, lastBackupAt } from "../hosted/instance.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { resolveEnvPath } from "../setup.ts";
import { jsonResponse } from "./http.ts";
import { AUDIT_MAX_LIMIT } from "./routes-admin.ts";
import { route } from "./routes.ts";
import type { Handler, Route } from "./routes.ts";

export const OPS_DEFAULT_LIMIT = 50;

/** Whether `header` is `Bearer <token>` with the token whose SHA-256 is `expected` (constant time). */
export function opsTokenMatches(header: string | null, expected: string): boolean {
  const m = /^Bearer (\S+)$/.exec(header ?? "");
  if (!m) return false;
  const given = Buffer.from(sha256Hex(m[1]!), "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

/** `null` when absent, `undefined` when present but not a non-negative safe integer. */
const intParam = (raw: string | null): number | null | undefined => {
  if (raw === null) return null;
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
};

type Paging = { ok: true; since: number | null; before: number | null; limit: number } | { ok: false; res: Response };
function paging(url: URL): Paging {
  const since = intParam(url.searchParams.get("since"));
  if (since === undefined) return { ok: false, res: jsonResponse({ ok: false, error: "`since` must be a timestamp in ms" }, 400) };
  const before = intParam(url.searchParams.get("before"));
  if (before === undefined || before === 0) return { ok: false, res: jsonResponse({ ok: false, error: "`before` must be a positive integer" }, 400) };
  const limit = intParam(url.searchParams.get("limit"));
  if (limit === undefined || limit === 0 || (limit !== null && limit > AUDIT_MAX_LIMIT)) return { ok: false, res: jsonResponse({ ok: false, error: `\`limit\` must be an integer between 1 and ${AUDIT_MAX_LIMIT}` }, 400) };
  return { ok: true, since, before, limit: limit ?? OPS_DEFAULT_LIMIT };
}

export function opsRoutes(rt: HostedRuntime): Route[] {
  const expected = rt.config.opsTokenSha256;
  // No token configured: the routes are not registered, so they answer the plain 404 of any unknown path.
  if (expected === null) return [];
  const guarded = (handle: Handler): Handler => (req, url, ctx) => {
    if (opsTokenMatches(req.headers.get("authorization"), expected)) return handle(req, url, ctx);
    // Throttled per IP like `origin_rejected`, so a scan cannot fill the audit table.
    if (rt.limits.security.hit(`ip:${ctx.ip}`, ctx.now).ok) rt.audit.record("ops_denied", { userId: null });
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  };

  return [
    route("GET", "/api/ops/status", guarded(async (_req, _url, ctx) => {
      const env = describeConfig(rt.config, { clientId: process.env.WCL_CLIENT_ID ?? null, hasSecret: !!process.env.WCL_CLIENT_SECRET });
      return jsonResponse({
        ok: true, now: ctx.now, version: pkg.version as string, uptimeS: Math.round(process.uptime()),
        lastBackupAt: lastBackupAt(dirname(await resolveEnvPath())), env, meter: rt.meter.snapshot(),
      });
    }), "public"),
    route("GET", "/api/ops/errors", guarded((_req, url) => {
      const p = paging(url);
      if (!p.ok) return p.res;
      const rows = rt.db.audit.list({ actions: actionsOf("error"), before: p.before, limit: p.limit })
        .filter((r) => p.since === null || r.at >= p.since)
        .map((r) => ({ id: r.id, at: r.at, user: r.userId === null ? null : `user#${r.userId}`, action: r.action, target: r.target, detail: r.detail }));
      return jsonResponse({ ok: true, rows, nextBefore: rows.length === p.limit ? rows[rows.length - 1]!.id : null });
    }), "public"),
    route("GET", "/api/ops/logs", guarded((_req, url) => {
      const p = paging(url);
      if (!p.ok) return p.res;
      return jsonResponse({ ok: true, entries: rt.errors.list({ since: p.since, limit: p.limit }) });
    }), "public"),
  ];
}
