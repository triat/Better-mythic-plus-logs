import { hasCredentials } from "../config.ts";
import { buildLookupPayload, performLookup } from "../lookup.ts";
import type { Metric } from "../roles.ts";
import { History } from "../server-history.ts";
import type { HistoryEntry } from "../server-history.ts";
import { jsonResponse, parseCharacterInput, parseMetric, readJson } from "./http.ts";

interface LookupRequest {
  character?: string;
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
  refresh?: boolean;
}

export const history = new History(20);

export const historySummary = (entry: HistoryEntry) => ({
  key: entry.key,
  label: entry.label,
  charClass: entry.charClass,
  spec: entry.spec,
  targetLevel: entry.targetLevel,
  targetAutoDetected: entry.targetAutoDetected,
  fetchedAt: entry.fetchedAt,
  request: entry.request,
});

export interface LookupError {
  ok: false;
  error: string;
  status: number;
}

export interface LookupSuccess {
  ok: true;
  key: string;
  result: unknown;
  fromCache: boolean;
}

export async function runLookupWithCache(opts: {
  character: string;
  level: number | null;
  spec: string | null;
  metric: Metric | null;
  refresh: boolean;
}): Promise<LookupSuccess | LookupError> {
  if (!hasCredentials()) {
    return { ok: false, error: "No credentials configured. Visit /setup first.", status: 400 };
  }
  const target = parseCharacterInput(opts.character);
  if (!target) {
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
    if (hit) return { ok: true, key: hit.key, result: hit.result, fromCache: true };
  }

  try {
    const o = await performLookup({
      name: target.name,
      realm: target.realm,
      level: opts.level,
      spec: opts.spec,
      metric: opts.metric ?? undefined,
      enrich: true,
      refresh: opts.refresh,
    });
    if (!o.ok) return { ok: false, status: o.status, error: o.error };
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

    return { ok: true, key: entry.key, result: payload, fromCache: false };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function handleLookup(req: Request): Promise<Response> {
  const body = await readJson<LookupRequest>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  const raw = (body.character ?? "").trim();
  if (!raw) {
    return jsonResponse({ ok: false, error: "`character` is required" }, 400);
  }
  let levelOverride: number | null = null;
  if (body.level !== undefined && body.level !== null && body.level !== "") {
    const n = Number.parseInt(String(body.level), 10);
    if (!Number.isFinite(n) || n < 2) {
      return jsonResponse(
        { ok: false, error: `Invalid level: ${body.level}` },
        400,
      );
    }
    levelOverride = n;
  }
  const result = await runLookupWithCache({
    character: raw,
    level: levelOverride,
    spec: body.spec && body.spec.trim() ? body.spec.trim() : null,
    metric: parseMetric(body.metric ?? null) ?? null,
    refresh: !!body.refresh,
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error }, result.status);
  }
  return jsonResponse({
    ok: true,
    result: result.result,
    key: result.key,
    fromCache: result.fromCache,
  });
}
