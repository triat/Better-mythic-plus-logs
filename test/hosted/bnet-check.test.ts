import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openHosted, type HostedDb } from "../../src/hosted/db.ts";
import { AuditLog } from "../../src/hosted/audit.ts";
import { BNET_TOKEN_URL, BnetAppToken } from "../../src/hosted/bnet.ts";
import {
  BNET_CHECK_AFTER_MS,
  BNET_CHECK_INTERVAL_MS,
  BNET_MAX_AGE_MS,
  checkBnetCharacters,
} from "../../src/hosted/bnet-check.ts";
import { ErrorRing } from "../../src/hosted/error-ring.ts";
import type { MyCharacter } from "../../src/self/characters.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_770_000_000_000;
const CFG = { bnetClientId: "bnet-client", bnetClientSecret: "bnet-sekrit", baseUrl: "https://bmpl.example.com" };

type Handler = () => Response | Promise<Response>;
/** A fake fetch keyed by exact URL; an unexpected URL throws, so no test can reach the network. */
const fakeFetch = (routes: Record<string, Handler>, seen: string[] = []): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const h = routes[url];
    if (!h) throw new Error("unexpected fetch " + url);
    return h();
  }) as unknown as typeof fetch;
const token: Record<string, Handler> = { [BNET_TOKEN_URL]: () => Response.json({ access_token: "app", expires_in: 3600 }) };
const statusUrl = (name: string, realm = "hyjal") =>
  `https://eu.api.blizzard.com/profile/wow/character/${realm}/${name.toLowerCase()}/status?namespace=profile-eu&locale=en_US`;
const valid = (id: number): Handler => () => Response.json({ id, is_valid: true });
const down: Handler = () => { throw new Error("network down"); };

const bnetChar = (name: string, bnetId: number, ageDays: number): MyCharacter =>
  ({ name, realm: "hyjal", region: "eu", source: "bnet", bnetId, verifiedAt: NOW - ageDays * DAY });

function setup(lists: MyCharacter[][]) {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const users = lists.map((characters, i) => {
    const u = hosted.users.upsertFromDiscord({ discordId: `10000000000000000${i}`, username: `u${i}`, globalName: null, avatarHash: null }, null, 0);
    hosted.bnet.link.put(u.id, `acct-${i}`, null, 0);
    hosted.settings.update(u.id, { characters }, 0);
    return u;
  });
  let writes = 0;
  const counted: HostedDb = {
    ...hosted,
    settings: { ...hosted.settings, update: (...a) => { writes++; return hosted.settings.update(...a); } },
  };
  const audit = new AuditLog(hosted.audit);
  const rows = () =>
    db.query<{ at: number; user_id: number | null; action: string; target: string | null; detail: string | null; ip: string | null }, []>(
      "SELECT at, user_id, action, target, detail, ip FROM audit_log ORDER BY id",
    ).all();
  const run = (routes: Record<string, Handler>, seen: string[] = [], errors?: ErrorRing) => {
    const fetchFn = fakeFetch(routes, seen);
    return checkBnetCharacters({ db: counted, audit, app: new BnetAppToken(CFG, fetchFn), fetchFn, now: NOW, errors });
  };
  return { hosted, users, rows, run, writes: () => writes };
}

describe("constants", () => {
  test("six hours, 25 days, 30 days", () => {
    expect(BNET_CHECK_INTERVAL_MS).toBe(6 * 3600_000);
    expect(BNET_CHECK_AFTER_MS).toBe(25 * DAY);
    expect(BNET_MAX_AGE_MS).toBe(30 * DAY);
  });
});

