import { describe, expect, test } from "bun:test";
import { EVIDENCE_SOURCES } from "../../src/evaluation/axes/index.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import type { Evidence } from "../../src/evaluation/types.ts";
import { fr } from "../../web/src/i18n/fr.ts";
import { makeT, tEn } from "../../web/src/i18n/t.ts";
import { evidenceText } from "../../web/src/lib/axes.ts";
import { fixturePayload } from "./helpers.ts";

// The web front rebuilds every evidence line from Evidence.value / extra (web/src/lib/axes.ts evidenceText).
// This file crosses both trees on purpose — tests under test/ may — so the web's English is checked against
// the labels the server really emits, and the dictionary against EVIDENCE_SOURCES.
const tFr = makeT(fr, "fr");
const cfg = validateConfig(DEFAULT_CONFIG);

describe("evidenceText against the server", () => {
  test("every EVIDENCE_SOURCES entry has a message in both languages (never a bare key)", () => {
    const probe = (source: string): Evidence => ({ source, value: 1.25, delta: 0, label: "", extra: { runs: 2, count: 1, total: 3 } });
    for (const source of EVIDENCE_SOURCES) {
      for (const [t, locale] of [[tEn, "en"], [tFr, "fr"]] as const) {
        const out = evidenceText(t, locale, probe(source));
        expect(out, `${locale} ${source}`).not.toContain("evidence.");
        expect(out.length, `${locale} ${source}`).toBeGreaterThan(0);
      }
    }
  });
  test("English is byte-identical to the server label for every evidence entry of the fixture evaluations", async () => {
    const all = [evaluate(await fixturePayload("s1-tank", false), cfg), evaluate(await fixturePayload("s2-healer", true), cfg)]
      .flatMap((e) => e.axes.flatMap((a) => a.evidence));
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((e) => e.source)).size).toBeGreaterThan(15);
    for (const e of all) expect(evidenceText(tEn, "en", e), e.source).toBe(e.label);
  });
});
