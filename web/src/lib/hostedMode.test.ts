import { describe, expect, test } from "bun:test";
import { LOCAL_STATUS, initialScreen, uiControls } from "./hostedMode.ts";

const local = { hosted: false, hasCredentials: true, envPath: "/x/.env" };
const hosted = { hosted: true, hasCredentials: true, envPath: null };

describe("uiControls", () => {
  test("local mode shows every control", () => {
    expect(uiControls(local)).toEqual({ setup: true, quit: true, watch: true, envPath: true });
  });
  test("hosted mode hides setup, quit, clipboard watch and the env path", () => {
    expect(uiControls(hosted)).toEqual({ setup: false, quit: false, watch: false, envPath: false });
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
