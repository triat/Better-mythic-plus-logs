import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { budgetFromFailure, canAfford, pointsLeft, quotaFromFailure, quotaLabel, quotaOrBudgetMessage, quotaTooltip } from "./quota.ts";

const tFr = makeT(fr, "fr");

describe("quota view model", () => {
  test("pointsLeft: limit minus used, never negative; null without a limit or a quota", () => {
    expect(pointsLeft({ used: 120, limit: 300, resetInS: 10 })).toBe(180);
    expect(pointsLeft({ used: 310, limit: 300, resetInS: 10 })).toBe(0);
    expect(pointsLeft({ used: 5, limit: null, resetInS: 10 })).toBeNull();
    expect(pointsLeft(null)).toBeNull();
  });
  test("quotaLabel rounds down and says when it resets once exhausted", () => {
    expect(quotaLabel(tEn, { used: 120.4, limit: 300, resetInS: 900 })).toBe("179 pts left this hour");
    expect(quotaLabel(tEn, { used: 300, limit: 300, resetInS: 90 })).toBe("quota reached · resets in 2 min");
    expect(quotaLabel(tEn, { used: 300, limit: 300, resetInS: 5 })).toBe("quota reached · resets in 1 min");
    expect(quotaLabel(tEn, { used: 1, limit: null, resetInS: 900 })).toBeNull();
    expect(quotaLabel(tEn, null)).toBeNull();
  });
  test("quotaLabel in French", () => {
    expect(quotaLabel(tFr, { used: 300, limit: 300, resetInS: 90 })).toBe("quota atteint · reset dans 2 min");
  });
  test("canAfford compares the estimate with what is left; unlimited always can", () => {
    expect(canAfford({ used: 298, limit: 300, resetInS: 1 }, 3)).toBe(false);
    expect(canAfford({ used: 297, limit: 300, resetInS: 1 }, 3)).toBe(true);
    expect(canAfford({ used: 5000, limit: null, resetInS: 1 }, 30)).toBe(true);
    expect(canAfford(null, 30)).toBe(true);
  });
});

describe("quotaTooltip / quotaFromFailure / budgetFromFailure", () => {
  test("tooltip of a disabled Analyze button says when the quota resets", () => {
    expect(quotaTooltip(tEn, { used: 300, limit: 300, resetInS: 2280 })).toBe("Hourly quota reached · resets in 38 min · your own client: see Help");
    expect(quotaTooltip(tEn, { used: 300, limit: 300, resetInS: 5 })).toBe("Hourly quota reached · resets in 1 min · your own client: see Help");
    expect(quotaTooltip(tEn, null)).toBe("Hourly quota reached · your own client: see Help");
  });
  test("quotaOrBudgetMessage rounds the points the meter estimated as fractions, in both languages", () => {
    const quota = { code: "quota" as const, quota: { used: 298.6, limit: 300, resetInS: 1300 }, error: "server text" };
    expect(quotaOrBudgetMessage(tEn, quota)).toBe("Hourly quota reached (299/300 pts) — resets in 22 min");
    expect(quotaOrBudgetMessage(tFr, quota)).toBe("Quota horaire atteint (299/300 pts) — reset dans 22 min");
    const budget = { code: "budget" as const, budget: { used: 3512.4, limit: 3600, resetInS: 59 }, error: "server text" };
    expect(quotaOrBudgetMessage(tEn, budget)).toBe("The shared WCL budget is nearly exhausted (88 pts left) — resets in 1 min");
    expect(quotaOrBudgetMessage(tFr, budget)).toBe("Le budget WCL partagé est presque épuisé (88 pts restants) — reset dans 1 min");
    expect(quotaOrBudgetMessage(tEn, { code: "budget", budget: { used: 3700, limit: 3600, resetInS: 59 }, error: "x" })).toBe("The shared WCL budget is nearly exhausted (0 pts left) — resets in 1 min");
    expect(quotaOrBudgetMessage(tEn, { code: null, error: "Network error" })).toBe("Network error");
    expect(quotaOrBudgetMessage(tEn, { code: "quota", error: "no numbers" })).toBe("no numbers");
  });
  test("only an `error: \"quota\"` body carries the member's numbers", () => {
    expect(quotaFromFailure({ ok: false, error: "quota", message: "x", used: 300, limit: 300, resetInS: 120 })).toEqual({ used: 300, limit: 300, resetInS: 120 });
    expect(quotaFromFailure({ ok: false, error: "budget", message: "x", used: 3500, limit: 3600, resetInS: 120 })).toBeNull();
    expect(quotaFromFailure({ ok: false, error: "quota", message: "x" })).toBeNull();
    expect(quotaFromFailure(null)).toBeNull();
    expect(quotaFromFailure("nope")).toBeNull();
  });
  test("only an `error: \"budget\"` body carries the shared client's numbers", () => {
    expect(budgetFromFailure({ ok: false, error: "budget", message: "x", used: 3500, limit: 3600, resetInS: 120 })).toEqual({ used: 3500, limit: 3600, resetInS: 120 });
    expect(budgetFromFailure({ ok: false, error: "quota", message: "x", used: 300, limit: 300, resetInS: 120 })).toBeNull();
    expect(budgetFromFailure({ ok: false, error: "budget", message: "x" })).toBeNull();
    expect(budgetFromFailure(null)).toBeNull();
    expect(budgetFromFailure("nope")).toBeNull();
  });
});
