import { signSessionId } from "../../src/hosted/cookie.ts";
import type { HostedConfig } from "../../src/hosted/config.ts";
import type { HostedDb, Role, UserRow } from "../../src/hosted/db.ts";

export const TEST_HOSTED_CONFIG: HostedConfig = {
  baseUrl: "http://localhost",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  discordClientId: "123456789012345678",
  discordClientSecret: "test-client-secret",
  adminDiscordIds: ["111111111111111111", "444444444444444444"],
  pointsPerUserHour: 300,
  openSignup: false,
  discordGuildId: null,
  encryptionKey: null,
  operator: "the admin of this instance",
};

export const TEST_ENCRYPTION_KEY = new Uint8Array(32).map((_, i) => i);

/** Inserts a user + session straight into the DB and returns the Cookie header to send. */
export function loginAs(db: HostedDb, secret: string, who: { discordId: string; role: Role; username?: string }, now = Date.now()): { cookie: string; user: UserRow; sessionId: string } {
  const user = db.users.upsertFromDiscord({ discordId: who.discordId, username: who.username ?? "user" + who.discordId.slice(-4), globalName: null, avatarHash: null }, who.role, now);
  const s = db.sessions.create(user.id, { ip: "127.0.0.1", userAgent: "test", now });
  return { cookie: `bmpl_session=${signSessionId(s.id, secret)}`, user, sessionId: s.id };
}
