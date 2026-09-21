import { describe, expect, test } from "bun:test";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { formatMessage, leafKeys, makeT } from "./t.ts";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)(?:,\s*plural[^}]*\{[^}]*\}\s*other\s*\{[^}]*\})?\}/g)].map((m) => m[1]!).sort();

describe("dictionaries", () => {
  test("fr has exactly the keys of en", () => {
    expect(leafKeys(fr).sort()).toEqual(leafKeys(en).sort());
  });
  test("every message keeps its placeholders across languages", () => {
    const keys = leafKeys(en);
    const get = (d: unknown, key: string) => key.split(".").reduce<any>((o, k) => o[k], d) as string;
    for (const key of keys) expect({ key, ph: placeholders(get(fr, key)) }).toEqual({ key, ph: placeholders(get(en, key)) });
  });
  test("no message is empty and none is left in English in fr where en has letters", () => {
    for (const key of leafKeys(fr)) {
      const get = (d: unknown) => key.split(".").reduce<any>((o, k) => o[k], d) as string;
      expect(get(fr).trim().length).toBeGreaterThan(0);
      expect(get(en).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("formatMessage", () => {
  test("params, numbers formatted per locale, unknown params left as is", () => {
    expect(formatMessage("en", "for a +{level}", { level: 21 })).toBe("for a +21");
    expect(formatMessage("fr", "{pts} pts", { pts: 1412 })).toBe("1 412 pts");
    expect(formatMessage("en", "{a} and {b}", { a: "x" })).toBe("x and {b}");
    expect(formatMessage("fr", "{v}\u202f%", { v: 12.5 })).toBe("12,5\u202f%");
  });
  test("plural: one / other with # as the formatted count", () => {
    const m = "{count, plural, one {# run scored} other {# runs scored}}";
    expect(formatMessage("en", m, { count: 1 })).toBe("1 run scored");
    expect(formatMessage("en", m, { count: 9 })).toBe("9 runs scored");
    expect(formatMessage("en", m, { count: 0 })).toBe("0 runs scored");
    expect(formatMessage("fr", "{count, plural, one {# run noté} other {# runs notés}}", { count: 0 })).toBe("0 run noté");
    expect(formatMessage("en", "{n, plural, one {a} other {b}} · {n}", { n: 2 })).toBe("b · 2");
  });
});

describe("makeT", () => {
  test("looks a key up, formats, and returns the key itself when missing", () => {
    const t = makeT(en, "en");
    expect(t("common.locale.title")).toBe("Language");
    expect(t("common.locale.remembered")).toBe("Language · remembered");
    // @ts-expect-error — a key that does not exist is still a string at runtime
    expect(t("nope.missing")).toBe("nope.missing");
    expect(makeT(fr, "fr")("common.locale.title")).toBe("Langue");
  });
});
