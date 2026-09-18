// src/server/routes-user.ts
// Per-user settings ("your key", legend state). Only registered in hosted mode: local mode keeps
// them in the browser (web/src/lib/settings.ts).
import type { UserSettings } from "../hosted/db.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { jsonResponse } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { SETTINGS_BODY, parseBody } from "./validate.ts";

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
  ];
}
