import { describe, expect, test } from "bun:test";
import type { Evaluation } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { BAR_MAX_PX, driversView } from "./drivers.ts";

const tFr = makeT(fr, "fr");
const titles: Record<string, string> = { "survival.individualDeaths": "Individual deaths", "throughput.medianParse": "Median parse", "throughput.parseAtTarget": "Parse at target", "survival.avoidableVsPeers": "Avoidable damage", "experience.atTarget": "Dungeons at target", "utility.dispels": "Dispels", "utility.kicksVsPeers": "Kicks" };
const titleOf = (s: string) => titles[s] ?? s;
const ev = (over: Partial<Evaluation>): Evaluation => ({
  role: "dps", targetLevel: 16, axes: [], global: 47, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x",
  drivers: [
    { source: "survival.individualDeaths", impact: -19, value: 1.6, reference: 0.7, label: "" },
    { source: "throughput.medianParse", impact: -13, value: 40.7, reference: 58.5, label: "" },
    { source: "throughput.parseAtTarget", impact: -6, value: 45.7, reference: 57.2, label: "" },
    { source: "utility.dispels", impact: -2, value: 1, reference: 2, label: "" },
    { source: "experience.atTarget", impact: 4, value: 1, reference: 0.625, label: "" },
    { source: "survival.avoidableVsPeers", impact: 6, value: -29.4, reference: -3.2, label: "" },
  ],
  nextVerdict: { verdict: "invite", threshold: 70, sources: ["survival.individualDeaths", "throughput.medianParse"], score: 72, reachable: true },
  ...over,
});

describe("driversView", () => {
  test("three costs then two strengths, largest first, bars 6 px a point", () => {
    const v = driversView(tEn, "en", ev({}), titleOf)!;
    expect(v.rows.map((r) => r.impact)).toEqual(["−19", "−13", "−6", "+6", "+4"]);
    expect(v.rows[0]).toEqual({ source: "survival.individualDeaths", title: "Individual deaths", impact: "−19", tone: "bad", barPx: 114, value: "1.6 / run", reference: "avg 0.7" });
    expect(v.rows[3]!.value).toBe("−29% vs peers");
    expect(v.rows[3]!.reference).toBe("avg −3%");
    expect(v.rows[4]!.value).toBe("100%");
  });
  test("bars cap at the half width", () => {
    const big = ev({ drivers: [{ source: "survival.individualDeaths", impact: -40, value: 3, reference: 0.7, label: "" }] });
    expect(driversView(tEn, "en", big, titleOf)!.rows[0]!.barPx).toBe(BAR_MAX_PX);
  });
  test("kicksVsPeers reads in points, not percent (it's percentage points, not a percentage)", () => {
    const v = driversView(tEn, "en", ev({ drivers: [{ source: "utility.kicksVsPeers", impact: -3, value: -1, reference: 0.7, label: "" }] }), titleOf)!;
    expect(v.rows[0]).toMatchObject({ value: "−1 pts vs peers", reference: "avg +1 pts" });
  });
  test("the path sentence, reachable and not", () => {
    const p = driversView(tEn, "en", ev({}), titleOf)!.path!;
    expect(p).toMatchObject({ verdict: "INVITE", verdictCls: "badge-invite", threshold: "70", list: "individual deaths and median parse", score: "72" });
    expect(p.message).toContain("{list}");
    const out = driversView(tEn, "en", ev({ nextVerdict: { verdict: "maybe", threshold: 30, sources: ["a", "b", "c"], score: 12, reachable: false } }), titleOf)!.path!;
    expect(out.message).toBe("To reach {verdict} ({threshold}): out of reach by fixing 3 signals");
    expect(driversView(tEn, "en", ev({ nextVerdict: null }), titleOf)!.path).toBeNull();
  });
  test("French: decimal comma, French list", () => {
    const v = driversView(tFr, "fr", ev({}), titleOf)!;
    expect(v.rows[0]!.value).toBe("1,6 / run");
    expect(v.rows[0]!.reference).toBe("moy. 0,7");
    expect(v.path!.list).toBe("individual deaths et median parse");
  });
  test("nothing to show for an evaluation saved before drivers, or with none", () => {
    expect(driversView(tEn, "en", ev({ drivers: undefined }), titleOf)).toBeNull();
    expect(driversView(tEn, "en", ev({ drivers: [] }), titleOf)).toBeNull();
  });
});
