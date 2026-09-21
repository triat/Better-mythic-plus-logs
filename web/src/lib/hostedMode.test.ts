import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { LOCAL_STATUS, accountAccess, adminAccess, bootScreen, deniedNotice, initialScreen, loginFailed, pageOf, proposalMode, signInNote, uiControls } from "./hostedMode.ts";

const tFr = makeT(fr, "fr");
const local = { hosted: false, hasCredentials: true, envPath: "/x/.env", openSignup: false, guildRequired: false, wclClients: false, operator: "", region: "eu" as const };
const hosted = { hosted: true, hasCredentials: true, envPath: null, openSignup: false, guildRequired: false, wclClients: true, operator: "Muleyoxo", region: "eu" as const };

describe("uiControls", () => {
  test("local mode shows every control", () => {
    expect(uiControls(local)).toEqual({ setup: true, quit: true, watch: true, envPath: true, signOut: false });
  });
  test("hosted mode hides setup, quit, clipboard watch and the env path", () => {
    expect(uiControls(hosted)).toEqual({ setup: false, quit: false, watch: false, envPath: false, signOut: true });
  });
});

describe("initialScreen", () => {
  test("local: setup when credentials are missing or on /setup", () => {
    expect(initialScreen({ ...local, hasCredentials: false }, "/")).toBe("setup");
    expect(initialScreen(local, "/setup")).toBe("setup");
    expect(initialScreen(local, "/")).toBe("main");
  });
  test("hosted: never the setup screen, even on /setup or without credentials", () => {
    expect(initialScreen(hosted, "/setup")).toBe("main");
    expect(initialScreen({ ...hosted, hasCredentials: false }, "/")).toBe("main");
  });
  test("fallback status is local with everything on", () => {
    expect(LOCAL_STATUS).toEqual({ hosted: false, hasCredentials: true, envPath: null, openSignup: false, guildRequired: false, wclClients: false, operator: "", region: "eu" });
  });
});

describe("bootScreen", () => {
  const me = { kind: "ok" as const, user: { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const }, quota: null, ownClient: null };
  test("hosted: signed in → main, otherwise signin (never setup)", () => {
    expect(bootScreen(hosted, me, "/")).toBe("main");
    expect(bootScreen(hosted, { kind: "unauthorized" }, "/")).toBe("signin");
    expect(bootScreen(hosted, { kind: "error", error: "x" }, "/")).toBe("signin");
    expect(bootScreen(hosted, null, "/setup")).toBe("signin");
  });
  test("local: ignores me and follows initialScreen", () => {
    expect(bootScreen(local, null, "/setup")).toBe("setup");
    expect(bootScreen({ ...local, hasCredentials: false }, me, "/")).toBe("setup");
    expect(bootScreen(local, null, "/")).toBe("main");
  });
});

describe("deniedNotice / signInNote / pageOf / accountAccess", () => {
  const me = { kind: "ok" as const, user: { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const }, quota: null, ownClient: null };
  test("denied kinds", () => {
    expect(deniedNotice(tEn, "?denied=123456789012345678")).toEqual({ kind: "invite", discordId: "123456789012345678" });
    expect(deniedNotice(tEn, "?denied=guild")).toEqual({ kind: "guild", title: "Members of the guild's Discord only", text: "Your account is not in that server. Join it, then sign in again." });
    expect(deniedNotice(tEn, "?denied=banned")).toEqual({ kind: "banned", title: "Account banned", text: "This account cannot sign in here. Contact the admin on Discord." });
    expect(deniedNotice(tEn, "?denied=rate")).toEqual({ kind: "rate", title: "Too many new accounts", text: "Too many sign-ups from your network in the last hour — try again later." });
    expect(deniedNotice(tEn, "?denied=abc")).toBeNull();
    expect(deniedNotice(tEn, "")).toBeNull();
    expect(deniedNotice(tEn, "?x=1")).toBeNull();
  });
  test("sign-in note per mode", () => {
    const h = { ...hosted, openSignup: false, guildRequired: false, wclClients: false, operator: "x" };
    expect(signInNote(tEn, h)).toBe("Invite-only. Only your Discord id and name are stored — no message or server access.");
    expect(signInNote(tEn, { ...h, openSignup: true })).toBe("Anyone with a Discord account can sign in. Only your Discord id and name are stored — no message or server access.");
    expect(signInNote(tEn, { ...h, openSignup: true, guildRequired: true })).toBe("Members of the guild's Discord only. Sign-in reads your server list once to check membership and keeps nothing from it.");
    expect(signInNote(tEn, { ...h, guildRequired: true })).toBe("Members of the guild's Discord only. Sign-in reads your server list once to check membership and keeps nothing from it.");
  });
  test("in French", () => {
    expect(deniedNotice(tFr, "?denied=guild")).toEqual({ kind: "guild", title: "Réservé aux membres du Discord de la guilde", text: "Ton compte n'est pas sur ce serveur. Rejoins-le, puis reconnecte-toi." });
    expect(signInNote(tFr, hosted)).toBe("Sur invitation uniquement. Seuls ton id et ton nom Discord sont stockés — aucun accès aux messages ni aux serveurs.");
  });
  test("pages", () => {
    expect(pageOf("/")).toBe("main");
    expect(pageOf("/admin")).toBe("admin");
    expect(pageOf("/settings")).toBe("settings");
    expect(pageOf("/privacy")).toBe("privacy");
    expect(pageOf("/help")).toBe("help");
    expect(pageOf("/other")).toBe("main");
  });
  test("accountAccess", () => {
    expect(accountAccess(hosted, me.user)).toBe("ok");
    expect(accountAccess(hosted, null)).toBe("signin");
    expect(accountAccess(local, null)).toBe("local");
    expect(accountAccess(local, me.user)).toBe("local");
  });
});

test("uiControls: signOut only in hosted mode", () => {
  expect(uiControls(local).signOut).toBe(false);
  expect(uiControls(hosted).signOut).toBe(true);
});

describe("loginFailed", () => {
  test("true only for ?login=failed", () => {
    expect(loginFailed("?login=failed")).toBe(true);
    expect(loginFailed("?login=failed&denied=123456789012345678")).toBe(true);
    expect(loginFailed("?login=other")).toBe(false);
    expect(loginFailed("")).toBe(false);
  });
});

describe("proposalMode", () => {
  const user = { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const };
  test("local edits the file, hosted members propose, hosted admins correct on the spot", () => {
    expect(proposalMode(local, null)).toBe("local");
    expect(proposalMode(local, user)).toBe("local");
    expect(proposalMode(hosted, user)).toBe("propose");
    expect(proposalMode(hosted, { ...user, role: "admin" })).toBe("admin");
    expect(proposalMode(hosted, null)).toBe("propose");
  });
});

describe("adminAccess", () => {
  const user = { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const };
  test("local → local, hosted member → member, hosted admin → ok", () => {
    expect(adminAccess(local, null)).toBe("local");
    expect(adminAccess(hosted, user)).toBe("member");
    expect(adminAccess(hosted, null)).toBe("member");
    expect(adminAccess(hosted, { ...user, role: "admin" })).toBe("ok");
  });
});
