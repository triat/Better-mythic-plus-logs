import { describe, expect, test } from "bun:test";
import {
  BLIZZARD_TO_WCL_CLASS,
  BNET_REGIONS,
  BNET_TOKEN_URL,
  BNET_USERINFO_URL,
  BnetAppToken,
  bnetAuthorizeUrl,
  bnetRedirectUri,
  characterStatus,
  exchangeBnetCode,
  fetchAccountCharacters,
  fetchBnetUser,
  mergeCandidates,
} from "../../src/hosted/bnet.ts";
import type { BnetCandidate } from "../../src/hosted/bnet-db.ts";
import { CLASS_NAMES } from "../../src/wow/classes.ts";
import { loadBnetFixture } from "../fixtures.ts";

const CFG = { bnetClientId: "bnet-client", bnetClientSecret: "bnet-sekrit", baseUrl: "https://bmpl.example.com" };
const BASIC = `Basic ${Buffer.from("bnet-client:bnet-sekrit").toString("base64")}`;

type Seen = { url: string; init?: RequestInit };
/** A fake fetch keyed by exact URL; an unexpected URL throws, so no test can reach the network. */
const fakeFetch = (routes: Record<string, (init?: RequestInit) => Response>, seen: Seen[] = []): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const h = routes[url];
    if (!h) throw new Error("unexpected fetch " + url);
    return h(init);
  }) as unknown as typeof fetch;
const failing = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
const auth = (s: Seen): string | null => new Headers(s.init?.headers).get("authorization");

const listUrl = (r: string) => `https://${r}.api.blizzard.com/profile/user/wow?namespace=profile-${r}&locale=en_US`;
const statusUrl = "https://eu.api.blizzard.com/profile/wow/character/silverbough/thornwick/status?namespace=profile-eu&locale=en_US";
const THORNWICK = { region: "eu" as const, realm: "silverbough", name: "Thornwick", bnetId: 70000101 };

describe("bnetAuthorizeUrl", () => {
  test("has client_id, response_type, the wow.profile scope, redirect_uri and state", () => {
    const u = new URL(bnetAuthorizeUrl(CFG, "st4te"));
    expect(u.origin + u.pathname).toBe("https://oauth.battle.net/authorize");
    expect(u.searchParams.get("client_id")).toBe("bnet-client");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("wow.profile");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bmpl.example.com/auth/bnet/callback");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.has("client_secret")).toBe(false);
    expect(bnetRedirectUri(CFG.baseUrl)).toBe("https://bmpl.example.com/auth/bnet/callback");
    expect(BNET_REGIONS).toEqual(["eu", "us", "kr", "tw"]);
  });
});

describe("exchangeBnetCode", () => {
  test("posts the code as a form with HTTP Basic client authentication", async () => {
    const seen: Seen[] = [];
    const f = fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: "user-tok", token_type: "bearer", expires_in: 86399, scope: "wow.profile" }) }, seen);
    expect(await exchangeBnetCode(CFG, "c0de", f)).toEqual({ ok: true, accessToken: "user-tok", scope: "wow.profile" });
    expect(seen[0]!.init?.method).toBe("POST");
    expect(auth(seen[0]!)).toBe(BASIC);
    expect(new Headers(seen[0]!.init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(seen[0]!.init?.body));
    expect([...body.keys()].sort()).toEqual(["code", "grant_type", "redirect_uri"]);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(body.get("redirect_uri")).toBe("https://bmpl.example.com/auth/bnet/callback");
  });

  test("a granted scope list without wow.profile is refused; no scope field is accepted", async () => {
    const shrunk = fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: "t", scope: "openid" }) });
    const r = await exchangeBnetCode(CFG, "c", shrunk);
    expect(r.ok === false && r.kind).toBe("scope");
    const wider = fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: "t", scope: "openid wow.profile" }) });
    expect(await exchangeBnetCode(CFG, "c", wider)).toEqual({ ok: true, accessToken: "t", scope: "openid wow.profile" });
    const none = fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: "t" }) });
    expect(await exchangeBnetCode(CFG, "c", none)).toEqual({ ok: true, accessToken: "t", scope: null });
  });

  test("non-2xx and a missing token are invalid, a network error is down; no secret or code in the error", async () => {
    const bad = await exchangeBnetCode(CFG, "secret-code", fakeFetch({ [BNET_TOKEN_URL]: () => new Response("no", { status: 400 }) }));
    expect(bad.ok === false && bad.kind).toBe("invalid");
    expect(bad.ok === false && bad.error).toContain("400");
    const empty = await exchangeBnetCode(CFG, "c", fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({}) }));
    expect(empty.ok === false && empty.kind).toBe("invalid");
    const down = await exchangeBnetCode(CFG, "secret-code", failing);
    expect(down.ok === false && down.kind).toBe("down");
    for (const r of [bad, empty, down]) {
      const e = r.ok ? "" : r.error;
      expect(e).not.toContain("secret-code");
      expect(e).not.toContain("bnet-sekrit");
    }
  });
});

