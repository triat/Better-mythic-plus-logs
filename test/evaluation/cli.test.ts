import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { fixturePayload } from "./helpers.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const tmp = path.join(import.meta.dir, "..", "..", ".superpowers-test-tmp");
mkdirSync(tmp, { recursive: true });

describe("bmpl evaluate <payload.json>", () => {
  test("prints the evaluation for a saved payload, --json emits the object", async () => {
    const p = path.join(tmp, "payload.json");
    await Bun.write(p, JSON.stringify(await fixturePayload("s2-healer", true)));
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p], { cwd: path.join(import.meta.dir, "..", ".."), env: { ...process.env, BMPL_EVAL_CONFIG: path.join(tmp, "none.json") } });
    expect(proc.exitCode).toBe(0);
    const out = strip(proc.stdout.toString());
    expect(out).toContain("INSUFFICIENT DATA (1 run");
    expect(out).toContain("Survival");
    const js = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p, "--json"], { cwd: path.join(import.meta.dir, "..", ".."), env: { ...process.env, BMPL_EVAL_CONFIG: path.join(tmp, "none.json") } });
    const ev = JSON.parse(js.stdout.toString());
    expect(ev.role).toBe("healer");
    expect(ev.axes.length).toBe(6);
  });
  test("missing file → exit 1 with a message", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", path.join(tmp, "nope.json")], { cwd: path.join(import.meta.dir, "..", "..") });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toMatch(/nope\.json/);
  });
});
