import { describe, expect, test } from "bun:test";
import { LOCAL_STATUS, bootScreen, deniedDiscordId, initialScreen, loginFailed, uiControls } from "./hostedMode.ts";

const local = { hosted: false, hasCredentials: true, envPath: "/x/.env" };
const hosted = { hosted: true, hasCredentials: true, envPath: null };

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
    expect(LOCAL_STATUS).toEqual({ hosted: false, hasCredentials: true, envPath: null });
  });
});

describe("bootScreen", () => {
  const me = { kind: "ok" as const, user: { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const }, quota: null };
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

describe("deniedDiscordId", () => {
  test("parses a valid id only", () => {
    expect(deniedDiscordId("?denied=123456789012345678")).toBe("123456789012345678");
    expect(deniedDiscordId("?denied=abc")).toBeNull();
    expect(deniedDiscordId("")).toBeNull();
    expect(deniedDiscordId("?x=1")).toBeNull();
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
