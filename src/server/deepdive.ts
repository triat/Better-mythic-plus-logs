import { hasCredentials } from "../config.ts";
import { attachDeepdive } from "../deepdive/attach.ts";
import { runDeepdive } from "../deepdive/run.ts";
import { applyPatch, getDefensives, resetDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../deepdive/table.ts";
import type { LoadedTables, OverrideEntry } from "../deepdive/types.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import { clip } from "../hosted/audit.ts";
import type { RequestContext, SessionUser } from "../hosted/auth.ts";
import { propose, proposalSummary, tablesFor } from "../hosted/defensives.ts";
import type { QuotaRefusal } from "../hosted/quota.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { LookupPayload } from "../lookup.ts";
import { getStore } from "../signals/store.ts";
import { runWithWclClient } from "../wcl/client.ts";
import { jsonResponse } from "./http.ts";
import { localHistory } from "./local-history.ts";
import { DEEPDIVE_BODY, DEFENSIVES_BODY, parseBody } from "./validate.ts";

/** The WCL scope a lookup/deep-dive runs in (issue #11 Task 3): a member's own client when they have
 * one saved, the shared/env client otherwise. `own` tells the caller whether to skip the shared
 * quota gate and charge nothing to `usage_hourly`. */
export interface WclScope { run<T>(fn: () => Promise<T>): Promise<T>; own: boolean }

export async function wclScopeFor(runtime: HostedRuntime | null, user: SessionUser | null): Promise<WclScope> {
  const creds = runtime && user ? await runtime.wclClients.credentials(user.id) : null;
  if (!creds) return { run: (fn) => fn(), own: false };
  const rt = runtime!;
  const userId = user!.id;
  return { own: true, run: (fn) => runWithWclClient({ creds, onRateLimit: (rl) => rt.wclClients.observe(userId, rl) }, fn) };
}

/** The tables a request analyses with: the member's own layer (shared ⊕ their pending proposals) when hosted, the file otherwise. */
export async function tablesOf(ctx: RequestContext, runtime: HostedRuntime | null): Promise<LoadedTables> {
  return runtime && ctx.user ? tablesFor(runtime.db.defensives, ctx.user.id) : getDefensives();
}

/** The payload with today's cached analyses attached against `tables` and a re-run evaluation. 0 pts. Hosted reads go through this. */
export async function withCachedAnalyses(payload: LookupPayload, tables: LoadedTables): Promise<LookupPayload> {
  const [store, cfg] = await Promise.all([getStore(), getEvalConfig()]);
  return attachDeepdive(payload, store, tables, cfg);
}

/** Local mode: re-attach on every entry of the process-wide history after an analysis or a table change. 0 pts. */
export async function refreshLocalHistory(): Promise<void> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
  for (const e of localHistory.list()) localHistory.updateResult(e.key, attachDeepdive(e.result as LookupPayload, store, tables, cfg));
}

/**
 * The `{ ok: false, … }` body of a failed lookup / deep-dive. Hosted mode records the refusal or the
 * failure in the audit log and never echoes an unknown 5xx message to the member: a WCL failure passes
 * through as `WCL: <public message>` (the observer already logged it), anything else 5xx becomes
 * "Internal error". Local mode keeps the message as is.
 */
export function failureBody(r: { status: number; error: string; quota?: QuotaRefusal; wcl?: string }, runtime: HostedRuntime | null): Record<string, unknown> {
  if (runtime) {
    if (r.quota) runtime.audit.record("quota_refused", { detail: { used: r.quota.used, limit: r.quota.limit, resetInS: r.quota.resetInS, error: r.quota.error } });
    else if (r.status >= 500 && !r.wcl) runtime.audit.record("server_error", { detail: { message: clip(r.error) } });
  }
  if (r.quota) return { ok: false, ...r.quota };
  const error = !runtime ? r.error : r.wcl ? `WCL: ${r.wcl}` : r.status >= 500 ? "Internal error" : r.error;
  return { ok: false, error };
}

export async function handleDeepdive(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const b = await parseBody(req, DEEPDIVE_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const body = b.value;
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  const user = runtime && ctx.user ? { id: ctx.user.id, role: ctx.user.role } : null;
  runtime?.audit.setTarget(`deepdive ${body.reportCode}:${body.fightID}`);
  const [store, tables] = await Promise.all([getStore(), tablesOf(ctx, runtime)]);
  const scope = await wclScopeFor(runtime, ctx.user);
  const r = await scope.run(() => runDeepdive({ reportCode: body.reportCode, fightID: body.fightID, character: body.character, force: !!body.force }, { store, tables, reserve: scope.own ? undefined : (runtime && user ? runtime.quota.for(user) : undefined) }));
  if (!r.ok) return jsonResponse(failureBody(r, runtime), r.status);
  if (!ctx.hosted) await refreshLocalHistory();
  // Hosted: the measured charge of this request replaces the PING-delta estimate; a member's own
  // client charges nothing to the shared meter/usage.
  const accounting = runtime && user
    ? scope.own
      ? { pointsSpent: 0, quota: runtime.quota.status(user), ownClient: await runtime.wclClients.view(user.id) }
      : { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user), ownClient: null }
    : { pointsSpent: r.pointsSpent };
  return jsonResponse({ ok: true, result: r.result, fromCache: r.fromCache, ...accounting });
}

const specResponse = (tables: LoadedTables, className: string, spec: string) => {
  const d = specDefensives(tables.shipped, tables.override, className, spec);
  return { key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: tables.overridePath, warning: tables.warning ?? null };
};

export async function handleDefensivesGet(url: URL, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const className = (url.searchParams.get("class") ?? "").trim();
  const spec = (url.searchParams.get("spec") ?? "").trim();
  if (!className || !spec) return jsonResponse({ ok: false, error: "`class` and `spec` are required" }, 400);
  const tables = await tablesOf(ctx, runtime);
  const base = specResponse(tables, className, spec);
  const proposals = runtime && ctx.user ? runtime.db.defensives.proposalsOf(ctx.user.id, base.key).map(proposalSummary) : [];
  return jsonResponse({ ok: true, ...base, proposals });
}

export async function handleDefensivesPost(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const b = await parseBody(req, DEFENSIVES_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const body = b.value;
  if (runtime && ctx.user) {
    // Hosted: a correction is a proposal — it applies to its author now and to everyone once an admin approves it.
    const r = propose(runtime.db.defensives, { id: ctx.user.id, role: ctx.user.role }, body.className, body.spec, body.patch, ctx.now);
    if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
    return jsonResponse({ ok: true, ...specResponse(r.tables, body.className, body.spec), proposal: proposalSummary(r.proposal) });
  }
  const tables = await getDefensives();
  if (tables.warning) return jsonResponse({ ok: false, error: `${tables.overridePath} is invalid — fix it by hand first: ${tables.warning}` }, 409);
  if (tables.source !== "file" || tables.overridePath === null) return jsonResponse({ ok: false, error: "no override file in this mode" }, 400);
  try {
    const key = specKey(body.className, body.spec);
    const effective = specDefensives(tables.shipped, tables.override, body.className, body.spec);
    const next = validateOverride(applyPatch(tables.override, key, validateOverride({ [key]: [body.patch] })[key]![0]!, effective));
    await saveOverride(tables.overridePath, next);
    resetDefensives();
    await refreshLocalHistory();
    return jsonResponse({ ok: true, ...specResponse(await getDefensives(), body.className, body.spec) });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
