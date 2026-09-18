import { hasCredentials } from "../config.ts";
import { attachDeepdive } from "../deepdive/attach.ts";
import { runDeepdive } from "../deepdive/run.ts";
import { applyPatch, getDefensives, resetDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../deepdive/table.ts";
import type { LoadedTables, OverrideEntry } from "../deepdive/types.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import type { RequestContext } from "../hosted/auth.ts";
import { propose, proposalSummary, tablesFor } from "../hosted/defensives.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { LookupPayload } from "../lookup.ts";
import { getStore } from "../signals/store.ts";
import { jsonResponse, readJson } from "./http.ts";
import { localHistory } from "./local-history.ts";

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

interface DeepdiveBody { reportCode?: string; fightID?: number; character?: string; force?: boolean }

export async function handleDeepdive(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const body = await readJson<DeepdiveBody>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.reportCode || typeof body.fightID !== "number" || !body.character) return jsonResponse({ ok: false, error: "`reportCode`, `fightID` and `character` are required" }, 400);
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  const user = runtime && ctx.user ? { id: ctx.user.id, role: ctx.user.role } : null;
  const [store, tables] = await Promise.all([getStore(), tablesOf(ctx, runtime)]);
  const r = await runDeepdive({ reportCode: body.reportCode, fightID: body.fightID, character: body.character, force: !!body.force }, { store, tables, reserve: runtime && user ? runtime.quota.for(user) : undefined });
  if (!r.ok) return jsonResponse(r.quota ? { ok: false, ...r.quota } : { ok: false, error: r.error }, r.status);
  if (!ctx.hosted) await refreshLocalHistory();
  // Hosted: the measured charge of this request replaces the PING-delta estimate.
  const accounting = runtime && user ? { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user) } : { pointsSpent: r.pointsSpent };
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

interface DefensivesPatchBody { className?: string; spec?: string; patch?: OverrideEntry }

export async function handleDefensivesPost(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const body = await readJson<DefensivesPatchBody>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.className || !body.spec || !body.patch) return jsonResponse({ ok: false, error: "`className`, `spec` and `patch` are required" }, 400);
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
