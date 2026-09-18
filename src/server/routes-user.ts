// src/server/routes-user.ts
// Per-user settings ("your key", legend state). Only registered in hosted mode: local mode keeps
// them in the browser (web/src/lib/settings.ts).
import type { UserSettings } from "../hosted/db.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { jsonResponse, readJson } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";

// Mirrors KEY_MIN / KEY_MAX in web/src/lib/keyLevel.ts.
export const KEY_MIN = 2;
export const KEY_MAX = 40;

/** Validated partial settings from a PUT body. Unknown fields are ignored; an empty patch is an error. */
export function parseSettingsPatch(body: unknown): { ok: true; patch: Partial<UserSettings> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  const patch: Partial<UserSettings> = {};
  if ("yourKey" in b) {
    const v = b.yourKey;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= KEY_MIN && v <= KEY_MAX)) {
      return { ok: false, error: `\`yourKey\` must be null or an integer between ${KEY_MIN} and ${KEY_MAX}` };
    }
    patch.yourKey = v as number | null;
  }
  if ("legendOpen" in b) {
    if (typeof b.legendOpen !== "boolean") return { ok: false, error: "`legendOpen` must be a boolean" };
    patch.legendOpen = b.legendOpen;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update: send `yourKey` and/or `legendOpen`" };
  return { ok: true, patch };
}

export function userRoutes(rt: HostedRuntime): Route[] {
  return [
    route("GET", "/api/settings", (_req, _url, ctx) => jsonResponse({ ok: true, settings: rt.db.settings.get(ctx.user!.id) })),
    route("PUT", "/api/settings", async (req, _url, ctx) => {
      const parsed = parseSettingsPatch(await readJson<unknown>(req));
      if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
      return jsonResponse({ ok: true, settings: rt.db.settings.update(ctx.user!.id, parsed.patch, ctx.now) });
    }),
  ];
}
