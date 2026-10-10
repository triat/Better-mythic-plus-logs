// The self-review routes (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md): the season view at
// 0 pts, and the sync, which hosted runs only on the member's own WCL client (decision 3).
import { hasCredentials } from "../config.ts";
import { analyzeCached } from "../deepdive/attach.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import type { RequestContext } from "../hosted/auth.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { CharacterNotFoundError, inferTargetLevel } from "../mplus.ts";
import { ownsCharacter } from "../self/characters.ts";
import { seasonView } from "../self/season.ts";
import { rowToRun, runSeasonSync, syncState } from "../self/sync.ts";
import { getStore } from "../signals/store.ts";
import { realmToSlug } from "../util.ts";
import { WclError } from "../wcl/client.ts";
import { isRegion } from "../wow/regions.ts";
import { failureBody, tablesOf, wclScopeFor } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { SEASON_SYNC_BODY, WOW_NAME, WOW_REALM, parseBody } from "./validate.ts";

const OWN_CLIENT_REQUIRED = "A season sync runs on your own Warcraft Logs client: add one in Settings.";
const NOT_YOURS = "A season sync is for your own characters: add this one to My characters first.";

export async function handleSeasonGet(url: URL, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const name = url.searchParams.get("name") ?? "";
  const realm = url.searchParams.get("realm") ?? "";
  const region = url.searchParams.get("region") ?? "";
  const levelRaw = url.searchParams.get("level");
  if (!WOW_NAME.test(name) || !WOW_REALM.test(realm) || !isRegion(region)) {
    return jsonResponse({ ok: false, error: "Expected `name`, `realm` and `region`" }, 400);
  }
  const level = levelRaw === null ? null : Number(levelRaw);
  if (level !== null && !(Number.isInteger(level) && level >= 2 && level <= 50)) return jsonResponse({ ok: false, error: "Invalid `level`" }, 400);
  const store = await getStore();
  const key = { region, realm: realmToSlug(realm), name };
  const zoneID = store.latestSeasonZone(key);
  if (zoneID === null) return jsonResponse({ ok: true, season: null });
  const rows = store.seasonRuns(key, zoneID);
  const [cfg, tables] = await Promise.all([getEvalConfig(), tablesOf(ctx, runtime)]);
  const season = seasonView({
    character: { name, realm: key.realm, region },
    zoneID,
    targetLevel: level ?? inferTargetLevel(rows.map(rowToRun)) ?? rows[0]!.keyLevel,
    now: ctx.now,
    rows,
    report: (code, fightID) => store.getWclRun(code, fightID),
    analysis: (code, fightID, player) => analyzeCached(store, tables, { reportCode: code, fightID }, player),
    control: (code, fightID) => store.getRunControl(code, fightID),
    state: syncState(store, rows, ctx.now),
  }, cfg);
  return jsonResponse({ ok: true, season });
}

export async function handleSeasonSync(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const b = await parseBody(req, SEASON_SYNC_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const body = b.value;
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  // The sync is for the member's own characters (phase-2 spec, decision 6); local mode has no account to check against.
  if (ctx.hosted && !(runtime && ctx.user && ownsCharacter(runtime.db.settings.get(ctx.user.id).characters, body))) {
    return jsonResponse({ ok: false, error: "not_your_character", message: NOT_YOURS }, 403);
  }
  const scope = await wclScopeFor(runtime, ctx.user);
  // Hosted, a sync never spends the shared budget (decision 3): refused before any WCL call.
  if (ctx.hosted && !scope.own) return jsonResponse({ ok: false, error: "own_client_required", message: OWN_CLIENT_REQUIRED }, 403);
  runtime?.audit.setTarget(`season ${body.name}-${body.realm}`);
  const store = await getStore();
  try {
    const out = await scope.run(() => runSeasonSync(body, { store, now: ctx.now }));
    if (!out.ok) return jsonResponse({ ok: false, error: out.error }, out.status);
    runtime?.track(ctx.user?.id ?? null, "season_sync");
    const ownClient = runtime && ctx.user ? { ownClient: await runtime.wclClients.view(ctx.user.id) } : {};
    return jsonResponse({ ok: true, fetched: out.fetched, failed: out.failed, state: out.state, pointsSpent: out.pointsSpent, ...ownClient });
  } catch (e) {
    if (e instanceof CharacterNotFoundError) {
      return jsonResponse(failureBody({ status: 404, error: e.message, notFound: { character: `${body.name}-${body.realm}`, region: body.region } }, runtime), 404);
    }
    if (e instanceof WclError) return jsonResponse(failureBody({ status: 502, error: e.message, wcl: e.publicMessage }, runtime), 502);
    throw e;
  }
}
