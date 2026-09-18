import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { HOUR_MS, hourStart, openHosted } from "../../src/hosted/db.ts";
import { POINTS_FLOOR, QuotaGate, resetInS } from "../../src/hosted/quota.ts";
import { PointsMeter } from "../../src/wcl/meter.ts";

const T0 = 1_700_000_000_000; // some epoch ms
const rl = (spent: number, resetIn = 1800) => ({ limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: resetIn });

function setup(limit = 300) {
  let t = hourStart(T0) + 600_000; // ten minutes into a bucket
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const member = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "m", globalName: null, avatarHash: null }, "member", 0);
  const admin = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "a", globalName: null, avatarHash: null }, "admin", 0);
  const meter = new PointsMeter({ usage: hosted.usage, now: () => t });
  const gate = new QuotaGate({ usage: hosted.usage, meter, limit, now: () => t });
  return { db, hosted, meter, gate, member, admin, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe("usage repository", () => {
  test("hourStart/resetInS are calendar-hour buckets", () => {
    expect(hourStart(T0)).toBe(Math.floor(T0 / HOUR_MS) * HOUR_MS);
    expect(resetInS(hourStart(T0))).toBe(3600);
    expect(resetInS(hourStart(T0) + HOUR_MS - 1)).toBe(1);
  });
  test("add upserts into the bucket; used/byUser/totals read it back", () => {
    const { hosted, member, admin, now } = setup();
    hosted.usage.add(member.id, now(), 10);
    hosted.usage.add(member.id, now() + 1000, 2.5);
    hosted.usage.add(admin.id, now(), 1);
    hosted.usage.add(member.id, now() - HOUR_MS, 40); // previous bucket
    expect(hosted.usage.used(member.id, now())).toBe(12.5);
    expect(hosted.usage.used(member.id, now() + HOUR_MS)).toBe(0);
    expect(hosted.usage.byUser(now())).toEqual([{ userId: member.id, points: 12.5 }, { userId: admin.id, points: 1 }]);
    expect(hosted.usage.totals(now() - 2 * HOUR_MS)).toEqual([{ hourStart: hourStart(now()) - HOUR_MS, points: 40 }, { hourStart: hourStart(now()), points: 13.5 }]);
  });
  test("deleting the user cascades", () => {
    const { db, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 5);
    db.run("DELETE FROM users WHERE id = ?", [member.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM usage_hourly").get()).toEqual({ n: 0 });
  });
});

describe("QuotaGate", () => {
  test("under the limit: go ahead; status reports used/limit/resetInS", () => {
    const { gate, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 100);
    expect(gate.reserve(member, 10)).toBeNull();
    expect(gate.status(member)).toEqual({ used: 100, limit: 300, resetInS: resetInS(now()) });
  });
  test("refuses with the quota payload when used + estimate exceeds the limit; nothing is written", () => {
    const { gate, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 295);
    expect(gate.reserve(member, 5)).toBeNull();
    const r = gate.reserve(member, 6)!;
    expect(r).toEqual({ error: "quota", message: r.message, used: 295, limit: 300, resetInS: resetInS(now()) });
    expect(r.message).toBe("Hourly quota reached (295/300 pts) — resets in 50 min");
    expect(hosted.usage.used(member.id, now())).toBe(295);
  });
  test("admins have no quota", () => {
    const { gate, hosted, admin, now } = setup();
    hosted.usage.add(admin.id, now(), 5000);
    expect(gate.reserve(admin, 100)).toBeNull();
    expect(gate.status(admin)).toEqual({ used: 5000, limit: null, resetInS: resetInS(now()) });
  });
  test("the quota resets with the calendar hour", () => {
    const { gate, hosted, member, now, tick } = setup();
    hosted.usage.add(member.id, now(), 300);
    expect(gate.reserve(member, 1)?.error).toBe("quota");
    tick(HOUR_MS);
    expect(gate.reserve(member, 1)).toBeNull();
    expect(gate.status(member).used).toBe(0);
  });
  test("the shared floor refuses everyone, admins included, while the meter's window is current", () => {
    const { gate, meter, member, admin, now } = setup();
    meter.observe(rl(3600 - POINTS_FLOOR - 5, 900));
    expect(gate.reserve(member, 5)).toBeNull();
    const r = gate.reserve(member, 6)!;
    expect(r.error).toBe("budget");
    expect(r).toEqual({ error: "budget", message: "The shared WCL budget is nearly exhausted (105 pts left) — resets in 15 min", used: 3495, limit: 3600, resetInS: 900 });
    expect(gate.reserve(admin, 6)?.error).toBe("budget");
    expect(now()).toBeGreaterThan(0);
  });
  test("an expired snapshot never refuses; a quota refusal wins over the floor", () => {
    const { gate, meter, hosted, member, tick, now } = setup();
    meter.observe(rl(3590, 60));
    tick(61_000);
    expect(gate.reserve(member, 50)).toBeNull();
    meter.observe(rl(3590, 3000));
    hosted.usage.add(member.id, now(), 300);
    expect(gate.reserve(member, 50)?.error).toBe("quota");
  });
  test("for(user) binds a Reserve", () => {
    const { gate, hosted, member, now } = setup(20);
    const reserve = gate.for(member);
    expect(reserve(20)).toBeNull();
    hosted.usage.add(member.id, now(), 15);
    expect(reserve(6)?.error).toBe("quota");
  });
});
