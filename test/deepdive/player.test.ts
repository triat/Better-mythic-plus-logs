import { describe, expect, test } from "bun:test";
import { playerOf } from "../../src/deepdive/player.ts";
import { loadWclFixture } from "../fixtures.ts";

describe("playerOf", () => {
  test("resolves actor id, class and spec from the cached summary composition", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(playerOf(f.report, f.character)).toEqual({ actorID: 1, className: "Paladin", spec: "Holy" });
    expect(playerOf(f.report, "Nobody")).toBeNull();
    expect(playerOf({ code: "x" }, f.character)).toBeNull();
  });
});
