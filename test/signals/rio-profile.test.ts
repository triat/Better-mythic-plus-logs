import { describe, expect, test } from "bun:test";
import { RIO_FIELDS, parseRioProfile, rioProfileUrl } from "../../src/signals/rio-profile.ts";
import { loadRioFixture } from "../fixtures.ts";

const NOW = Date.parse("2026-09-15T12:00:00Z");

describe("parseRioProfile", () => {
  test("identity and gear", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.fetchedAt).toBe(NOW);
    expect(p.lastCrawledAt).toBe(Date.parse("2026-09-13T11:02:49.000Z"));
    expect(p.profileUrl).toBe("https://raider.io/characters/eu/silvermoon/Muleyoxo");
    expect(p.itemLevel).toBe(322);
    expect(p.activeSpec).toBe("Holy");
    expect(p.activeRole).toBe("HEALING");
  });

  test("seasons keep Raider.IO order (current first)", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.seasons.map((s) => s.slug)).toEqual(["season-mn-2", "season-mn-1"]);
    expect(p.seasons[1]).toEqual({ slug: "season-mn-1", all: 4152.7, dps: 4152.7, healer: 3964.7, tank: 1406.3 });
  });

  test("runs are normalized", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.recentRuns.length).toBe(10);
    expect(p.bestRuns.length).toBe(8);
    expect(p.weeklyBest.length).toBe(10);
    const r = p.recentRuns[0]!;
    expect(r).toEqual({
      dungeon: "Voidscar Arena", shortName: "VSA", level: 21,
      completedAt: Date.parse("2026-09-14T18:33:32.000Z"),
      clearMs: 1796309, parMs: 1800999, chests: 1, score: 500.1,
      affixes: r.affixes, url: "https://raider.io/mythic-plus-runs/season-mn-2/12226069-21-voidscar-arena",
    });
    expect(r.affixes[0]).toBe("Tyrannical");
  });

  test("derived: timed ratio, activity", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.derived.recentTotal).toBe(10);
    expect(p.derived.recentTimed).toBe(9);
    expect(p.derived.runsLast7d).toBe(10);
    expect(p.derived.lastRunAt).toBe(Date.parse("2026-09-14T18:33:32.000Z"));
  });

  test("runsLast7d uses `now`", async () => {
    const p = parseRioProfile(await loadRioFixture(), Date.parse("2026-09-20T12:00:00Z"));
    expect(p.derived.runsLast7d).toBe(6); // only the 2026-09-14 runs
  });

  test("tolerates a profile with no runs and no seasons", () => {
    const p = parseRioProfile({ name: "X", profile_url: "u" }, NOW);
    expect(p.seasons).toEqual([]);
    expect(p.recentRuns).toEqual([]);
    expect(p.itemLevel).toBeNull();
    expect(p.derived).toEqual({ recentTimed: 0, recentTotal: 0, runsLast7d: 0, lastRunAt: null });
  });
});

describe("rioProfileUrl", () => {
  test("encodes name, lowercases region", () => {
    expect(rioProfileUrl("EU", "nerzhul", "Biwaadrood")).toBe(
      `https://raider.io/api/v1/characters/profile?region=eu&realm=nerzhul&name=Biwaadrood&fields=${RIO_FIELDS}`,
    );
    expect(rioProfileUrl("EU", "hyjal", "Zerøcool")).toContain("name=Zer%C3%B8cool");
  });
});
