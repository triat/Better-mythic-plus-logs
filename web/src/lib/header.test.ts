import { describe, expect, test } from "bun:test";
import { tEn } from "../i18n/t.ts";
import { localeMenu, regionChipLabel, regionMenu, specChipLabel, specMenu } from "./header.ts";

describe("header chips", () => {
  test("regionMenu marks the effective region", () => {
    expect(regionMenu("kr").map((i) => [i.value, i.label, i.hint, i.on])).toEqual([
      ["eu", "EU", "Europe", false],
      ["us", "US", "Americas & Oceania", false],
      ["kr", "KR", "Korea", true],
      ["tw", "TW", "Taiwan", false],
    ]);
    expect(regionChipLabel("eu")).toBe("EU ▾");
  });

  test("specMenu before a lookup: any + other; after: the specs seen with counts and metric", () => {
    expect(specMenu(null, "").map((i) => i.value)).toEqual(["", "other"]);
    expect(specMenu(null, "").map((i) => i.on)).toEqual([true, false]);
    const p = { runsIndexed: 83, specsSeen: [{ spec: "Elemental", runs: 52, metric: "dps" as const }, { spec: "Restoration", runs: 31, metric: "hps" as const }] };
    expect(specMenu(p, "Restoration")).toEqual([
      { value: "", label: "any", hint: "83 runs", on: false },
      { value: "Elemental", label: "Elemental", hint: "52 runs · dps", on: false },
      { value: "Restoration", label: "Restoration", hint: "31 runs · hps", on: true },
      { value: "other", label: "Other…", hint: "type a name", on: false },
    ]);
    expect(specChipLabel("")).toBe("spec any ▾");
    expect(specChipLabel("Restoration")).toBe("spec Restoration ▾");
  });

  test("specMenu: 'any' counts every indexed run even when the payload was spec-filtered; a typed spec not in the list marks nothing", () => {
    const p = { runsIndexed: 31, specsSeen: [{ spec: "Elemental", runs: 52, metric: "dps" as const }, { spec: "Restoration", runs: 31, metric: "hps" as const }] };
    expect(specMenu(p, "Augmentation")[0]).toEqual({ value: "", label: "any", hint: "83 runs", on: false });
    expect(specMenu(p, "Augmentation").some((i) => i.on)).toBe(false);
    expect(specMenu({ runsIndexed: 1, specsSeen: [{ spec: "Holy", runs: 1, metric: "hps" as const }] }, "")[0].hint).toBe("1 run");
  });
});

describe("localeMenu", () => {
  test("two entries, the current one on, labels from the locale tables", () => {
    expect(localeMenu(tEn, "fr")).toEqual([
      { value: "en", label: "EN", hint: "English", on: false },
      { value: "fr", label: "FR", hint: "Français", on: true },
    ]);
    expect(localeMenu(tEn, "en").map((i) => i.on)).toEqual([true, false]);
  });
});
