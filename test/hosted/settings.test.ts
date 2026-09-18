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
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true });
    expect(DEFAULT_USER_SETTINGS).toEqual({ yourKey: null, legendOpen: true });
  });

  test("update merges a partial patch and returns the whole row; users are independent", () => {
    const { s, ua, ub, db } = setup();
    expect(s.update(ua.id, { yourKey: 18 }, 1000)).toEqual({ yourKey: 18, legendOpen: true });
    expect(s.update(ua.id, { legendOpen: false }, 2000)).toEqual({ yourKey: 18, legendOpen: false });
    expect(s.update(ua.id, { yourKey: null }, 3000)).toEqual({ yourKey: null, legendOpen: false });
    expect(s.get(ub.id)).toEqual({ yourKey: null, legendOpen: true });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 3000 });
  });

  test("deleting the user cascades", () => {
    const { s, ua, db } = setup();
    s.update(ua.id, { yourKey: 20 }, 1);
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 });
  });
});
