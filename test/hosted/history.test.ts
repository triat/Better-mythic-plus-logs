import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../../src/hosted/db.ts";
import { HISTORY_MAX_PER_USER, SHARED_HISTORY_TTL_MS, openUserHistory } from "../../src/hosted/history.ts";
import { cacheKey } from "../../src/server-history.ts";
import type { HistoryRecord } from "../../src/server-history.ts";

const req = (character: string, level: number | null = null) => ({ character, level, spec: null, metric: null });
const entry = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  result: { any: "payload" },
  label: "Muleyoxo-Silvermoon",
  charClass: 7,
  spec: "Holy",
  targetLevel: 21,
  targetAutoDetected: true,
  ...over,
});

/** Fresh DB with users A and B; `max` caps entries per user, `now` is the clock of both stores. */
function setup(max = HISTORY_MAX_PER_USER, now: () => number = () => 1000, file = ":memory:") {
  const db = new Database(file);
  const hosted = openHosted(db);
  const ua = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, null, 0);
  const ub = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, null, 0);
  const repo = openUserHistory(db, max);
  return { db, hosted, a: repo.forUser(ua.id, now), b: repo.forUser(ub.id, now), ua, ub };
}

describe("SQLite history — same semantics as the in-memory History", () => {
  test("an auto lookup that resolves to +21 merges with an explicit +21 entry", () => {
    const { a: h } = setup();
    const explicit = h.record(req("Muleyoxo-Silvermoon", 21), entry({ targetAutoDetected: false }));
    const auto = h.record(req("Muleyoxo-Silvermoon", null), entry({ targetAutoDetected: true }));
    expect(auto.key).toBe(explicit.key);
    expect(h.size).toBe(1);
    expect(h.get(auto.key)!.targetAutoDetected).toBe(true); // newest wins
  });

  test("an auto request hits the cache once its effective level is known", () => {
    const { a: h } = setup();
    expect(h.cached(req("Muleyoxo-Silvermoon", null))).toBeNull();
    const e = h.record(req("Muleyoxo-Silvermoon", null), entry());
    expect(h.cached(req("Muleyoxo-Silvermoon", null))?.key).toBe(e.key);
    expect(h.cached(req("muleyoxo-silvermoon", 21))?.key).toBe(e.key);
    expect(h.cached(req("Muleyoxo-Silvermoon", 18))).toBeNull();
  });

  test("a cache hit moves the entry to the newest position", () => {
    const { a: h } = setup();
    h.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false }));
    h.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    h.cached(req("A-X", 18));
    expect(h.list().map((e) => e.label)).toEqual(["A-X", "B-X"]); // newest first
  });

  test("an auto re-evaluation that lands on a new level replaces the old auto entry, not an explicit one", () => {
    const { a: h } = setup();
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 20, targetAutoDetected: true }));
    h.record(req("Muleyoxo-Silvermoon", 18), entry({ targetLevel: 18, targetAutoDetected: false }));
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 21, targetAutoDetected: true }));
    expect(h.list().map((e) => [e.targetLevel, e.targetAutoDetected])).toEqual([[21, true], [18, false]]);
  });

  test("evicts the oldest past the cap; remove/clear also forget auto levels", () => {
    const { a: h } = setup(2);
    h.record(req("A-X", 18), entry({ label: "A-X" }));
    h.record(req("B-X", 18), entry({ label: "B-X" }));
    h.record(req("C-X", null), entry({ label: "C-X", targetLevel: 19 }));
    expect(h.list().map((e) => e.label)).toEqual(["C-X", "B-X"]);
    expect(h.remove(cacheKey(req("C-X", 19)))).toBe(true);
    expect(h.cached(req("C-X", null))).toBeNull();
    expect(h.remove("nope")).toBe(false);
    h.clear();
    expect(h.size).toBe(0);
  });

  test("updateResult replaces the payload in place and keeps the key", () => {
    const { a: h } = setup();
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, result: { v: 1 } }));
    h.updateResult(e.key, { v: 2 });
    expect(h.get(e.key)!.result).toEqual({ v: 2 });
    h.updateResult("nope", { v: 3 });
    expect(h.size).toBe(1);
  });

  test("list() carries the summary fields and the request but no payload; get() has the payload", () => {
    const { a: h } = setup(20, () => 4242);
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, targetAutoDetected: false, result: { v: 1 } }));
    const [item] = h.list();
    expect(item).toEqual({ key: e.key, request: req("A-B", 10), fetchedAt: 4242, label: "A-B", charClass: 7, spec: "Holy", targetLevel: 10, targetAutoDetected: false });
    expect("result" in item!).toBe(false);
    expect(h.get(e.key)).toEqual({ ...item!, result: { v: 1 } });
  });
});

