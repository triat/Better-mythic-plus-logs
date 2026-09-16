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
    expect(js.exitCode).toBe(0);
    const ev = JSON.parse(js.stdout.toString());
    expect(ev.role).toBe("healer");
    expect(ev.axes.length).toBe(6);
  });
  test("missing file → exit 1 with a message", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", path.join(tmp, "nope.json")], { cwd: path.join(import.meta.dir, "..", "..") });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toMatch(/nope\.json/);
  });
  test("file is valid JSON but not a lookup payload → exit 1 with a message", async () => {
    const p = path.join(tmp, "not-a-payload.json");
    await Bun.write(p, JSON.stringify({ hello: "world" }));
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p], { cwd: path.join(import.meta.dir, "..", "..") });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toMatch(/not a bmpl lookup --json payload/);
  });
  test("file is not valid JSON at all → exit 1 with the same message", async () => {
    const p = path.join(tmp, "not-json.json");
    await Bun.write(p, "not json at all");
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p], { cwd: path.join(import.meta.dir, "..", "..") });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toMatch(/not a bmpl lookup --json payload/);
  });
});

describe("bmpl defensives", () => {
  const cwd = path.join(import.meta.dir, "..", "..");
  test("prints the effective table for a spec, with the override marked", async () => {
    const p = path.join(tmp, "defensives.json");
    await Bun.write(p, JSON.stringify({ "Paladin:Holy": [{ id: 498, cooldownS: 42 }] }));
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "Paladin", "Holy"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(proc.exitCode).toBe(0);
    const out = strip(proc.stdout.toString());
    expect(out).toContain("Paladin:Holy");
    expect(out).toMatch(/Divine Protection\s+major\s+cd\s+42s.*override/);
    expect(out).toMatch(/Divine Shield\s+immunity.*shipped/);
    const check = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "--check"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(check.exitCode).toBe(0);
    await Bun.write(p, "{ nope");
    const bad = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "--check"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(bad.exitCode).toBe(1);
  });
  test("analyze without credentials or without --run lists usage and exits non-zero on a bad target", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "analyze"], { cwd });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("Usage: bmpl analyze");
  });
  test("analyze --all --json without --yes refuses before any lookup (no network)", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "analyze", "Foo-Bar", "--all", "--json"], { cwd });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("--json needs --yes");
  });
});
