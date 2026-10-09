// Feature-usage counters (spec 2026-10-09-feature-usage-dashboard-design.md): the repo and the catalogue.
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openHosted } from "../../src/hosted/db.ts";
import type { HostedDb, UserRow } from "../../src/hosted/db.ts";
import { DAY_MS, USAGE_CATALOG, USAGE_EVENTS, dayStart, isUiEvent } from "../../src/hosted/usage-catalog.ts";
import { parseUsageQuery } from "../../src/hosted/usage-events.ts";

// 2026-10-09 12:00 UTC.
const NOW = Date.UTC(2026, 9, 9, 12);
let db: HostedDb;
let tom: UserRow;
let bob: UserRow;
let boss: UserRow;
const mk = (discordId: string, username: string, role: "member" | "admin" = "member") =>
  db.users.upsertFromDiscord({ discordId, username, globalName: null, avatarHash: null }, role, NOW);
const report = (o: Partial<{ days: 7 | 30 | 90; includeAdmins: boolean; withTop: boolean }> = {}) =>
  db.features.report({ now: NOW, days: o.days ?? 30, includeAdmins: o.includeAdmins ?? false, withTop: o.withTop ?? true });
const feat = (r: ReturnType<typeof report>, event: string) => r.features.find((f) => f.event === event)!;

beforeEach(() => {
  db = openHosted(new Database(":memory:"));
  tom = mk("100000000000000001", "tom");
  bob = mk("100000000000000002", "bob");
  boss = mk("100000000000000003", "boss", "admin");
});

describe("catalogue", () => {
  test("every entry has a known category and source; ui names are exactly the ui entries", () => {
    for (const e of USAGE_EVENTS) expect(["api", "ui"]).toContain(USAGE_CATALOG[e].source);
    expect(isUiEvent("axis_expand")).toBe(true);
    expect(isUiEvent("lookup")).toBe(false); // an api event is never accepted from the front
    expect(isUiEvent("toString")).toBe(false);
    expect(isUiEvent("nope")).toBe(false);
  });
  test("dayStart is UTC midnight", () => {
    expect(dayStart(NOW)).toBe(Date.UTC(2026, 9, 9));
    expect(dayStart(Date.UTC(2026, 9, 9, 23, 59))).toBe(Date.UTC(2026, 9, 9));
  });
});

describe("usage_events repo", () => {
  test("adds up per member and day, keeps the last time", () => {
    db.features.add(tom.id, "lookup", NOW - 3_600_000);
    db.features.add(tom.id, "lookup", NOW, 2);
    db.features.add(bob.id, "lookup", NOW - DAY_MS);
    const r = report();
    const f = feat(r, "lookup");
    expect(f).toMatchObject({ uses: 4, users: 2, lastAt: NOW, category: "lookup", source: "api" });
    expect(f.daily).toHaveLength(30);
    expect(f.daily[29]).toBe(3);
    expect(f.daily[28]).toBe(1);
    expect(f.top.map((t) => [t.username, t.uses])).toEqual([["tom", 3], ["bob", 1]]);
    expect(r.active).toEqual({ today: 1, d7: 2, d30: 2, period: 2 });
    expect(r.dailyActive[29]).toBe(1);
    expect(f.share).toBe(1);
  });
  test("every catalogue entry is listed, unused ones with zeros, most members first", () => {
    db.features.add(tom.id, "axis_expand", NOW);
    db.features.add(bob.id, "lookup", NOW);
    db.features.add(tom.id, "lookup", NOW);
    const r = report();
    expect(r.features).toHaveLength(USAGE_EVENTS.length);
    expect(r.features[0]!.event).toBe("lookup");
    expect(feat(r, "compare_open")).toMatchObject({ uses: 0, users: 0, share: 0, lastAt: null, top: [] });
    expect(feat(r, "compare_open").daily.every((n) => n === 0)).toBe(true);
  });
  test("admins are left out unless asked for; members counts non-banned accounts", () => {
    db.features.add(boss.id, "page_admin", NOW);
    db.features.add(tom.id, "lookup", NOW);
    expect(feat(report(), "page_admin").uses).toBe(0);
    expect(report().members).toBe(2);
    expect(feat(report({ includeAdmins: true }), "page_admin").uses).toBe(1);
    expect(report({ includeAdmins: true }).members).toBe(3);
    db.users.ban(bob.id, boss.id, NOW);
    expect(report().members).toBe(1);
  });
  test("the period bounds the rows; ops reports carry no top", () => {
    db.features.add(tom.id, "lookup", NOW - 10 * DAY_MS);
    expect(feat(report({ days: 7 }), "lookup").uses).toBe(0);
    expect(feat(report({ days: 30 }), "lookup").uses).toBe(1);
    expect(feat(report({ withTop: false }), "lookup").top).toEqual([]);
  });
  test("purgeBefore drops whole days before the cut; account deletion cascades", () => {
    db.features.add(tom.id, "lookup", NOW - 100 * DAY_MS);
    db.features.add(tom.id, "lookup", NOW);
    db.features.add(bob.id, "lookup", NOW);
    expect(db.features.purgeBefore(NOW - 89 * DAY_MS)).toBe(1);
    expect(feat(report({ days: 90 }), "lookup").uses).toBe(2);
    db.users.delete(tom.id);
    expect(feat(report({ days: 90 }), "lookup")).toMatchObject({ uses: 1, users: 1 });
  });
});

describe("parseUsageQuery", () => {
  const q = (s: string) => parseUsageQuery(new URLSearchParams(s));
  test("defaults and accepted values", () => {
    expect(q("")).toEqual({ ok: true, days: 30, includeAdmins: false });
    expect(q("days=7&admins=1")).toEqual({ ok: true, days: 7, includeAdmins: true });
  });
  test("rejects other periods and flags", () => {
    expect(q("days=14").ok).toBe(false);
    expect(q("days=abc").ok).toBe(false);
    expect(q("admins=yes").ok).toBe(false);
  });
});