describe("fetchBnetUser", () => {
  const user = (payload: unknown, seen?: Seen[]) => fakeFetch({ [BNET_USERINFO_URL]: () => Response.json(payload) }, seen);

  test("a numeric id is read as a string, with the BattleTag and a Bearer header", async () => {
    const seen: Seen[] = [];
    expect(await fetchBnetUser("user-tok", user({ id: 123456789, battletag: "Wanderer#1234", sub: "123456789" }, seen)))
      .toEqual({ ok: true, accountId: "123456789", battletag: "Wanderer#1234" });
    expect(auth(seen[0]!)).toBe("Bearer user-tok");
  });

  test("falls back to sub; a missing BattleTag is null", async () => {
    expect(await fetchBnetUser("t", user({ sub: "424242" }))).toEqual({ ok: true, accountId: "424242", battletag: null });
    expect(await fetchBnetUser("t", user({ id: "777", battletag: 5 }))).toEqual({ ok: true, accountId: "777", battletag: null });
  });

  test("no id at all is invalid; a non-2xx or network error is a failure, never a throw", async () => {
    const r = await fetchBnetUser("t", user({ battletag: "Wanderer#1234" }));
    expect(r.ok === false && r.kind).toBe("invalid");
    expect((await fetchBnetUser("t", fakeFetch({ [BNET_USERINFO_URL]: () => new Response("", { status: 401 }) }))).ok).toBe(false);
    const down = await fetchBnetUser("t", failing);
    expect(down.ok === false && down.kind).toBe("down");
  });
});

describe("fetchAccountCharacters", () => {
  test("200: every account's characters as candidates, with a Bearer header and the region's namespace", async () => {
    const fixture = await loadBnetFixture("profile-eu");
    const seen: Seen[] = [];
    const r = await fetchAccountCharacters("user-tok", "eu", fakeFetch({ [listUrl("eu")]: () => Response.json(fixture) }, seen));
    expect(auth(seen[0]!)).toBe("Bearer user-tok");
    expect(seen[0]!.url).not.toContain("user-tok");
    expect(r).toEqual({
      ok: true,
      candidates: [
        { bnetId: 70000101, name: "Thornwick", realm: "silverbough", realmName: "Silverbough", region: "eu", level: 80, classID: 2 },
        { bnetId: 70000102, name: "Aelinora", realm: "mistvale-keep", realmName: "Mistvale Keep", region: "eu", level: 80, classID: 7 },
        { bnetId: 70000103, name: "Pebblet", realm: "silverbough", realmName: "Silverbough", region: "eu", level: 12, classID: 11 },
      ],
    });
  });

  test("404 is an empty region, 401/403 a scope refusal, 429/5xx/network down", async () => {
    const status = (s: number) => fakeFetch({ [listUrl("kr")]: () => new Response("", { status: s }) });
    expect(await fetchAccountCharacters("t", "kr", status(404))).toEqual({ ok: true, candidates: [] });
    for (const s of [401, 403]) {
      const r = await fetchAccountCharacters("t", "kr", status(s));
      expect(r.ok === false && r.kind).toBe("scope");
    }
    for (const s of [429, 500, 503]) {
      const r = await fetchAccountCharacters("t", "kr", status(s));
      expect(r.ok === false && r.kind).toBe("down");
      expect(r.ok === false && r.error).toContain(String(s));
    }
    const net = await fetchAccountCharacters("t", "kr", failing);
    expect(net.ok === false && net.kind).toBe("down");
  });

  test("a character whose name or realm slug breaks bmpl's rules is skipped; a missing class is null", async () => {
    const payload = {
      wow_accounts: [{
        characters: [
          { id: 1, name: "Bad1Name", realm: { slug: "silverbough", name: "Silverbough" }, playable_class: { id: 1 }, level: 80 },
          { id: 2, name: "Goodname", realm: { slug: "bad_realm!", name: "Bad" }, playable_class: { id: 1 }, level: 80 },
          { id: 3, name: "Kept", realm: { slug: "silverbough", name: "Silverbough" }, level: 70 },
          { id: "4", name: "Noid", realm: { slug: "silverbough", name: "Silverbough" }, level: 70 },
        ],
      }],
    };
    const r = await fetchAccountCharacters("t", "tw", fakeFetch({ [listUrl("tw")]: () => Response.json(payload) }));
    expect(r).toEqual({ ok: true, candidates: [{ bnetId: 3, name: "Kept", realm: "silverbough", realmName: "Silverbough", region: "tw", level: 70, classID: null }] });
  });

  test("a 200 without wow_accounts is invalid", async () => {
    const r = await fetchAccountCharacters("t", "us", fakeFetch({ [listUrl("us")]: () => Response.json({ id: 1 }) }));
    expect(r.ok === false && r.kind).toBe("invalid");
  });
});

