import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLocalHistory, openLocalHistory } from "../src/server/local-history.ts";
import { cacheKey } from "../src/server-history.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import type { Region } from "../src/wow/regions.ts";

// Local mode keeps its lookup tabs in bmpl.db (tables local_history / local_history_auto), so a
// `bmpl serve` restart — or the CLI opening the same db — sees them again. No WCL call anywhere here.
const req = (character: string, level: number | null = null) => ({ character, level, spec: null, metric: null, region: "eu" as Region });
const rec = { result: { any: "payload" }, label: "Muleyoxo-Silvermoon", charClass: 7, spec: "Holy", targetLevel: 21, targetAutoDetected: true };

let dir: string;
const saved = process.env.BMPL_DB_PATH;
const savedRegion = process.env.BMPL_REGION;
afterEach(() => {
  closeStore();
  if (saved === undefined) delete process.env.BMPL_DB_PATH; else process.env.BMPL_DB_PATH = saved;
  if (savedRegion === undefined) delete process.env.BMPL_REGION; else process.env.BMPL_REGION = savedRegion;
  rmSync(dir, { recursive: true, force: true });
});

describe("local history", () => {
  test("survives a store close/reopen (a server restart) and keeps the auto-level alias", async () => {
    dir = mkdtempSync(join(tmpdir(), "bmpl-lh-"));
    process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
    const h1 = await openLocalHistory();
    const e = h1.record(req("Muleyoxo-Silvermoon"), rec);
    h1.updateResult(e.key, { any: "updated" });
    expect(getLocalHistory().list().map((i) => i.label)).toEqual(["Muleyoxo-Silvermoon"]);

    closeStore();
    const h2 = await openLocalHistory();
    expect(h2.size).toBe(1);
    expect(h2.get(e.key)?.result).toEqual({ any: "updated" });
    // An auto request for the same character is still a cache hit after the restart.
    expect(h2.cached(req("Muleyoxo-Silvermoon"))?.key).toBe(e.key);
    expect(h2.remove(e.key)).toBe(true);
    expect(h2.size).toBe(0);
  });

  test("pre-region rows in bmpl.db are migrated to the instance region at open", async () => {
    dir = mkdtempSync(join(tmpdir(), "bmpl-lh-"));
    process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
    process.env.BMPL_REGION = "eu"; // the instance default the migration appends (bun test loads the real .env)
    const store = await getStore();
    store._db.run(
      "INSERT INTO local_history (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [0, JSON.stringify(["muleyoxo-silvermoon", 21, "", ""]), JSON.stringify({ character: "Muleyoxo-Silvermoon", level: null, spec: null, metric: null }), JSON.stringify(rec.result), rec.label, 7, "Holy", 21, 1, 500, 1],
    );
    store._db.run("INSERT INTO local_history_auto (user_id, alias_key, level, set_at) VALUES (?, ?, ?, ?)", [0, JSON.stringify(["muleyoxo-silvermoon", "auto", "", ""]), 21, 500]);

    const h = await openLocalHistory();
    const key = cacheKey(req("Muleyoxo-Silvermoon", 21));
    expect(h.get(key)?.request.region).toBe("eu");
    expect(h.cached(req("Muleyoxo-Silvermoon"))?.key).toBe(key);
  });
});
