import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/evaluation/config.ts";
import { EVALUATION_DOCS } from "../../src/evaluation/docs.ts";
import { AXIS_KEYS } from "../../src/evaluation/types.ts";

const nonEmpty = (o: object, path: string) => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") expect(v.trim().length, `${path}.${k}`).toBeGreaterThan(0);
    else if (v && typeof v === "object") nonEmpty(v, `${path}.${k}`);
  }
};

describe("EVALUATION_DOCS", () => {
  test("documents exactly the sub-signals of the default config, per axis", () => {
    for (const k of AXIS_KEYS) {
      expect(Object.keys(EVALUATION_DOCS.axes[k].subSignals).sort()).toEqual(Object.keys(DEFAULT_CONFIG.axes[k].subSignals).sort());
    }
  });
  test("every string is non-empty", () => nonEmpty(EVALUATION_DOCS, "docs"));
  test("scaledByLevel marks exactly the two death counts", () => {
    const scaled = AXIS_KEYS.flatMap((k) => Object.entries(EVALUATION_DOCS.axes[k].subSignals).filter(([, d]) => d.scaledByLevel).map(([id]) => `${k}.${id}`));
    expect(scaled.sort()).toEqual(["survival.groupDeaths", "survival.individualDeaths"]);
  });
  test("the previous-season bonus (an evidence source outside the config) is documented", () => {
    expect(EVALUATION_DOCS.axes.experience.extras?.prevSeasonBonus?.title).toBe("Previous season bonus");
  });
  test("prose never hard-codes config numbers", () => {
    const text = JSON.stringify(EVALUATION_DOCS);
    for (const n of [String(DEFAULT_CONFIG.verdict.invite), String(DEFAULT_CONFIG.verdict.maybe), "300 pts", "3600"]) expect(text).not.toContain(n);
    expect(text).not.toMatch(/weights? (of )?\d/i);
  });
  test("hostedOnly FAQ entries exist and are flagged", () => {
    expect(EVALUATION_DOCS.faq.some((f) => f.hostedOnly)).toBe(true);
    expect(EVALUATION_DOCS.faq.some((f) => !f.hostedOnly)).toBe(true);
  });
});
