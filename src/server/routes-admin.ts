// Invite and user management. Every route is auth: "admin"; the admin page (issue #8) is the client.
import { statSync } from "node:fs";
import { dirname } from "node:path";
import pkg from "../../package.json";
import { SHIPPED, specDefensives } from "../deepdive/table.ts";
import { DISCORD_ID } from "../hosted/config.ts";
import { HOUR_MS, hourStart } from "../hosted/db.ts";
import type { UserRow } from "../hosted/db.ts";
import { decide, proposalSummary, tablesFor } from "../hosted/defensives.ts";
import type { ProposalStatus } from "../hosted/defensives.ts";
import { avatarUrl } from "../hosted/discord.ts";
import { describeConfig, lastBackupAt } from "../hosted/instance.ts";
import { resetInS } from "../hosted/quota.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { resolveEnvPath } from "../setup.ts";
import { getStore } from "../signals/store.ts";
import { jsonResponse, readJson } from "./http.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";

interface AdminUserExtra { pointsHour: number; points24h: number; sessions: number; configAdmin: boolean }

const adminUser = (u: UserRow, extra: AdminUserExtra) => ({
  id: u.id, discordId: u.discordId, username: u.username, globalName: u.globalName,
  avatarUrl: avatarUrl(u.discordId, u.avatarHash), role: u.role, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
  ...extra,
});

const tail = (url: URL, prefix: string): string => url.pathname.slice(prefix.length);

export function adminRoutes(rt: HostedRuntime): Route[] {
  // A single user's row of extras (role change, revoke): the users list route computes these in bulk instead.
  const userExtra = (u: UserRow, at: number): AdminUserExtra => ({
    pointsHour: rt.db.usage.byUser(at).find((r) => r.userId === u.id)?.points ?? 0,
    points24h: rt.db.usage.byUserSince(at - 24 * HOUR_MS).find((r) => r.userId === u.id)?.points ?? 0,
    sessions: rt.db.sessions.countForUser(u.id, at),
    configAdmin: rt.config.adminDiscordIds.includes(u.discordId),
  });

  return [
    route("GET", "/api/admin/invites", () => jsonResponse({
      ok: true,
      invites: rt.db.invites.list().map((i) => {
        const u = rt.db.users.byDiscordId(i.discordId);
        return { ...i, user: u ? { id: u.id, username: u.username } : null };
      }),
    }), "admin"),
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
    // Moderation of members' defensives corrections (issue #6); the admin page (#8) is the client.
    route("GET", "/api/admin/proposals", (_req, url) => {
      const status = (url.searchParams.get("status") ?? "pending") as ProposalStatus;
      if (!["pending", "approved", "rejected"].includes(status)) return jsonResponse({ ok: false, error: "`status` must be pending, approved or rejected" }, 400);
      const shared = tablesFor(rt.db.defensives, null).override;
      const proposals = rt.db.defensives.listProposals(status).map((p) => {
        const [className, spec] = p.key.split(":") as [string, string];
        const d = specDefensives(SHIPPED, shared, className, spec);
        const e = d.entries.find((x) => x.id === p.spellId);
        const current = e ? { id: e.id, name: e.name, cooldownS: e.cooldownS, durationS: e.durationS, kind: e.kind } : null;
        return { ...proposalSummary(p), key: p.key, proposedBy: p.proposedBy, username: p.username, current, ignored: d.ignored.includes(p.spellId) };
      });
      return jsonResponse({ ok: true, proposals });
    }, "admin"),
    prefixRoute("POST", "/api/admin/proposals/", async (req, url, ctx) => {
      const m = /^(\d+)\/(approve|reject)$/.exec(tail(url, "/api/admin/proposals/"));
      if (!m) return jsonResponse({ ok: false, error: "Expected /api/admin/proposals/:id/approve or /reject" }, 400);
      const body = await readJson<{ note?: unknown }>(req);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const p = decide(rt.db.defensives, Number.parseInt(m[1]!, 10), { id: ctx.user!.id }, m[2] === "approve" ? "approved" : "rejected", note, ctx.now);
      if (!p) return jsonResponse({ ok: false, error: "No pending proposal with that id" }, 404);
      return jsonResponse({ ok: true, proposal: { ...proposalSummary(p), key: p.key, proposedBy: p.proposedBy } });
    }, "admin"),
    route("GET", "/api/admin/users", (_req, _url, ctx) => {
      const at = ctx.now;
      const hour = new Map(rt.db.usage.byUser(at).map((r) => [r.userId, r.points]));
      const day = new Map(rt.db.usage.byUserSince(at - 24 * HOUR_MS).map((r) => [r.userId, r.points]));
      const users = rt.db.users.list().map((u) => adminUser(u, {
        pointsHour: hour.get(u.id) ?? 0, points24h: day.get(u.id) ?? 0,
        sessions: rt.db.sessions.countForUser(u.id, at), configAdmin: rt.config.adminDiscordIds.includes(u.discordId),
      }));
      return jsonResponse({ ok: true, users });
    }, "admin"),
    prefixRoute("POST", "/api/admin/users/", async (req, url, ctx) => {
      const revoke = /^(\d+)\/sessions\/revoke$/.exec(tail(url, "/api/admin/users/"));
      if (revoke) {
        const id = Number.parseInt(revoke[1]!, 10);
        if (id === ctx.user!.id) return jsonResponse({ ok: false, error: "Sign out instead" }, 400);
        if (!rt.db.users.byId(id)) return jsonResponse({ ok: false, error: "Unknown user" }, 404);
        return jsonResponse({ ok: true, sessionsEnded: rt.db.sessions.deleteForUser(id) });
      }
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
      return jsonResponse({ ok: true, user: adminUser(rt.db.users.byId(id)!, userExtra(rt.db.users.byId(id)!, ctx.now)) });
    }, "admin"),
    route("GET", "/api/admin/instance", async () => {
      const dbPath = (await getStore())._db.filename;
      let dbBytes = 0;
      try { dbBytes = statSync(dbPath).size; } catch { /* :memory: or unreadable */ }
      const env = describeConfig(rt.config, { clientId: process.env.WCL_CLIENT_ID ?? null, hasSecret: !!process.env.WCL_CLIENT_SECRET });
      return jsonResponse({ ok: true, version: pkg.version as string, uptimeS: Math.round(process.uptime()), dbPath, dbBytes, lastBackupAt: lastBackupAt(dirname(await resolveEnvPath())), env });
    }, "admin"),
  ];
}
