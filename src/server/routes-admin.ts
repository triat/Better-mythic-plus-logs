// Invite and user management. Every route is auth: "admin"; the admin page (issue #8) is the client.
import { DISCORD_ID } from "../hosted/config.ts";
import { HOUR_MS, hourStart } from "../hosted/db.ts";
import type { UserRow } from "../hosted/db.ts";
import { avatarUrl } from "../hosted/discord.ts";
import { resetInS } from "../hosted/quota.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { jsonResponse, readJson } from "./http.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";

const adminUser = (u: UserRow) => ({
  id: u.id, discordId: u.discordId, username: u.username, globalName: u.globalName,
  avatarUrl: avatarUrl(u.discordId, u.avatarHash), role: u.role, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
});

const tail = (url: URL, prefix: string): string => url.pathname.slice(prefix.length);

export function adminRoutes(rt: HostedRuntime): Route[] {
  return [
    route("GET", "/api/admin/invites", () => jsonResponse({ ok: true, invites: rt.db.invites.list() }), "admin"),
    route("POST", "/api/admin/invites", async (req, _url, ctx) => {
      const body = await readJson<{ discordId?: unknown; note?: unknown }>(req);
      const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
      if (!DISCORD_ID.test(discordId)) return jsonResponse({ ok: false, error: "`discordId` must be a 17–20 digit Discord user id" }, 400);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
      return jsonResponse({ ok: true, invite: rt.db.invites.add(discordId, `admin:${ctx.user!.id}`, note, Date.now()) });
    }, "admin"),
    prefixRoute("DELETE", "/api/admin/invites/", (_req, url) => {
      const id = tail(url, "/api/admin/invites/");
      if (!DISCORD_ID.test(id)) return jsonResponse({ ok: false, error: "Invalid Discord id" }, 400);
      const user = rt.db.users.byDiscordId(id);
      const removed = rt.db.invites.remove(id);
      const sessionsEnded = user && !rt.config.adminDiscordIds.includes(id) ? rt.db.sessions.deleteForUser(user.id) : 0;
      return jsonResponse({ ok: removed, sessionsEnded });
    }, "admin"),
    // Budget gauge for the admin page (issue #8): this hour per member, the shared client's last
    // rateLimitData, and the last 24 hourly totals.
    route("GET", "/api/admin/usage", (_req, _url, ctx) => {
      const at = ctx.now;
      const users = new Map(rt.db.users.list().map((u) => [u.id, u]));
      return jsonResponse({
        ok: true,
        hourStart: hourStart(at),
        resetInS: resetInS(at),
        limitPerUser: rt.config.pointsPerUserHour,
        instance: rt.meter.snapshot(),
        users: rt.db.usage.byUser(at).map((r) => {
          const u = users.get(r.userId);
          return { userId: r.userId, discordId: u?.discordId ?? null, username: u?.username ?? null, role: u?.role ?? null, points: r.points };
        }),
        hours: rt.db.usage.totals(at - 24 * HOUR_MS),
      });
    }, "admin"),
    route("GET", "/api/admin/users", () => jsonResponse({ ok: true, users: rt.db.users.list().map(adminUser) }), "admin"),
    prefixRoute("POST", "/api/admin/users/", async (req, url, ctx) => {
      const m = /^(\d+)\/role$/.exec(tail(url, "/api/admin/users/"));
      if (!m) return jsonResponse({ ok: false, error: "Invalid user id" }, 400);
      const id = Number.parseInt(m[1]!, 10);
      const body = await readJson<{ role?: unknown }>(req);
      const role = body?.role;
      if (role !== "member" && role !== "admin") return jsonResponse({ ok: false, error: "`role` must be member or admin" }, 400);
      if (id === ctx.user!.id) return jsonResponse({ ok: false, error: "You cannot change your own role" }, 400);
      const target = rt.db.users.byId(id);
      if (!target) return jsonResponse({ ok: false, error: "Unknown user" }, 404);
      if (rt.config.adminDiscordIds.includes(target.discordId)) return jsonResponse({ ok: false, error: "role is set by BMPL_ADMIN_DISCORD_IDS" }, 400);
      if (!rt.db.users.setRole(id, role)) return jsonResponse({ ok: false, error: "Unknown user" }, 404);
      return jsonResponse({ ok: true, user: adminUser(rt.db.users.byId(id)!) });
    }, "admin"),
  ];
}
