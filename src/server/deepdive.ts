import { hasCredentials } from "../config.ts";
import { attachDeepdive } from "../deepdive/attach.ts";
import { runDeepdive } from "../deepdive/run.ts";
import { applyPatch, getDefensives, resetDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../deepdive/table.ts";
import type { OverrideEntry } from "../deepdive/types.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import type { LookupPayload } from "../lookup.ts";
import { getStore } from "../signals/store.ts";
import { jsonResponse, readJson } from "./http.ts";
import { history } from "./lookup.ts";

/** Re-attach cached analyses (and re-evaluate) on every history entry — after an analysis or a table change. 0 pts. */
export async function refreshHistoryDeepdive(): Promise<void> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
  for (const e of history.list()) history.updateResult(e.key, attachDeepdive(e.result as LookupPayload, store, tables, cfg));
}

interface DeepdiveBody { reportCode?: string; fightID?: number; character?: string; force?: boolean }

export async function handleDeepdive(req: Request): Promise<Response> {
  const body = await readJson<DeepdiveBody>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.reportCode || typeof body.fightID !== "number" || !body.character) return jsonResponse({ ok: false, error: "`reportCode`, `fightID` and `character` are required" }, 400);
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const r = await runDeepdive({ reportCode: body.reportCode, fightID: body.fightID, character: body.character, force: !!body.force }, { store, tables });
  if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
  await refreshHistoryDeepdive();
  return jsonResponse({ ok: true, result: r.result, fromCache: r.fromCache, pointsSpent: r.pointsSpent });
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
    await refreshHistoryDeepdive();
    const fresh = await getDefensives();
    const d = specDefensives(fresh.shipped, fresh.override, body.className, body.spec);
    return jsonResponse({ ok: true, key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: hosted ? null : fresh.overridePath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
