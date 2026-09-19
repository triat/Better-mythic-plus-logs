// src/server/routes-user.ts
// Per-user settings ("your key", legend state) and a member's own WCL client (issue #11 Task 3).
// Only registered in hosted mode: local mode keeps settings in the browser (web/src/lib/settings.ts)
// and has no notion of a member's own WCL client.
import type { UserSettings } from "../hosted/db.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { WclCredentials } from "../wcl/auth.ts";
import { jsonResponse } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { SETTINGS_BODY, WCL_CLIENT_BODY, parseBody } from "./validate.ts";

/** The "Nothing to update" rule on an already-validated (SETTINGS_BODY) patch. */
export function parseSettingsPatch(value: { yourKey?: number | null; legendOpen?: boolean }): { ok: true; patch: Partial<UserSettings> } | { ok: false; error: string } {
  const patch: Partial<UserSettings> = {};
  if ("yourKey" in value) patch.yourKey = value.yourKey!;
  if ("legendOpen" in value) patch.legendOpen = value.legendOpen!;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update: send `yourKey` and/or `legendOpen`" };
  return { ok: true, patch };
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

    route("GET", "/api/me/wcl-client", (_req, _url, ctx) =>
      jsonResponse({ ok: true, enabled: rt.wclClients.enabled, client: rt.wclClients.view(ctx.user!.id) })),
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
