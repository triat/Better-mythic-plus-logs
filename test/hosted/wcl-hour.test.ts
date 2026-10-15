import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { HOUR_MS, openHosted } from "../../src/hosted/db.ts";
import { wclHourFields } from "../../src/hosted/runtime.ts";

test("wcl_hour: the hour's shared and own points, members who spent any, the limit", () => {
  const db = openHosted(new Database(":memory:"));
  const start = Date.parse("2026-10-15T13:00:00Z");
  const ids = [1, 2, 3].map((n) => db.users.upsertFromDiscord({ discordId: `10000000000000000${n}`, username: `u${n}`, globalName: null, avatarHash: null }, null, start).id);
  db.usage.add(ids[0]!, start + 60_000, 12.25);
  db.usage.add(ids[1]!, start + 120_000, 3);
  db.usageOwn.add(ids[2]!, start + 60_000, 40);
  db.usage.add(ids[0]!, start + HOUR_MS, 99); // the next hour: not counted
  expect(wclHourFields(db, start, 3600)).toEqual({ hour: "2026-10-15T13:00:00.000Z", shared_points: 15.3, own_points: 40, members: 3, limit: 3600 });
  expect(wclHourFields(db, start - HOUR_MS, null)).toEqual({ hour: "2026-10-15T12:00:00.000Z", shared_points: 0, own_points: 0, members: 0, limit: null });
});
