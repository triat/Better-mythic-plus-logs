import { describe, expect, test } from "bun:test";
import { DISCORD_ME_URL, DISCORD_TOKEN_URL, authorizeUrl, avatarUrl, exchangeCode, fetchDiscordUser, redirectUri } from "../../src/hosted/discord.ts";

const CFG = { discordClientId: "123456789012345678", discordClientSecret: "sekrit", baseUrl: "https://bmpl.example.com" };

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch;

describe("authorizeUrl", () => {
  test("has client_id, identify scope, redirect_uri and state", () => {
    const u = new URL(authorizeUrl(CFG, "st4te"));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe(CFG.discordClientId);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("identify");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bmpl.example.com/auth/discord/callback");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("prompt")).toBe("none");
    expect(redirectUri(CFG.baseUrl)).toBe("https://bmpl.example.com/auth/discord/callback");
  });
});

describe("exchangeCode", () => {
  test("posts a form body and returns the access token", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const f = fakeFetch((url, init) => { seen = { url, init }; return Response.json({ access_token: "tok", token_type: "Bearer" }); });
    const r = await exchangeCode(CFG, "c0de", f);
    expect(r).toEqual({ ok: true, accessToken: "tok" });
    expect(seen!.url).toBe(DISCORD_TOKEN_URL);
    expect(seen!.init?.method).toBe("POST");
    const body = new URLSearchParams(String(seen!.init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(body.get("client_id")).toBe(CFG.discordClientId);
    expect(body.get("client_secret")).toBe("sekrit");
    expect(body.get("redirect_uri")).toBe("https://bmpl.example.com/auth/discord/callback");
    expect(new Headers(seen!.init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  });
  test("non-2xx, missing token and network errors are reported, never thrown", async () => {
    expect((await exchangeCode(CFG, "c", fakeFetch(() => new Response("nope", { status: 400 })))).ok).toBe(false);
    expect((await exchangeCode(CFG, "c", fakeFetch(() => Response.json({})))).ok).toBe(false);
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const r = await exchangeCode(CFG, "c", boom);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("offline");
  });
});

describe("fetchDiscordUser", () => {
  test("sends the bearer token and maps the identity", async () => {
    let auth = "";
    const f = fakeFetch((url, init) => { auth = new Headers(init?.headers).get("authorization") ?? ""; expect(url).toBe(DISCORD_ME_URL); return Response.json({ id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" }); });
    const r = await fetchDiscordUser("tok", f);
    expect(auth).toBe("Bearer tok");
    expect(r).toEqual({ ok: true, identity: { discordId: "123456789012345678", username: "tom", globalName: "Tom", avatarHash: "abc" } });
  });
  test("null global_name/avatar and bad payloads", async () => {
    const r = await fetchDiscordUser("tok", fakeFetch(() => Response.json({ id: "123456789012345678", username: "tom", global_name: null, avatar: null })));
    expect(r).toEqual({ ok: true, identity: { discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null } });
    expect((await fetchDiscordUser("tok", fakeFetch(() => Response.json({ username: "x" })))).ok).toBe(false);
    expect((await fetchDiscordUser("tok", fakeFetch(() => new Response("", { status: 401 })))).ok).toBe(false);
  });
});

describe("avatarUrl", () => {
  test("hash → cdn avatar, no hash → default embed avatar by (id >> 22) % 6", () => {
    expect(avatarUrl("123456789012345678", "abc")).toBe("https://cdn.discordapp.com/avatars/123456789012345678/abc.png?size=64");
    expect(avatarUrl("123456789012345678", null)).toBe(`https://cdn.discordapp.com/embed/avatars/${(123456789012345678n >> 22n) % 6n}.png`);
  });
});