describe("SQLite history — per user", () => {
  test("two users never see each other's entries (list/get/remove/clear)", () => {
    const { a, b } = setup();
    const ea = a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18 }));
    expect(b.list()).toEqual([]);
    expect(b.get(ea.key)).toBeUndefined();
    expect(b.remove(ea.key)).toBe(false);
    b.clear();
    expect(a.list().map((e) => e.key)).toEqual([ea.key]);
    b.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, result: { who: "b" } }));
    expect(a.get(ea.key)!.result).toEqual({ any: "payload" });
  });

  test("another user's fresh entry is a cache hit copied into the caller's history, a stale one is not", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    const ea = a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "a" } }));
    t += SHARED_HISTORY_TTL_MS - 1;
    const hit = b.cached(req("A-X", 18));
    expect(hit?.key).toBe(ea.key);
    expect(hit?.result).toEqual({ from: "a" });
    expect(hit?.fetchedAt).toBe(10_000); // the copy keeps the original fetch time
    expect(b.list().map((e) => e.key)).toEqual([ea.key]);
    expect(a.list().map((e) => e.key)).toEqual([ea.key]); // a's row untouched
    a.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    t += SHARED_HISTORY_TTL_MS + 1; // now the B-X row is exactly TTL + 1 old
    expect(b.cached(req("B-X", 18))).toBeNull();
    expect(b.list().length).toBe(1);
  });

  test("a shared copy reports whether the caller's own request was auto, not the other user's", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    a.record(req("A-X", null), entry({ label: "A-X", targetLevel: 20, targetAutoDetected: true }));
    t += 1;
    expect(b.cached(req("A-X", 20))?.targetAutoDetected).toBe(false);
    expect(b.get(cacheKey(req("A-X", 20)))?.targetAutoDetected).toBe(false);
  });

  test("an auto request follows the newest alias any user set within the window", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    a.record(req("A-X", null), entry({ label: "A-X", targetLevel: 20, targetAutoDetected: true }));
    t = 10_000 + SHARED_HISTORY_TTL_MS + 1;
    expect(b.cached(req("A-X", null))).toBeNull(); // too old to share
    t = 10_001;
    expect(b.cached(req("A-X", null))?.targetLevel).toBe(20); // shared through a's alias
    expect(b.cached(req("A-X", null))?.targetLevel).toBe(20); // now b's own hit
  });

  test("own entries win over a fresher shared one: sharing only fills a miss (the user can hit refresh)", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    b.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "b-old" } }));
    t += SHARED_HISTORY_TTL_MS * 2;
    a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "a-new" } }));
    expect(b.cached(req("A-X", 18))?.result).toEqual({ from: "b-old" });
  });

  test("history survives reopening the database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-uh-"));
    const file = join(dir, "bmpl.db");
    try {
      const first = setup(20, () => 1000, file);
      const e = first.a.record(req("A-X", null), entry({ label: "A-X", targetLevel: 18 }));
      first.db.close();
      const db = new Database(file);
      const hosted = openHosted(db);
      const again = hosted.history.forUser(first.ua.id, () => 2000);
      expect(again.list().map((x) => x.key)).toEqual([e.key]);
      expect(again.cached(req("A-X", null))?.key).toBe(e.key); // the auto alias survived too
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("openHosted exposes the repo and deleting a user cascades", () => {
    const { db, hosted, ua } = setup();
    const h = hosted.history.forUser(ua.id, () => 1000);
    h.record(req("A-X", null), entry({ label: "A-X", targetLevel: 18 }));
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_history").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM user_history_auto").get()).toEqual({ n: 0 });
  });
});
