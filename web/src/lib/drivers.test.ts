import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { driverValues } from "./drivers.ts";

const tFr = makeT(fr, "fr");
const d = (source: string, value: number, reference: number) => ({ source, value, reference });

describe("driverValues", () => {
  test("a value with its unit and the average player's, short", () => {
    expect(driverValues(tEn, "en", d("survival.individualDeaths", 1.6, 0.7))).toEqual({ value: "1.6 / run", reference: "avg 0.7" });
    expect(driverValues(tEn, "en", d("survival.avoidableVsPeers", -29.4, -3.2))).toEqual({ value: "−29% vs peers", reference: "avg −3%" });
    expect(driverValues(tEn, "en", d("utility.kicksAbsolute", 1, 0.625)).value).toBe("100%");
  });
  test("kicksVsPeers reads in points, not percent (it's percentage points, not a percentage)", () => {
    expect(driverValues(tEn, "en", d("utility.kicksVsPeers", -1, 0.7))).toEqual({ value: "−1 pts vs peers", reference: "avg +1 pts" });
  });
  test("French: decimal comma", () => {
    expect(driverValues(tFr, "fr", d("survival.individualDeaths", 1.6, 0.7))).toEqual({ value: "1,6 / run", reference: "moy. 0,7" });
  });
});
