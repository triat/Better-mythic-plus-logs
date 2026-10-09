// src/server/routes-user.ts
// Per-user settings ("your key", legend state, remembered region and locale) and a member's own WCL client (issue #11 Task 3).
// Only registered in hosted mode: local mode keeps settings in the browser (web/src/lib/settings.ts)
// and has no notion of a member's own WCL client.
import type { UserSettings } from "../hosted/db.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { WclCredentials } from "../wcl/auth.ts";
import type { Locale } from "../hosted/locale.ts";
import type { LiveRole, LiveSort } from "../hosted/live.ts";
import type { Region } from "../wow/regions.ts";
import { jsonResponse } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { SETTINGS_BODY, USAGE_EVENTS_BODY, WCL_CLIENT_BODY, parseBody } from "./validate.ts";
import { USAGE_BATCH_MAX_COUNT, USAGE_BATCH_MAX_NAMES, isUiEvent } from "../hosted/usage-catalog.ts";
import type { UiEvent } from "../hosted/usage-catalog.ts";

/** The "Nothing to update" rule on an already-validated (SETTINGS_BODY) patch. */
export function parseSettingsPatch(value: { yourKey?: number | null; legendOpen?: boolean; region?: Region | null; locale?: Locale | null; liveSort?: LiveSort; liveRoles?: LiveRole[]; liveClasses?: string[] }): { ok: true; patch: Partial<UserSettings> } | { ok: false; error: string } {
  const patch: Partial<UserSettings> = {};
  if ("yourKey" in value) patch.yourKey = value.yourKey!;
  if ("legendOpen" in value) patch.legendOpen = value.legendOpen!;
  if ("region" in value) patch.region = value.region!;
  if ("locale" in value) patch.locale = value.locale!;
  if ("liveSort" in value) patch.liveSort = value.liveSort!;
  if ("liveRoles" in value) patch.liveRoles = value.liveRoles!;
  if ("liveClasses" in value) patch.liveClasses = value.liveClasses!;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update: send `yourKey`, `legendOpen`, `region`, `locale`, `liveSort`, `liveRoles` and/or `liveClasses`" };
  return { ok: true, patch };
}

/**
 * `POST /api/usage/events`'s `events`: a plain object of at most USAGE_BATCH_MAX_NAMES names, each an
 * integer count in 1..USAGE_BATCH_MAX_COUNT. Names outside the catalogue's interface events are dropped
 * (a tab opened before a deploy may send an old one); a bad shape is an error.
 */
export function parseUsageEvents(v: unknown): { ok: true; events: Array<[UiEvent, number]>; dropped: number } | { ok: false; error: string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "`events` must be an object of event names to counts" };
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "`events` is empty" };
  if (entries.length > USAGE_BATCH_MAX_NAMES) return { ok: false, error: `\`events\` holds at most ${USAGE_BATCH_MAX_NAMES} names` };
  const events: Array<[UiEvent, number]> = [];
  let dropped = 0;
  for (const [name, n] of entries) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > USAGE_BATCH_MAX_COUNT) return { ok: false, error: `\`events.${name.slice(0, 40)}\` must be an integer between 1 and ${USAGE_BATCH_MAX_COUNT}` };
    if (isUiEvent(name)) events.push([name, n]);
    else dropped++;
  }
  return { ok: true, events, dropped };
}

export function userRoutes(rt: HostedRuntime): Route[] {
  return [
    route("GET", "/api/settings", (_req, _url, ctx) => jsonResponse({ ok: true, settings: rt.db.settings.get(ctx.user!.id) })),
    route("PUT", "/api/settings", async (req, _url, ctx) => {
      const b = await parseBody(req, SETTINGS_BODY);
      if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
      const parsed = parseSettingsPatch(b.value);
      if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
      return jsonResponse({ ok: true, settings: rt.db.settings.update(ctx.user!.id, parsed.patch, ctx.now) });
    }),

    // Batched interface events from the front (feature-usage spec, decision 4). 0 WCL points.
    route("POST", "/api/usage/events", async (req, _url, ctx) => {
      const b = await parseBody(req, USAGE_EVENTS_BODY);
      if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
      const parsed = parseUsageEvents(b.value.events);
      if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
      for (const [name, n] of parsed.events) rt.track(ctx.user!.id, name, n);
      return jsonResponse({ ok: true, recorded: parsed.events.length, dropped: parsed.dropped });
    }),

    route("GET", "/api/me/wcl-client", async (_req, _url, ctx) =>
      jsonResponse({ ok: true, enabled: rt.wclClients.enabled, client: await rt.wclClients.view(ctx.user!.id) })),
    route("PUT", "/api/me/wcl-client", async (req, _url, ctx) => {
      const b = await parseBody(req, WCL_CLIENT_BODY);
      if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
      const creds: WclCredentials = b.value;
      const r = await rt.wclClients.save(ctx.user!.id, creds, ctx.now);
      if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
      rt.audit.record("wcl_client_set", { target: r.client.clientId });
      return jsonResponse({ ok: true, client: r.client });
    }),
    route("POST", "/api/me/wcl-client/verify", async (_req, _url, ctx) => {
      const r = await rt.wclClients.verify(ctx.user!.id, ctx.now);
      if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
      return jsonResponse({ ok: true, client: r.client });
    }),
    route("DELETE", "/api/me/wcl-client", (_req, _url, ctx) => {
      const removed = rt.wclClients.remove(ctx.user!.id);
      if (removed) rt.audit.record("wcl_client_remove");
      return jsonResponse({ ok: removed });
    }),
  ];
}
