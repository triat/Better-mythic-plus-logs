import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { localeMenu, regionChipLabel, regionMenu, specChipLabel, specMenu } from "./header.ts";

const tFr = makeT(fr, "fr");

describe("header chips", () => {
  test("regionMenu marks the effective region", () => {
    expect(regionMenu(tEn, "kr").map((i) => [i.value, i.label, i.hint, i.on])).toEqual([
      ["eu", "EU", "Europe", false],
      ["us", "US", "Americas & Oceania", false],
      ["kr", "KR", "Korea", true],
      ["tw", "TW", "Taiwan", false],
    ]);
    expect(regionChipLabel("eu")).toBe("EU ▾");
  });

  test("specMenu before a lookup: any + other; after: the specs seen with counts and metric", () => {
    expect(specMenu(tEn, null, "").map((i) => i.value)).toEqual(["", "other"]);
    expect(specMenu(tEn, null, "").map((i) => i.on)).toEqual([true, false]);
    const p = { runsIndexed: 83, specsSeen: [{ spec: "Elemental", runs: 52, metric: "dps" as const }, { spec: "Restoration", runs: 31, metric: "hps" as const }] };
    expect(specMenu(tEn, p, "Restoration")).toEqual([
      { value: "", label: "any", hint: "83 runs", on: false },
      { value: "Elemental", label: "Elemental", hint: "52 runs · dps", on: false },
      { value: "Restoration", label: "Restoration", hint: "31 runs · hps", on: true },
      { value: "other", label: "Other…", hint: "type a name", on: false },
    ]);
    expect(specChipLabel(tEn, "")).toBe("spec any ▾");
    expect(specChipLabel(tEn, "Restoration")).toBe("spec Restoration ▾");
  });

  test("specMenu: 'any' counts every indexed run even when the payload was spec-filtered; a typed spec not in the list marks nothing", () => {
    const p = { runsIndexed: 31, specsSeen: [{ spec: "Elemental", runs: 52, metric: "dps" as const }, { spec: "Restoration", runs: 31, metric: "hps" as const }] };
    expect(specMenu(tEn, p, "Augmentation")[0]).toEqual({ value: "", label: "any", hint: "83 runs", on: false });
    expect(specMenu(tEn, p, "Augmentation").some((i) => i.on)).toBe(false);
    expect(specMenu(tEn, { runsIndexed: 1, specsSeen: [{ spec: "Holy", runs: 1, metric: "hps" as const }] }, "")[0].hint).toBe("1 run");
  });

  test("french: region hints and spec 'any'/'other' labels", () => {
    expect(regionMenu(tFr, "eu").map((i) => [i.label, i.hint])).toEqual([
      ["EU", "Europe"],
      ["US", "Amériques & Océanie"],
      ["KR", "Corée"],
      ["TW", "Taïwan"],
    ]);
    expect(specMenu(tFr, null, "").map((i) => i.label)).toEqual(["toutes", "Autre…"]);
    expect(specChipLabel(tFr, "")).toBe("spec toutes ▾");
  });
});

describe("localeMenu", () => {
  test("two entries, the current one on, labels from the locale tables", () => {
    expect(localeMenu("fr")).toEqual([
      { value: "en", label: "EN", hint: "English", on: false },
      { value: "fr", label: "FR", hint: "Français", on: true },
    ]);
    expect(localeMenu("en").map((i) => i.on)).toEqual([true, false]);
  });
});
