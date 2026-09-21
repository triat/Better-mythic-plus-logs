// src/server/routes-shared.ts
// Routes that exist in both modes. Local-only routes live in routes-local.ts.
import { dirname } from "node:path";
import pkg from "../../package.json";
import { config, hasCredentials } from "../config.ts";
import { SHIPPED } from "../deepdive/table.ts";
import { configVersion, getEvalConfig } from "../evaluation/config.ts";
import type { EvaluationDocs } from "../evaluation/docs.ts";
import { EVALUATION_DOCS_BY_LOCALE } from "../evaluation/docs.ts";
import type { CurvePoints, EvaluationConfig } from "../evaluation/types.ts";
import { lastBackupAt } from "../hosted/instance.ts";
import { isLocale } from "../hosted/locale.ts";
import type { Locale } from "../hosted/locale.ts";
import { POINTS_FLOOR } from "../hosted/quota.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { LookupPayload } from "../lookup.ts";
import { handleDeepdive, handleDefensivesGet, handleDefensivesPost, tablesOf, withCachedAnalyses } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { handleLookup, historyOf, historySummary } from "./lookup.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { eventsResponse } from "./sse.ts";
import { getStore } from "../signals/store.ts";
import { watcherStatus } from "./watcher.ts";

export interface SharedContext { hosted: boolean; envPath: string; runtime: HostedRuntime | null }

export interface DocsResponse {
  ok: true;
  docs: EvaluationDocs;
  config: {
    version: string;
    levelScale: CurvePoints;
    expectedIlvl: Record<string, CurvePoints>;
    axes: EvaluationConfig["axes"];
    axisWeights: EvaluationConfig["axisWeights"];
    verdict: EvaluationConfig["verdict"];
    confidence: EvaluationConfig["confidence"];
  };
  defensives: { version: string };
  season: string | null;
  hosted: boolean;
  /** The numbers of the "own WCL client" guide: the per-member hourly quota (null locally) and what one WCL client gets. */
  quota: { pointsPerUserHour: number | null; wclPointsPerHour: number };
}

/** What Warcraft Logs grants one API client per hour (rateLimitData.limitPerHour); shown by the /help guide. */
export const WCL_POINTS_PER_HOUR = 3600;

/** Pure: the documentation registry in `locale` plus the effective evaluation config, for GET /api/docs?lang=. */
export function docsResponse(cfg: EvaluationConfig, hosted: boolean, pointsPerUserHour: number | null = null, locale: Locale = "en"): DocsResponse {
  return {
    ok: true,
    docs: EVALUATION_DOCS_BY_LOCALE[locale],
    config: {
      version: configVersion(cfg),
      levelScale: cfg.levelScale,
      expectedIlvl: cfg.expectedIlvl,
      axes: cfg.axes,
      axisWeights: cfg.axisWeights,
      verdict: cfg.verdict,
      confidence: cfg.confidence,
    },
    defensives: { version: SHIPPED.version },
    season: Object.keys(cfg.expectedIlvl).at(-1) ?? null,
    hosted,
    quota: { pointsPerUserHour, wclPointsPerHour: WCL_POINTS_PER_HOUR },
  };
}

/** null when the trailing segment is not valid percent-encoding (decodeURIComponent throws). */
export const historyKey = (url: URL): string | null => {
  try {
    return decodeURIComponent(url.pathname.slice("/api/history/".length));
  } catch {
    return null;
  }
};

/** A backup marker older than this many seconds is stale enough to warn about. */
export const BACKUP_STALE_S = 7200;

async function handleHealth(sc: SharedContext): Promise<Response> {
  const base = { version: pkg.version as string, uptimeS: Math.round(process.uptime()) };
  let db: "ok" | "error" = "ok";
  try { (await getStore())._db.query("SELECT 1").get(); } catch { db = "error"; }
  if (!sc.runtime) return jsonResponse({ ok: db === "ok", ...base, db }, db === "ok" ? 200 : 503);
  const rt = sc.runtime;
  const now = Date.now();
  const snap = rt.meter.snapshot();
  const backupAt = lastBackupAt(dirname(sc.envPath));
  const backupAgeS = backupAt === null ? null : Math.max(0, Math.round((now - backupAt) / 1000));
  const warnings: string[] = [];
  if (backupAgeS === null) warnings.push("no backup marker");
  else if (backupAgeS > BACKUP_STALE_S) warnings.push(`last backup ${Math.round(backupAgeS / 3600)} h ago`);
  if (snap && now < snap.windowEnd && snap.limitPerHour - snap.pointsSpentThisHour < POINTS_FLOOR) warnings.push(`shared WCL budget under ${POINTS_FLOOR} pts`);
  return jsonResponse({
    ok: db === "ok", ...base, db, hosted: true,
    users: rt.db.users.count(), sessions: rt.db.sessions.countActive(now),
    wcl: snap ? { pointsSpentThisHour: snap.pointsSpentThisHour, limitPerHour: snap.limitPerHour, pointsResetIn: snap.pointsResetIn } : null,
    backupAgeS, warnings,
  }, db === "ok" ? 200 : 503);
}

export function sharedRoutes(ctx: SharedContext): Route[] {
  return [
    route("POST", "/api/lookup", (req, _url, rc) => handleLookup(req, rc, ctx.runtime)),
    route("POST", "/api/deepdive", (req, _url, rc) => handleDeepdive(req, rc, ctx.runtime)),
    route("GET", "/api/defensives", (_req, url, rc) => handleDefensivesGet(url, rc, ctx.runtime)),
    route("POST", "/api/defensives", (req, _url, rc) => handleDefensivesPost(req, rc, ctx.runtime)),
    route("GET", "/api/history", (_req, _url, rc) => jsonResponse({ ok: true, items: historyOf(rc).list().map(historySummary) })),
    route("DELETE", "/api/history", (_req, _url, rc) => { historyOf(rc).clear(); return jsonResponse({ ok: true }); }),
    prefixRoute("GET", "/api/history/", async (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      const entry = historyOf(rc).get(key);
      if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
      // Hosted payloads are stored raw: attach today's cached analyses on the way out (0 pts).
      const result = rc.hosted ? await withCachedAnalyses(entry.result as LookupPayload, await tablesOf(rc, ctx.runtime)) : entry.result;
      return jsonResponse({ ok: true, result, key, fromCache: true });
    }),
    prefixRoute("DELETE", "/api/history/", (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      return jsonResponse({ ok: historyOf(rc).remove(key) });
    }),
    // In hosted mode the watcher never runs; the initial status is simply "inactive" and the stream is the member's own.
    route("GET", "/api/events", (_req, _url, rc) => eventsResponse({ event: "status", data: watcherStatus() }, rc.user?.id ?? null)),
    route("GET", "/api/health", () => handleHealth(ctx), "public"),
    route("GET", "/api/docs", async (_req, url) => {
      const lang = url.searchParams.get("lang");
      return jsonResponse(docsResponse(await getEvalConfig(), ctx.hosted, ctx.runtime?.config.pointsPerUserHour ?? null, isLocale(lang) ? lang : "en"));
    }, "public"),
    route("GET", "/api/status", () => {
      const rt = ctx.runtime;
      return rt
        ? jsonResponse({
            ok: true, hosted: true, hasCredentials: hasCredentials(), region: config.region,
            openSignup: rt.config.openSignup, guildRequired: rt.config.discordGuildId !== null,
            wclClients: rt.wclClients.enabled, operator: rt.config.operator,
          })
        : jsonResponse({
            ok: true, hosted: false, hasCredentials: hasCredentials(), envPath: ctx.envPath, region: config.region,
          });
    }, "public"),
  ];
}