describe("mergeCandidates", () => {
  test("merges regions, dedupes by region + id, sorts by level (high first) then name", async () => {
    const [euJson, usJson] = [await loadBnetFixture("profile-eu"), await loadBnetFixture("profile-us")];
    const eu = await fetchAccountCharacters("t", "eu", fakeFetch({ [listUrl("eu")]: () => Response.json(euJson) }));
    const us = await fetchAccountCharacters("t", "us", fakeFetch({ [listUrl("us")]: () => Response.json(usJson) }));
    if (!eu.ok || !us.ok) throw new Error("fixture parse failed");
    expect(us.candidates.length).toBe(3); // Brannoc listed under two wow_accounts
    // The same id in another region is another character.
    const twin: BnetCandidate = { bnetId: 80000201, name: "Brannoc", realm: "ironhollow", realmName: "Ironhollow", region: "eu", level: 80, classID: 2 };
    const merged = mergeCandidates([eu.candidates, us.candidates, [twin], us.candidates]);
    expect(merged.map((c) => `${c.region}:${c.name}:${c.level}`)).toEqual([
      "eu:Aelinora:80",
      "eu:Brannoc:80",
      "us:Brannoc:80",
      "eu:Thornwick:80",
      "us:Zephyrine:70",
      "eu:Pebblet:12",
    ]);
    expect(mergeCandidates([])).toEqual([]);
  });
});

