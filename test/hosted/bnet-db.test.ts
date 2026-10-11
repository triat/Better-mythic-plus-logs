import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openHosted } from "../../src/hosted/db.ts";
import { BNET_IMPORT_TTL_MS, resetManualCharacters, type BnetCandidate } from "../../src/hosted/bnet-db.ts";
import type { MyCharacter } from "../../src/self/characters.ts";

function setup() {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const mk = (discordId: string) =>
    hosted.users.upsertFromDiscord({ discordId, username: "u" + discordId.slice(-2), globalName: null, avatarHash: null }, null, 0);
  const ua = mk("100000000000000001");
  const ub = mk("100000000000000002");
  return { db, hosted, bnet: hosted.bnet, ua, ub };
}

const cand = (bnetId: number, name: string): BnetCandidate =>
  ({ bnetId, name, realm: "hyjal", realmName: "Hyjal", region: "eu", level: 80, classID: 8 });
const manual = (name: string): MyCharacter => ({ name, realm: "hyjal", region: "eu", source: "manual" });
const bnetChar = (name: string, bnetId: number): MyCharacter =>
  ({ name, realm: "hyjal", region: "eu", source: "bnet", bnetId, verifiedAt: 1_760_000_000_000 });
const auditRows = (db: Database) =>
  db.query<{ at: number; user_id: number | null; action: string; target: string | null; detail: string | null; ip: string | null }, []>(
    "SELECT at, user_id, action, target, detail, ip FROM audit_log ORDER BY id",
  ).all();

describe("bnet link", () => {
  test("put with a different account unlinks the old one first: its import and bnet characters go, other settings stay", () => {
    const { hosted, bnet, ua } = setup();
    bnet.link.put(ua.id, "123", "Tom#1234", 1000);
    hosted.settings.update(ua.id, { characters: [bnetChar("Aelinora", 7), manual("Localone")], yourKey: 18 }, 1000);
    bnet.imports.put(ua.id, [cand(9, "Pebblet")], 1000);
    bnet.removed.add(ua.id, ["Gone-hyjal"]);
    bnet.link.put(ua.id, "456", "Tom#1234", 2000);
    expect(bnet.link.get(ua.id)).toEqual({ userId: ua.id, accountId: "456", battletag: "Tom#1234", linkedAt: 2000, removed: [] });
    expect(bnet.link.byAccount("123")).toBeNull();
    expect(bnet.imports.get(ua.id, 2000)).toBeNull();
    expect(hosted.settings.get(ua.id).characters).toEqual([manual("Localone")]);
    expect(hosted.settings.get(ua.id).yourKey).toBe(18);
  });
  test("put then get; byAccount finds the owner; one account per member", () => {
    const { bnet, ua, ub } = setup();
    expect(bnet.link.get(ua.id)).toBeNull();
    expect(bnet.link.byAccount("123")).toBeNull();
    bnet.link.put(ua.id, "123", "Tom#1234", 1000);
    expect(bnet.link.get(ua.id)).toEqual({ userId: ua.id, accountId: "123", battletag: "Tom#1234", linkedAt: 1000, removed: [] });
    expect(bnet.link.byAccount("123")).toBe(ua.id);
    // A new import by the same member refreshes the BattleTag.
    bnet.link.put(ua.id, "123", "Tom#5678", 2000);
    expect(bnet.link.get(ua.id)).toMatchObject({ accountId: "123", battletag: "Tom#5678" });
    // UNIQUE(account_id): the route checks byAccount first.
    expect(() => bnet.link.put(ub.id, "123", null, 3000)).toThrow();
    expect(bnet.link.get(ub.id)).toBeNull();
  });

  test("removed labels: add appends, clear empties", () => {
    const { bnet, ua } = setup();
    bnet.link.put(ua.id, "123", null, 1000);
    bnet.removed.add(ua.id, ["Biwaasham-hyjal"]);
    bnet.removed.add(ua.id, ["Noshiidk-argent-dawn", "Muleyoxo-silvermoon"]);
    expect(bnet.link.get(ua.id)!.removed).toEqual(["Biwaasham-hyjal", "Noshiidk-argent-dawn", "Muleyoxo-silvermoon"]);
    bnet.removed.clear(ua.id);
    expect(bnet.link.get(ua.id)!.removed).toEqual([]);
  });
});

