// `addon/bmpl/cadence.lua` decides when the strip is repainted — the rule that keeps it motionless
// while the roster is unchanged. It is pure Lua with no WoW API, so `luajit` can run it against
// `addon/bmpl/tests/cadence.lua` here; the harness prints "OK <n>" or the first failed assertion.
// Skipped where luajit is absent: it is a dev-machine tool, not a dependency of the product.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("addon cadence", () => {
  const luajit = Bun.which("luajit");
  test.skipIf(!luajit)("addon/bmpl/cadence.lua matches its harness (luajit)", () => {
    const run = Bun.spawnSync([luajit!, "addon/bmpl/tests/cadence.lua"]);
    const out = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(out.trim(), out).toStartWith("OK ");
    expect(run.exitCode).toBe(0);
  });

  // The two knobs the spec states in seconds. Read from the source rather than duplicated, so the
  // test fails when the file changes rather than quietly asserting yesterday's numbers.
  test("the cadence constants still match the spec", () => {
    const lua = readFileSync("addon/bmpl/cadence.lua", "utf8");
    expect(lua).toContain("Cadence.PASSES_AFTER_CHANGE = 3");
    expect(lua).toContain("Cadence.HEARTBEAT_S = 5");
  });

  // cadence.lua must load before main.lua, which reads ns.Cadence at file scope.
  test("bmpl.toc loads cadence.lua before main.lua", () => {
    const toc = readFileSync("addon/bmpl/bmpl.toc", "utf8").split("\n").map((l) => l.trim());
    expect(toc.indexOf("cadence.lua")).toBeGreaterThan(-1);
    expect(toc.indexOf("cadence.lua")).toBeLessThan(toc.indexOf("main.lua"));
  });
});