describe("checkBnetCharacters", () => {
  test("nothing due at 24 days: no Blizzard call, no write", async () => {
    const list = [bnetChar("Biwaasham", 1, 24)];
    const { hosted, users, run, rows, writes } = setup([list]);
    const seen: string[] = [];
    expect(await run({}, seen)).toEqual({ checked: 0, kept: 0, removed: 0, failed: 0 });
    expect(seen).toEqual([]);
    expect(writes()).toBe(0);
    expect(hosted.settings.get(users[0]!.id).characters).toEqual(list);
    expect(rows()).toEqual([]);
  });

  test("valid: verifiedAt becomes now; order and non-due entries untouched", async () => {
    const fresh = bnetChar("Noshiidk", 2, 3);
    const manual: MyCharacter = { name: "Muleyoxo", realm: "hyjal", region: "eu", source: "manual" };
    const { hosted, users, run, rows, writes } = setup([[fresh, bnetChar("Biwaasham", 1, 26), manual]]);
    const seen: string[] = [];
    expect(await run({ ...token, [statusUrl("Biwaasham")]: valid(1) }, seen)).toEqual({ checked: 1, kept: 1, removed: 0, failed: 0 });
    expect(seen).toEqual([BNET_TOKEN_URL, statusUrl("Biwaasham")]);
    expect(hosted.settings.get(users[0]!.id).characters).toEqual([fresh, { ...bnetChar("Biwaasham", 1, 0) }, manual]);
    expect(writes()).toBe(1);
    expect(rows()).toEqual([]);
    expect(hosted.bnet.link.get(users[0]!.id)!.removed).toEqual([]);
  });

  test("404, is_valid false and another id: removed with the reason, labels and audit rows, one write", async () => {
    const keep = bnetChar("Keeper", 9, 26);
    const { hosted, users, run, rows, writes } = setup([[
      bnetChar("Gone", 1, 26), keep, bnetChar("Invalid", 2, 27), bnetChar("Other", 3, 28),
    ]]);
    const uid = users[0]!.id;
    const r = await run({
      ...token,
      [statusUrl("Gone")]: () => new Response("", { status: 404 }),
      [statusUrl("Keeper")]: valid(9),
      [statusUrl("Invalid")]: () => Response.json({ id: 2, is_valid: false }),
      [statusUrl("Other")]: valid(333),
    });
    expect(r).toEqual({ checked: 4, kept: 1, removed: 3, failed: 0 });
    expect(hosted.settings.get(uid).characters).toEqual([{ ...keep, verifiedAt: NOW }]);
    expect(writes()).toBe(1);
    expect(hosted.bnet.link.get(uid)!.removed).toEqual(["Gone-hyjal", "Invalid-hyjal", "Other-hyjal"]);
    expect(rows()).toEqual([
      { at: NOW, user_id: uid, action: "bnet_character_removed", target: `user ${uid}`, detail: JSON.stringify({ reason: "not_found" }), ip: null },
      { at: NOW, user_id: uid, action: "bnet_character_removed", target: `user ${uid}`, detail: JSON.stringify({ reason: "invalid" }), ip: null },
      { at: NOW, user_id: uid, action: "bnet_character_removed", target: `user ${uid}`, detail: JSON.stringify({ reason: "other_id" }), ip: null },
    ]);
  });

  test("a network error at 26 days keeps the entry unchanged", async () => {
    const list = [bnetChar("Biwaasham", 1, 26)];
    const { hosted, users, run, rows, writes } = setup([list]);
    expect(await run({ ...token, [statusUrl("Biwaasham")]: down })).toEqual({ checked: 1, kept: 0, removed: 0, failed: 1 });
    expect(hosted.settings.get(users[0]!.id).characters).toEqual(list);
    expect(writes()).toBe(0);
    expect(rows()).toEqual([]);
  });

  test("a 503 at 31 days removes it with unchecked_30d", async () => {
    const { hosted, users, run, rows } = setup([[bnetChar("Biwaasham", 1, 31), bnetChar("Noshiidk", 2, 26)]]);
    const uid = users[0]!.id;
    const r = await run({ ...token, [statusUrl("Biwaasham")]: () => new Response("", { status: 503 }), [statusUrl("Noshiidk")]: down });
    expect(r).toEqual({ checked: 2, kept: 0, removed: 1, failed: 1 });
    expect(hosted.settings.get(uid).characters).toEqual([bnetChar("Noshiidk", 2, 26)]);
    expect(hosted.bnet.link.get(uid)!.removed).toEqual(["Biwaasham-hyjal"]);
    expect(rows().map((x) => x.detail)).toEqual([JSON.stringify({ reason: "unchecked_30d" })]);
  });

  test("a token failure ends the round: entries kept, except the ones past 30 days", async () => {
    const { hosted, users, run, rows } = setup([
      [bnetChar("Biwaasham", 1, 26), bnetChar("Stale", 2, 31)],
      [bnetChar("Noshiidk", 3, 40)],
    ]);
    const seen: string[] = [];
    const errors = new ErrorRing();
    const r = await run({ [BNET_TOKEN_URL]: () => new Response("", { status: 503 }) }, seen, errors);
    expect(r).toEqual({ checked: 3, kept: 0, removed: 2, failed: 1 });
    expect(seen).toEqual([BNET_TOKEN_URL]);
    const logged = errors.list({ since: null, limit: 10 });
    expect(logged.map((e) => e.message)).toEqual(["application token failed: Battle.net token endpoint answered 503 (client credentials)"]);
    expect(logged[0]!.message).not.toContain("bnet-sekrit");
    expect(hosted.settings.get(users[0]!.id).characters).toEqual([bnetChar("Biwaasham", 1, 26)]);
    expect(hosted.settings.get(users[1]!.id).characters).toEqual([]);
    expect(hosted.bnet.link.get(users[0]!.id)!.removed).toEqual(["Stale-hyjal"]);
    expect(hosted.bnet.link.get(users[1]!.id)!.removed).toEqual(["Noshiidk-hyjal"]);
    expect(rows().map((x) => [x.user_id, x.detail])).toEqual([
      [users[0]!.id, JSON.stringify({ reason: "unchecked_30d" })],
      [users[1]!.id, JSON.stringify({ reason: "unchecked_30d" })],
    ]);
  });

  test("labels are appended to the ones already shown", async () => {
    const { hosted, users, run } = setup([[bnetChar("Gone", 1, 26)]]);
    hosted.bnet.removed.add(users[0]!.id, ["Earlier-hyjal"]);
    await run({ ...token, [statusUrl("Gone")]: () => new Response("", { status: 404 }) });
    expect(hosted.bnet.link.get(users[0]!.id)!.removed).toEqual(["Earlier-hyjal", "Gone-hyjal"]);
  });

  test("a change made by the member during the round is not overwritten", async () => {
    const { hosted, users, run } = setup([[bnetChar("Biwaasham", 1, 26), bnetChar("Noshiidk", 2, 26)]]);
    const uid = users[0]!.id;
    const r = await run({
      ...token,
      // The member removes Noshiidk while Blizzard answers.
      [statusUrl("Biwaasham")]: () => {
        hosted.settings.update(uid, { characters: [bnetChar("Biwaasham", 1, 26)] }, NOW);
        return Response.json({ id: 1, is_valid: true });
      },
      [statusUrl("Noshiidk")]: () => new Response("", { status: 404 }),
    });
    expect(r.checked).toBe(2);
    expect(hosted.settings.get(uid).characters).toEqual([bnetChar("Biwaasham", 1, 0)]);
    // Already gone from the list: nothing to announce.
    expect(hosted.bnet.link.get(uid)!.removed).toEqual([]);
  });

  test("never throws: an unexpected error goes to the error ring", async () => {
    const { hosted } = setup([]);
    const errors = new ErrorRing();
    const broken: HostedDb = { ...hosted, bnet: { ...hosted.bnet, withBnetCharacters: () => { throw new Error("db closed"); } } };
    const fetchFn = fakeFetch({});
    const r = await checkBnetCharacters({ db: broken, audit: new AuditLog(hosted.audit), app: new BnetAppToken(CFG, fetchFn), fetchFn, now: NOW, errors });
    expect(r).toEqual({ checked: 0, kept: 0, removed: 0, failed: 0 });
    expect(errors.list({ since: null, limit: 10 }).map((e) => [e.target, e.message])).toEqual([["bnet check", "db closed"]]);
  });

  test("one member's failure does not stop the others", async () => {
    const { hosted, users } = setup([[bnetChar("Gone", 1, 26)], [bnetChar("Other", 2, 26)]]);
    const errors = new ErrorRing();
    const failFirst: HostedDb = {
      ...hosted,
      settings: {
        ...hosted.settings,
        update: (id, patch, now) => { if (id === users[0]!.id) throw new Error("disk full"); return hosted.settings.update(id, patch, now); },
      },
    };
    const fetchFn = fakeFetch({ ...token, [statusUrl("Gone")]: () => new Response("", { status: 404 }), [statusUrl("Other")]: valid(2) });
    const r = await checkBnetCharacters({ db: failFirst, audit: new AuditLog(hosted.audit), app: new BnetAppToken(CFG, fetchFn), fetchFn, now: NOW, errors });
    expect(r).toEqual({ checked: 2, kept: 1, removed: 0, failed: 1 });
    expect(hosted.settings.get(users[1]!.id).characters).toEqual([bnetChar("Other", 2, 0)]);
    expect(errors.list({ since: null, limit: 10 }).map((e) => e.message)).toEqual(["disk full"]);
  });
});
