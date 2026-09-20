import { hasCredentials } from "../config.ts";
import type { LoadedTables } from "../deepdive/types.ts";
import type { RequestContext } from "../hosted/auth.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { QuotaRefusal, Reserve } from "../hosted/quota.ts";
import { buildLookupPayload, performLookup } from "../lookup.ts";
import type { LookupOutcome, LookupPayload } from "../lookup.ts";
import type { Metric } from "../roles.ts";
import { cacheKey } from "../server-history.ts";
import type { HistoryListItem, HistoryStore } from "../server-history.ts";
import { WclError } from "../wcl/client.ts";
import { failureBody, tablesOf, wclScopeFor, withCachedAnalyses } from "./deepdive.ts";
import { jsonResponse, parseCharacterInput } from "./http.ts";
import { LOOKUP_BODY, WOW_NAME, WOW_REALM, parseBody } from "./validate.ts";

export const historySummary = (entry: HistoryListItem) => ({
  key: entry.key,
  label: entry.label,
  charClass: entry.charClass,
  spec: entry.spec,
  targetLevel: entry.targetLevel,
  targetAutoDetected: entry.targetAutoDetected,
  fetchedAt: entry.fetchedAt,
  request: entry.request,
});

/** The history a gated handler may use; anonymous hosted requests never reach a handler (authGate), so this is a bug guard. */
export const historyOf = (ctx: RequestContext): HistoryStore => {
  if (!ctx.history) throw new Error("no history for an anonymous request");
  return ctx.history;
};

export interface LookupError { ok: false; error: string; status: number; quota?: QuotaRefusal; /** The WCL error's public message when the failure came from WCL (safe to show in hosted mode). */ wcl?: string }
export interface LookupSuccess { ok: true; key: string; result: unknown; fromCache: boolean; /** Shared another caller's in-flight fetch of the same request. */ joined: boolean }
export interface LookupDeps { reserve?: Reserve; performLookup?: typeof performLookup; tables?: LoadedTables }

// Identical lookups that overlap share one WCL fetch (keyed like the history, "auto" level included).
// A refresh never joins an existing flight, and it registers its own flight only when none is in
// progress for that key — it must never displace another caller's in-flight (non-refresh) fetch,
// or a third, later caller could join the wrong one mid-air.
const inflight = new Map<string, Promise<LookupOutcome>>();

export async function runLookupWithCache(opts: {
  character: string;
  level: number | null;
  spec: string | null;
  metric: Metric | null;
  refresh: boolean;
}, history: HistoryStore, deps: LookupDeps = {}): Promise<LookupSuccess | LookupError> {
  if (!hasCredentials()) {
    return { ok: false, error: "No credentials configured. Visit /setup first.", status: 400 };
  }
  const target = parseCharacterInput(opts.character);
  if (!target || !WOW_NAME.test(target.name) || !WOW_REALM.test(target.realm)) {
    return {
      ok: false,
      error: "Could not parse character. Use `Name-Realm` or `Name Realm`.",
      status: 400,
    };
  }

  const requestCharacter = `${target.name}-${target.realm}`;
  const request = { character: requestCharacter, level: opts.level, spec: opts.spec, metric: opts.metric };

  if (!opts.refresh) {
    const hit = history.cached(request);
    if (hit) return { ok: true, key: hit.key, result: hit.result, fromCache: true, joined: false };
  }

  try {
    const flightKey = cacheKey(request);
    let flight = opts.refresh ? undefined : inflight.get(flightKey);
    const joined = flight !== undefined;
    if (!flight) {
      flight = (deps.performLookup ?? performLookup)({
        name: target.name,
        realm: target.realm,
        level: opts.level,
        spec: opts.spec,
        metric: opts.metric ?? undefined,
        enrich: true,
        refresh: opts.refresh,
      }, { reserve: deps.reserve, tables: deps.tables });
      if (!inflight.has(flightKey)) inflight.set(flightKey, flight);
      const started = flight;
      void started.catch(() => {}).finally(() => { if (inflight.get(flightKey) === started) inflight.delete(flightKey); });
    }
    let o = await flight;
    if (!o.ok && joined && o.status === 429) {
      // The joiner shared the starter's flight and inherited its 429, but that refusal carries the
      // *starter's* quota numbers, not the joiner's own. Run the joiner's own lookup once, directly —
      // not through the in-flight map: the joiner's continuation runs before the shared flight's
      // `.finally` cleanup, so re-joining here would just hit the same, already-settled flight again.
      o = await (deps.performLookup ?? performLookup)({
        name: target.name,
        realm: target.realm,
        level: opts.level,
        spec: opts.spec,
        metric: opts.metric ?? undefined,
        enrich: true,
        refresh: opts.refresh,
      }, { reserve: deps.reserve, tables: deps.tables });
    }
    if (!o.ok) return { ok: false, status: o.status, error: o.error, ...(o.quota ? { quota: o.quota } : {}) };
    const payload = buildLookupPayload(o, target.realm);

    // Keyed by the *effective* level: an auto-detected +21 and an explicit +21 are one tab.
    const entry = history.record(request, {
      result: payload,
      label: requestCharacter,
      charClass: o.data.character.classID,
      spec: o.data.character.spec,
      targetLevel: o.result.targetLevel,
      targetAutoDetected: o.result.targetAutoDetected,
    });

    return { ok: true, key: entry.key, result: payload, fromCache: false, joined };
  } catch (e) {
    if (e instanceof WclError) return { ok: false, status: 502, error: e.message, wcl: e.publicMessage };
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function handleLookup(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const b = await parseBody(req, LOOKUP_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const body = b.value;
  const user = runtime && ctx.user ? { id: ctx.user.id, role: ctx.user.role } : null;
  runtime?.audit.setTarget(`lookup ${body.character}`);
  const tables = await tablesOf(ctx, runtime);
  const scope = await wclScopeFor(runtime, ctx.user);
  const result = await scope.run(() => runLookupWithCache({
    character: body.character,
    level: body.level ?? null,
    spec: body.spec || null,
    metric: body.metric ?? null,
    refresh: !!body.refresh,
  }, historyOf(ctx), { reserve: scope.own ? undefined : (runtime && user ? runtime.quota.for(user) : undefined), tables }));
  if (!result.ok) return jsonResponse(failureBody(result, runtime), result.status);
  // Hosted: always attach on read against the member's own tables (a joiner never sees the starter's pending layer).
  const payload = ctx.hosted ? await withCachedAnalyses(result.result as LookupPayload, tables) : result.result;
  // A member's own client charges nothing to the shared meter/usage (issue #11 Task 3).
  const accounting = runtime && user
    ? scope.own
      ? { pointsSpent: 0, quota: runtime.quota.status(user), ownClient: await runtime.wclClients.view(user.id) }
      : { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user), ownClient: null }
    : {};
  return jsonResponse({ ok: true, result: payload, key: result.key, fromCache: result.fromCache, ...accounting });
}
