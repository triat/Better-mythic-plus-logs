// The admin's searched characters: assembled from character_runs, rio_profile and user_history, 0 WCL pts.
import { describe, expect, test } from "bun:test";
import { searchedCharacters } from "../../src/hosted/characters.ts";
import { openHosted } from "../../src/hosted/db.ts";
import { openStore } from "../../src/signals/store.ts";

function setup() {
  const store = openStore(":memory:");
  const db = store._db;
  const hosted = openHosted(db);
  const a = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, "member", 0);
  const b = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, "member", 0);
  const hist = (user: number, key: string, name: string, realm: string, label: string, spec: string, verdict: string | null, score: number | null, level: number, at: number) =>
    db.run(
      "INSERT INTO user_history (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq, verdict, score) VALUES (?, ?, '{}', ?, ?, 7, ?, ?, 0, ?, ?, ?, ?)",
      [user, key, JSON.stringify({ character: { name, realmSlug: realm, region: "eu" } }), label, spec, level, at, at, verdict, score],
    );
  const run = (name: string, zone: number, level: number, timed: number | null, dungeon: string, start: number) =>
    db.run(
      "INSERT INTO character_runs (region, realm, name, report_code, fight_id, zone_id, encounter_id, encounter_name, start_time, duration_ms, key_level, timed, metric, parse, amount, spec, score, affixes, discovered_at, seen_at) " +
      "VALUES ('eu', 'ysondre', ?, ?, 1, ?, 1, ?, ?, 1, ?, ?, 'dps', 50, 1, 'Elemental', 1, '[]', ?, ?)",
      [name, `r${start}`, zone, dungeon, start, level, timed, start, start],
    );
  return { store, db, a: a.id, b: b.id, hist, run };
}

describe("searchedCharacters", () => {
  test("merges runs, Raider.IO and the newest history verdict; members are counted, not named", () => {
    const { store, a, b, hist, run } = setup();
    run("vachaman", 44, 16, 1, "Old", 1);
    run("vachaman", 45, 15, 1, "Priory", 10);
    run("vachaman", 45, 17, 0, "Breach", 11);
    run("vachaman", 45, 14, 1, "Ara-Kara", 12);
    hist(a, "k1", "Vachaman", "ysondre", "Vachâman-Ysondre", "Elemental", "maybe", 55, 15, 100);
    hist(b, "k2", "Vachaman", "ysondre", "Vachâman-Ysondre", "Elemental", "invite", 78, 16, 200);
    store.putRio("eu", "ysondre", "vachaman", { name: "Vachâman", realm: "Ysondre", class: "Shaman", active_spec_name: "Elemental", active_spec_role: "DPS", mythic_plus_scores_by_season: [{ scores: { all: 3412.4 } }] }, 150);
    run("lonely", 45, 12, null, "Breach", 5);
    const [v, l] = searchedCharacters(store._db);
    expect(v).toMatchObject({
      displayName: "Vachâman", displayRealm: "Ysondre", classId: 7, className: "Shaman", spec: "Elemental", role: "dps",
      verdict: "invite", score: 78, targetLevel: 16, members: 2, lookedUpAt: 200, rio: 3412, bestTimed: 15, bestDungeon: "Priory", runs: 3,
    });
    expect(l).toMatchObject({ name: "lonely", verdict: null, members: 0, bestTimed: null, bestDungeon: null, runs: 1, lookedUpAt: 5, role: null });
    expect(JSON.stringify(searchedCharacters(store._db))).not.toContain("100000000000000001");
  });
  test("a healer or tank spec gives its role; Raider.IO fills spec and role only without history", () => {
    const { store, a, hist } = setup();
    hist(a, "k", "Lumiel", "archimonde", "Lumiel-Archimonde", "Discipline", "invite", 81, 15, 10);
    store.putRio("eu", "hyjal", "kess", { name: "Kess", realm: "Hyjal", class: "Death Knight", active_spec_name: "Blood", active_spec_role: "TANK" }, 20);
    const list = searchedCharacters(store._db);
    expect(list.map((c) => [c.name, c.role, c.lookedUpAt])).toEqual([["kess", "tank", 20], ["lumiel", "healer", 10]]);
  });
  test("an accented capital joins its Raider.IO row (SQLite's lower() would not fold it)", () => {
    const { store, a, hist } = setup();
    hist(a, "k", "Élwyn", "hyjal", "Élwyn-Hyjal", "Frost", "pass", 20, 14, 10);
    store.putRio("eu", "hyjal", "élwyn", { name: "Élwyn", realm: "Hyjal", class: "Mage", mythic_plus_scores_by_season: [{ scores: { all: 2900 } }] }, 5);
    expect(searchedCharacters(store._db).map((c) => [c.name, c.verdict, c.rio])).toEqual([["élwyn", "pass", 2900]]);
  });
});
