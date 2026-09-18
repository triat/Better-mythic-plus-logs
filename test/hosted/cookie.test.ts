import { describe, expect, test } from "bun:test";
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie, signSessionId, verifySessionCookie } from "../../src/hosted/cookie.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("parseCookies", () => {
  test("parses name=value pairs, trims, ignores malformed", () => {
    const m = parseCookies("a=1; bmpl_session=abc.def ; bad; c=");
    expect(m.get("a")).toBe("1");
    expect(m.get("bmpl_session")).toBe("abc.def");
    expect(m.get("c")).toBe("");
    expect(m.has("bad")).toBe(false);
    expect(parseCookies(null).size).toBe(0);
  });
});

describe("session cookie signing", () => {
  test("round-trips and rejects tampering, wrong secret, malformed", () => {
    const v = signSessionId("session-id-1", SECRET);
    expect(v.startsWith("session-id-1.")).toBe(true);
    expect(verifySessionCookie(v, SECRET)).toBe("session-id-1");
    expect(verifySessionCookie(v.slice(0, -1) + (v.endsWith("A") ? "B" : "A"), SECRET)).toBeNull();
    expect(verifySessionCookie("session-id-2." + v.split(".")[1], SECRET)).toBeNull();
    expect(verifySessionCookie(v, "another-secret-another-secret-00")).toBeNull();
    expect(verifySessionCookie("nodot", SECRET)).toBeNull();
    expect(verifySessionCookie("", SECRET)).toBeNull();
    expect(verifySessionCookie(undefined, SECRET)).toBeNull();
  });
});

describe("serializeCookie / clearCookie", () => {
  test("session cookie attributes", () => {
    const s = serializeCookie(SESSION_COOKIE, "v", { maxAgeS: SESSION_COOKIE_MAX_AGE_S, path: "/", secure: true });
    expect(s).toBe("bmpl_session=v; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure");
    const o = serializeCookie(OAUTH_COOKIE, "n", { maxAgeS: 600, path: "/auth", secure: false });
    expect(o).toBe("bmpl_oauth=n; Max-Age=600; Path=/auth; HttpOnly; SameSite=Lax");
    expect(clearCookie(SESSION_COOKIE, { path: "/", secure: true })).toBe("bmpl_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");
  });
});
