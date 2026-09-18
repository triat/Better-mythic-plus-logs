import { hasCredentials } from "../config.ts";
import { attachDeepdive } from "../deepdive/attach.ts";
import { runDeepdive } from "../deepdive/run.ts";
import { applyPatch, getDefensives, resetDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../deepdive/table.ts";
import type { OverrideEntry } from "../deepdive/types.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import type { RequestContext } from "../hosted/auth.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { LookupPayload } from "../lookup.ts";
import { getStore } from "../signals/store.ts";
import { jsonResponse, readJson } from "./http.ts";
import { localHistory } from "./local-history.ts";

/** The payload with today's cached analyses attached and a re-run evaluation. 0 pts. Hosted reads go through this. */
export async function withCachedAnalyses(payload: LookupPayload): Promise<LookupPayload> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
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
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const r = await runDeepdive({ reportCode: body.reportCode, fightID: body.fightID, character: body.character, force: !!body.force }, { store, tables, reserve: runtime && user ? runtime.quota.for(user) : undefined });
  if (!r.ok) return jsonResponse(r.quota ? { ok: false, ...r.quota } : { ok: false, error: r.error }, r.status);
  if (!ctx.hosted) await refreshLocalHistory();
  // Hosted: the measured charge of this request replaces the PING-delta estimate.
  const accounting = runtime && user ? { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user) } : { pointsSpent: r.pointsSpent };
  return jsonResponse({ ok: true, result: r.result, fromCache: r.fromCache, ...accounting });
}

export async function handleDefensivesGet(url: URL, hosted = false): Promise<Response> {
  const className = (url.searchParams.get("class") ?? "").trim();
  const spec = (url.searchParams.get("spec") ?? "").trim();
  if (!className || !spec) return jsonResponse({ ok: false, error: "`class` and `spec` are required" }, 400);
  const tables = await getDefensives();
  const d = specDefensives(tables.shipped, tables.override, className, spec);
  return jsonResponse({ ok: true, key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: hosted ? null : tables.overridePath, warning: tables.warning ?? null });
}

interface DefensivesPatchBody { className?: string; spec?: string; patch?: OverrideEntry }

export async function handleDefensivesPost(req: Request, hosted = false): Promise<Response> {
  const body = await readJson<DefensivesPatchBody>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.className || !body.spec || !body.patch) return jsonResponse({ ok: false, error: "`className`, `spec` and `patch` are required" }, 400);
  const tables = await getDefensives();
  if (tables.warning) {
    const message = hosted
      ? "the server's defensives override is invalid — an admin must fix it"
      : `${tables.overridePath} is invalid — fix it by hand first: ${tables.warning}`;
    return jsonResponse({ ok: false, error: message }, 409);
  }
  try {
    const key = specKey(body.className, body.spec);
    const effective = specDefensives(tables.shipped, tables.override, body.className, body.spec);
    const next = validateOverride(applyPatch(tables.override, key, validateOverride({ [key]: [body.patch] })[key]![0]!, effective));
    await saveOverride(tables.overridePath, next);
    resetDefensives();
    if (!hosted) await refreshLocalHistory();
    const fresh = await getDefensives();
    const d = specDefensives(fresh.shipped, fresh.override, body.className, body.spec);
    return jsonResponse({ ok: true, key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: hosted ? null : fresh.overridePath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