describe("BnetAppToken", () => {
  test("client credentials with Basic auth, cached until 60 s before expiry, then refreshed", async () => {
    const seen: Seen[] = [];
    let n = 0;
    const f = fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: `app-${++n}`, token_type: "bearer", expires_in: 3600 }) }, seen);
    const app = new BnetAppToken(CFG, f);
    const t0 = 1_000_000;
    expect(await app.get(t0)).toEqual({ ok: true, token: "app-1" });
    expect(await app.get(t0 + 3_539_000)).toEqual({ ok: true, token: "app-1" });
    expect(seen.length).toBe(1);
    expect(auth(seen[0]!)).toBe(BASIC);
    expect(new URLSearchParams(String(seen[0]!.init?.body)).get("grant_type")).toBe("client_credentials");
    expect(await app.get(t0 + 3_540_000)).toEqual({ ok: true, token: "app-2" });
    expect(seen.length).toBe(2);
  });

  test("concurrent gets share one request", async () => {
    let n = 0;
    const app = new BnetAppToken(CFG, fakeFetch({ [BNET_TOKEN_URL]: () => Response.json({ access_token: `app-${++n}`, expires_in: 3600 }) }));
    const [a, b] = await Promise.all([app.get(0), app.get(0)]);
    expect(a).toEqual({ ok: true, token: "app-1" });
    expect(b).toEqual({ ok: true, token: "app-1" });
    expect(n).toBe(1);
  });

  test("a failure is returned and not cached", async () => {
    let status = 503;
    const app = new BnetAppToken(CFG, fakeFetch({ [BNET_TOKEN_URL]: () => (status === 200 ? Response.json({ access_token: "app", expires_in: 3600 }) : new Response("", { status })) }));
    const r = await app.get(0);
    expect(r.ok === false && r.kind).toBe("down");
    expect(r.ok === false && r.error).not.toContain("bnet-sekrit");
    status = 401;
    const r2 = await app.get(0);
    expect(r2.ok === false && r2.kind).toBe("invalid");
    status = 200;
    expect(await app.get(0)).toEqual({ ok: true, token: "app" });
    expect((await new BnetAppToken(CFG, failing).get(0)).ok).toBe(false);
  });
});

describe("characterStatus", () => {
  test("200, is_valid and the same id: valid; lower-case name, Bearer header", async () => {
    const fixture = await loadBnetFixture("status-valid");
    const seen: Seen[] = [];
    expect(await characterStatus("app", THORNWICK, fakeFetch({ [statusUrl]: () => Response.json(fixture) }, seen)))
      .toEqual({ ok: true, outcome: "valid" });
    expect(auth(seen[0]!)).toBe("Bearer app");
  });

  test("the realm and name are URL-encoded", async () => {
    const url = "https://us.api.blizzard.com/profile/wow/character/mistvale-keep/%C3%A6linora/status?namespace=profile-us&locale=en_US";
    const c = { region: "us" as const, realm: "mistvale-keep", name: "Ælinora", bnetId: 5 };
    expect(await characterStatus("app", c, fakeFetch({ [url]: () => Response.json({ id: 5, is_valid: true }) })))
      .toEqual({ ok: true, outcome: "valid" });
  });

  test("404, is_valid false and another id: gone with the reason", async () => {
    const answer = (res: () => Response) => characterStatus("app", THORNWICK, fakeFetch({ [statusUrl]: res }));
    expect(await answer(() => new Response("", { status: 404 }))).toEqual({ ok: true, outcome: "gone", reason: "not_found" });
    expect(await answer(() => Response.json({ id: 70000101, is_valid: false }))).toEqual({ ok: true, outcome: "gone", reason: "invalid" });
    expect(await answer(() => Response.json({ id: 70000999, is_valid: true }))).toEqual({ ok: true, outcome: "gone", reason: "other_id" });
  });

  test("429, 5xx, network and a malformed answer are failures (the character is kept)", async () => {
    const answer = (res: () => Response) => characterStatus("app", THORNWICK, fakeFetch({ [statusUrl]: res }));
    for (const s of [429, 500, 502]) {
      const r = await answer(() => new Response("", { status: s }));
      expect(r.ok === false && r.kind).toBe("down");
    }
    const net = await characterStatus("app", THORNWICK, failing);
    expect(net.ok === false && net.kind).toBe("down");
    const odd = await answer(() => Response.json({ is_valid: true }));
    expect(odd.ok === false && odd.kind).toBe("invalid");
    const r401 = await answer(() => new Response("", { status: 401 }));
    expect(r401.ok === false && r401.kind).toBe("invalid");
  });
});

describe("BLIZZARD_TO_WCL_CLASS", () => {
  test("every Blizzard playable class lands on the WCL class of the same name", () => {
    const blizzard: Record<number, string> = { 1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 10: "Monk", 11: "Druid", 12: "Demon Hunter", 13: "Evoker" };
    for (const [id, name] of Object.entries(blizzard)) expect(CLASS_NAMES[BLIZZARD_TO_WCL_CLASS[Number(id)]!]).toBe(name);
    expect(BLIZZARD_TO_WCL_CLASS[99]).toBeUndefined();
  });
});