describe("bnet imports", () => {
  test("put overwrites; get expires after the TTL and deletes the row", () => {
    const { db, bnet, ua } = setup();
    expect(bnet.imports.get(ua.id, 0)).toBeNull();
    bnet.imports.put(ua.id, [cand(1, "Biwaasham")], 1000);
    bnet.imports.put(ua.id, [cand(2, "Noshiidk"), cand(3, "Muleyoxo")], 2000);
    expect(bnet.imports.get(ua.id, 2000 + BNET_IMPORT_TTL_MS)).toEqual({ candidates: [cand(2, "Noshiidk"), cand(3, "Muleyoxo")], createdAt: 2000 });
    expect(bnet.imports.get(ua.id, 2001 + BNET_IMPORT_TTL_MS)).toBeNull();
    expect(db.query("SELECT COUNT(*) AS n FROM bnet_imports").get()).toEqual({ n: 0 });
  });

  test("delete removes the row", () => {
    const { bnet, ua } = setup();
    bnet.imports.put(ua.id, [cand(1, "Biwaasham")], 1000);
    bnet.imports.delete(ua.id);
    expect(bnet.imports.get(ua.id, 1000)).toBeNull();
  });
});

describe("unlink and withBnetCharacters", () => {
  test("unlink removes the link, the import and the bnet characters, and keeps every other setting", () => {
    const { db, hosted, bnet, ua } = setup();
    bnet.link.put(ua.id, "123", "Tom#1234", 1000);
    bnet.imports.put(ua.id, [cand(1, "Biwaasham")], 1000);
    hosted.settings.update(ua.id, { yourKey: 18, region: "us", characters: [bnetChar("Biwaasham", 1), manual("Noshiidk"), bnetChar("Muleyoxo", 3)] }, 1000);
    bnet.unlink(ua.id, 5000);
    expect(bnet.link.get(ua.id)).toBeNull();
    expect(bnet.imports.get(ua.id, 1000)).toBeNull();
    expect(hosted.settings.get(ua.id)).toMatchObject({ yourKey: 18, region: "us", characters: [manual("Noshiidk")] });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 5000 });
  });

  test("unlink without a settings row or a link is harmless", () => {
    const { bnet, hosted, ua } = setup();
    bnet.unlink(ua.id, 1000);
    expect(hosted.settings.get(ua.id).characters).toEqual([]);
  });

  test("withBnetCharacters lists every member whose list holds a bnet entry", () => {
    const { hosted, bnet, ua, ub } = setup();
    expect(bnet.withBnetCharacters()).toEqual([]);
    hosted.settings.update(ua.id, { characters: [bnetChar("Biwaasham", 1), bnetChar("Muleyoxo", 3)] }, 1000);
    hosted.settings.update(ub.id, { characters: [manual("Noshiidk")] }, 1000);
    expect(bnet.withBnetCharacters()).toEqual([{ userId: ua.id, characters: [bnetChar("Biwaasham", 1), bnetChar("Muleyoxo", 3)] }]);
  });
});

describe("resetManualCharacters (launch migration)", () => {
  test("removes manual entries, keeps bnet ones, one audit row per member touched; a second call is a no-op", () => {
    const { db, hosted, ua, ub } = setup();
    hosted.settings.update(ua.id, { characters: [manual("Biwaasham"), bnetChar("Muleyoxo", 3), manual("Noshiidk")] }, 1000);
    hosted.settings.update(ub.id, { characters: [bnetChar("Biwaasham", 1)] }, 1000);
    expect(resetManualCharacters(db, 5000)).toBe(1);
    expect(hosted.settings.get(ua.id).characters).toEqual([bnetChar("Muleyoxo", 3)]);
    expect(hosted.settings.get(ub.id).characters).toEqual([bnetChar("Biwaasham", 1)]);
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 5000 });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ub.id)).toEqual({ updated_at: 1000 });
    const rows = auditRows(db);
    expect(rows).toEqual([{ at: 5000, user_id: ua.id, action: "characters_reset", target: `user ${ua.id}`, detail: JSON.stringify({ removed: 2 }), ip: null }]);
    expect(JSON.parse(rows[0]!.detail!)).toEqual({ removed: 2 });

    expect(resetManualCharacters(db, 6000)).toBe(0);
    expect(auditRows(db)).toHaveLength(1);
    expect(hosted.settings.get(ua.id).characters).toEqual([bnetChar("Muleyoxo", 3)]);
  });

  test("runs at every openHosted: the first open of the release removes them, later opens change nothing", () => {
    const { db, hosted, ua } = setup();
    hosted.settings.update(ua.id, { characters: [manual("Biwaasham")] }, 1000);
    const again = openHosted(db);
    expect(again.settings.get(ua.id).characters).toEqual([]);
    expect(auditRows(db).map((r) => r.action)).toEqual(["characters_reset"]);
    openHosted(db);
    expect(auditRows(db)).toHaveLength(1);
  });
});

describe("account deletion", () => {
  test("deleting the user cascades the link and the import", () => {
    const { db, hosted, bnet, ua } = setup();
    bnet.link.put(ua.id, "123", "Tom#1234", 1000);
    bnet.imports.put(ua.id, [cand(1, "Biwaasham")], 1000);
    expect(hosted.users.delete(ua.id)).toBe(true);
    expect(db.query("SELECT COUNT(*) AS n FROM user_bnet").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM bnet_imports").get()).toEqual({ n: 0 });
  });
});
