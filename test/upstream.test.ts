import { afterEach, describe, expect, test } from "bun:test";
import { instrumentFetch, opOfQuery, opOfUrl, serviceOfUrl, setUpstreamObserver, timedFetch } from "../src/upstream.ts";
import type { UpstreamCall } from "../src/upstream.ts";

const calls: UpstreamCall[] = [];
afterEach(() => { calls.length = 0; setUpstreamObserver(null); });
const observe = () => setUpstreamObserver((c) => calls.push(c));

describe("upstream calls", () => {
  test("a GraphQL call is named by its first field, an HTTP call by its path without character names", () => {
    expect(opOfQuery("query($id: Int!) { worldData { zone(id: $id) { encounters { id } } } }")).toBe("worldData");
    expect(opOfQuery("{ rateLimitData { pointsSpentThisHour } }")).toBe("rateLimitData");
    expect(opOfUrl("https://eu.api.blizzard.com/profile/wow/character/hyjal/tom/status?namespace=profile-eu")).toBe("/profile/wow/character/*");
    expect(opOfUrl("https://discord.com/api/users/@me/guilds")).toBe("/api/users/@me/guilds");
    expect(serviceOfUrl("https://oauth.battle.net/token")).toBe("bnet");
    expect(serviceOfUrl("https://discord.com/api/oauth2/token")).toBe("discord");
    expect(serviceOfUrl("https://raider.io/api/v1/characters/profile")).toBeNull();
  });
  test("timedFetch reports the status, or null with the error when the call throws, and never swallows it", async () => {
    observe();
    await timedFetch("wcl", "worldData", async () => new Response("{}", { status: 502 }), { client: "shared" });
    await expect(timedFetch("wcl", "oauth", async () => { throw new Error("ECONNRESET"); })).rejects.toThrow("ECONNRESET");
    expect(calls).toMatchObject([
      { service: "wcl", op: "worldData", status: 502, ok: false, client: "shared" },
      { service: "wcl", op: "oauth", status: null, ok: false, error: "ECONNRESET" },
    ]);
    expect(calls[0]!.ms).toBeGreaterThanOrEqual(0);
  });
  test("an instrumented fetch reports Discord and Battle.net, passes anything else through silently", async () => {
    observe();
    const f = instrumentFetch((async () => new Response("ok")) as unknown as typeof fetch);
    await f("https://discord.com/api/users/@me");
    await f("https://example.com/x");
    expect(calls.map((c) => [c.service, c.op, c.status])).toEqual([["discord", "/api/users/@me", 200]]);
  });
  test("without an observer nothing is reported (local mode, the CLI)", async () => {
    await timedFetch("raiderio", "profile", async () => new Response("{}"));
    expect(calls).toHaveLength(0);
  });
});
