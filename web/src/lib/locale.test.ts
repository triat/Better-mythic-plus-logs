import { describe, expect, test } from "bun:test";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, detectLocale, effectiveLocale, fmtNumber, isLocale, pluralCategory } from "./locale.ts";

describe("locale", () => {
  test("two locales, labels and names", () => {
    expect(LOCALES).toEqual(["en", "fr"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(LOCALE_LABELS).toEqual({ en: "EN", fr: "FR" });
    expect(LOCALE_NAMES).toEqual({ en: "English", fr: "Français" });
  });
  test("detectLocale: any fr-* tag is fr, everything else (and nothing) is en", () => {
    expect(detectLocale("fr")).toBe("fr");
    expect(detectLocale("fr-FR")).toBe("fr");
    expect(detectLocale("FR-ca")).toBe("fr");
    expect(detectLocale("en-GB")).toBe("en");
    expect(detectLocale("de")).toBe("en");
    expect(detectLocale("")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });
  test("effectiveLocale: the saved choice wins over the browser", () => {
    expect(effectiveLocale(null, "fr-FR")).toBe("fr");
    expect(effectiveLocale("en", "fr-FR")).toBe("en");
    expect(effectiveLocale("fr", "en-US")).toBe("fr");
    expect(effectiveLocale(null, undefined)).toBe("en");
  });
  test("fmtNumber: narrow no-break space thousands in both locales, decimal comma in fr, max 2 decimals", () => {
    expect(fmtNumber("en", 1412)).toBe("1 412");
    expect(fmtNumber("fr", 1412)).toBe("1 412");
    expect(fmtNumber("en", 0.25)).toBe("0.25");
    expect(fmtNumber("fr", 0.25)).toBe("0,25");
    expect(fmtNumber("en", 3.14159)).toBe("3.14");
    expect(fmtNumber("fr", 3600.7, 0)).toBe("3 601");
    expect(fmtNumber("en", -7)).toBe("−7");
  });
  test("pluralCategory: English one only for 1, French one for 0 and 1", () => {
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("fr", 0)).toBe("one");
    expect(pluralCategory("fr", 1)).toBe("one");
    expect(pluralCategory("fr", 2)).toBe("other");
  });
});
