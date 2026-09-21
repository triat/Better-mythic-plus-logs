import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DEFAULT_USER_SETTINGS, openHosted } from "../../src/hosted/db.ts";

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
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true, region: null });
    expect(DEFAULT_USER_SETTINGS).toEqual({ yourKey: null, legendOpen: true, region: null });
  });

  test("update merges a partial patch and returns the whole row; users are independent", () => {
    const { s, ua, ub, db } = setup();
    expect(s.update(ua.id, { yourKey: 18 }, 1000)).toEqual({ yourKey: 18, legendOpen: true, region: null });
    expect(s.update(ua.id, { legendOpen: false }, 2000)).toEqual({ yourKey: 18, legendOpen: false, region: null });
    expect(s.update(ua.id, { yourKey: null }, 3000)).toEqual({ yourKey: null, legendOpen: false, region: null });
    expect(s.get(ub.id)).toEqual({ yourKey: null, legendOpen: true, region: null });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 3000 });
  });

  test("region is stored and read back; an unrecognised value read from the row falls back to null", () => {
    const { s, ua, db } = setup();
    expect(s.update(ua.id, { region: "kr" }, 1000)).toEqual({ yourKey: null, legendOpen: true, region: "kr" });
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true, region: "kr" });
    expect(s.update(ua.id, { region: null }, 2000)).toEqual({ yourKey: null, legendOpen: true, region: null });
    db.run("UPDATE user_settings SET region = ? WHERE user_id = ?", ["cn", ua.id]);
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true, region: null });
  });

  test("deleting the user cascades", () => {
    const { s, ua, db } = setup();
    s.update(ua.id, { yourKey: 20 }, 1);
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 });
  });
});
