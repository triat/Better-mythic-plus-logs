import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/evaluation/config.ts";
import { EVALUATION_DOCS, EVALUATION_DOCS_BY_LOCALE } from "../../src/evaluation/docs.ts";
import { EVALUATION_DOCS_FR } from "../../src/evaluation/docs.fr.ts";
import { AXIS_KEYS } from "../../src/evaluation/types.ts";
import { LOCALES } from "../../src/hosted/locale.ts";

const nonEmpty = (o: object, path: string) => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") expect(v.trim().length, `${path}.${k}`).toBeGreaterThan(0);
    else if (v && typeof v === "object") nonEmpty(v, `${path}.${k}`);
  }
};

/** Every path of the tree with its shape: "a.b" for a string, "a.b[]=3" for an array length, "a.b?=true" for a boolean. */
const shape = (o: unknown, prefix = ""): string[] => {
  if (Array.isArray(o)) return [`${prefix}[]=${o.length}`, ...o.flatMap((v, i) => shape(v, `${prefix}[${i}]`))];
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  if (typeof o === "boolean") return [`${prefix}?=${o}`];
  return [prefix];
};
const links = (s: string): string[] => [...s.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);

describe("EVALUATION_DOCS_BY_LOCALE", () => {
  test("English is EVALUATION_DOCS, French is EVALUATION_DOCS_FR, one registry per locale", () => {
    expect(Object.keys(EVALUATION_DOCS_BY_LOCALE).sort()).toEqual([...LOCALES].sort());
    expect(EVALUATION_DOCS_BY_LOCALE.en).toBe(EVALUATION_DOCS);
    expect(EVALUATION_DOCS_BY_LOCALE.fr).toBe(EVALUATION_DOCS_FR);
  });
  test("the French registry has the English structure: same keys, array lengths, hostedOnly and scaledByLevel flags", () => {
    expect(shape(EVALUATION_DOCS_FR)).toEqual(shape(EVALUATION_DOCS));
  });
  test("the French guide links the same targets as the English one, in the same order", () => {
    const targets = (d: typeof EVALUATION_DOCS) => [...d.wclClient.onWcl, ...d.wclClient.inBmpl].map(links);
    expect(targets(EVALUATION_DOCS_FR)).toEqual(targets(EVALUATION_DOCS));
  });
  test("the axis titles are translated", () => {
    expect(AXIS_KEYS.map((k) => EVALUATION_DOCS_FR.axes[k].title)).toEqual(["Survie", "Utilité", "Throughput", "Régularité", "Préparation", "Expérience"]);
  });
  test("French keeps the narrow no-break space before every %", () => {
    expect(JSON.stringify(EVALUATION_DOCS_FR)).not.toMatch(/ %/);
  });
  test("French keeps the unit markers curveTable reads (± prefix, ' vs ', % prefix) where English has them", () => {
    for (const k of AXIS_KEYS) {
      for (const [id, en] of Object.entries(EVALUATION_DOCS.axes[k].subSignals)) {
        const fr = EVALUATION_DOCS_FR.axes[k].subSignals[id]!;
        expect({ id, pm: fr.unit.startsWith("±"), vs: fr.unit.includes(" vs "), pct: fr.unit.startsWith("%") })
          .toEqual({ id, pm: en.unit.startsWith("±"), vs: en.unit.includes(" vs "), pct: en.unit.startsWith("%") });
      }
    }
  });
});

for (const locale of LOCALES) {
  const DOCS = EVALUATION_DOCS_BY_LOCALE[locale];
  describe(`EVALUATION_DOCS (${locale})`, () => {
    test("documents exactly the sub-signals of the default config, per axis", () => {
      for (const k of AXIS_KEYS) {
        expect(Object.keys(DOCS.axes[k].subSignals).sort()).toEqual(Object.keys(DEFAULT_CONFIG.axes[k].subSignals).sort());
      }
    });
    test("every string is non-empty", () => nonEmpty(DOCS, "docs"));
    test("scaledByLevel marks exactly the two death counts", () => {
      const scaled = AXIS_KEYS.flatMap((k) => Object.entries(DOCS.axes[k].subSignals).filter(([, d]) => d.scaledByLevel).map(([id]) => `${k}.${id}`));
      expect(scaled.sort()).toEqual(["survival.groupDeaths", "survival.individualDeaths"]);
    });
    test("the previous-season bonus (an evidence source outside the config) is documented", () => {
      expect(DOCS.axes.experience.extras?.prevSeasonBonus?.title).toBe(locale === "en" ? "Previous season bonus" : "Bonus saison précédente");
    });
    test("prose never hard-codes config numbers", () => {
      const text = JSON.stringify(DOCS);
      for (const n of [String(DEFAULT_CONFIG.verdict.invite), String(DEFAULT_CONFIG.verdict.maybe), "300 pts", "3600"]) expect(text).not.toContain(n);
      expect(text).not.toMatch(/weights? (of )?\d/i);
      expect(text).not.toMatch(/poids (de )?\d/i);
    });
    test("the own-client guide links warcraftlogs.com and our Settings page, and prints no budget number", () => {
      const g = DOCS.wclClient;
      expect(g.onWcl.join(" ")).toContain("](https://www.warcraftlogs.com/api/clients)");
      expect(g.inBmpl.join(" ")).toContain("](/settings#wcl-client)");
      expect(JSON.stringify(g)).not.toMatch(/\d{3,}/);
    });
    test("hostedOnly FAQ entries exist and are flagged", () => {
      expect(DOCS.faq.some((f) => f.hostedOnly)).toBe(true);
      expect(DOCS.faq.some((f) => !f.hostedOnly)).toBe(true);
    });
  });
}
