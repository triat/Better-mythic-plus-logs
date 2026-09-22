import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DEFAULT_USER_SETTINGS, openHosted } from "../../src/hosted/db.ts";
import { SETTINGS_BODY } from "../../src/server/validate.ts";

function setup() {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const ua = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, null, 0);
  const ub = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, null, 0);
  return { db, s: hosted.settings, ua, ub };
}

describe("user settings repository", () => {
  test("defaults before any write", () => {
    const { s, ua } = setup();
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true, region: null, locale: null, liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [] });
    expect(DEFAULT_USER_SETTINGS).toEqual({ yourKey: null, legendOpen: true, region: null, locale: null, liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [] });
  });

  test("update merges a partial patch and returns the whole row; users are independent", () => {
    const { s, ua, ub, db } = setup();
    expect(s.update(ua.id, { yourKey: 18 }, 1000)).toMatchObject({ yourKey: 18, legendOpen: true, region: null, locale: null });
    expect(s.update(ua.id, { legendOpen: false }, 2000)).toMatchObject({ yourKey: 18, legendOpen: false, region: null, locale: null });
    expect(s.update(ua.id, { yourKey: null }, 3000)).toMatchObject({ yourKey: null, legendOpen: false, region: null, locale: null });
    expect(s.get(ub.id)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 3000 });
  });

  test("region is stored and read back; an unrecognised value read from the row falls back to null", () => {
    const { s, ua, db } = setup();
    expect(s.update(ua.id, { region: "kr" }, 1000)).toMatchObject({ yourKey: null, legendOpen: true, region: "kr", locale: null });
    expect(s.get(ua.id)).toMatchObject({ yourKey: null, legendOpen: true, region: "kr", locale: null });
    expect(s.update(ua.id, { region: null }, 2000)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
    db.run("UPDATE user_settings SET region = ? WHERE user_id = ?", ["cn", ua.id]);
    expect(s.get(ua.id)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
  });

  test("locale is stored and read back; an unrecognised value read from the row falls back to null", () => {
    const { s, ua, ub, db } = setup();
    expect(s.update(ua.id, { locale: "fr" }, 1000)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: "fr" });
    expect(s.get(ua.id)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: "fr" });
    expect(s.update(ua.id, { locale: null }, 2000)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
    expect(s.get(ub.id).locale).toBeNull();
    db.run("UPDATE user_settings SET locale = ? WHERE user_id = ?", ["de", ua.id]);
    expect(s.get(ua.id)).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
  });

  test("deleting the user cascades", () => {
    const { s, ua, db } = setup();
    s.update(ua.id, { yourKey: 20 }, 1);
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 });
  });

  test("live settings persist per user and reject bad values", () => {
    const { s, ua } = setup();
    s.update(ua.id, { liveSort: "score", liveRoles: ["dps"], liveClasses: ["Mage", "Druid"] }, 1_000);
    expect(s.get(ua.id)).toMatchObject({ liveSort: "score", liveRoles: ["dps"], liveClasses: ["Mage", "Druid"] });

    expect(SETTINGS_BODY.parse({ liveSort: "nope" }, "").ok).toBe(false);
    expect(SETTINGS_BODY.parse({ liveRoles: ["tank", "wizard"] }, "").ok).toBe(false);
    expect(SETTINGS_BODY.parse({ liveSort: "role", liveRoles: [], liveClasses: [] }, "").ok).toBe(true);
  });
});
