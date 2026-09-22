import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, LEGEND_STORAGE_KEY, parseServerSettings, readLocalSettings, writeLocalSettings } from "./settings.ts";
import { STORAGE_KEY } from "./keyLevel.ts";

const fakeStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, dump: () => Object.fromEntries(m) };
};

describe("readLocalSettings", () => {
  test("defaults without storage or with empty storage", () => {
    expect(readLocalSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readLocalSettings(fakeStore())).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
  });
  test("reads the legacy keys: bmpl.yourKey (validated) and bmpl.legendOpen ('0' = closed)", () => {
    expect(readLocalSettings(fakeStore({ [STORAGE_KEY]: "18", [LEGEND_STORAGE_KEY]: "0" }))).toMatchObject({ yourKey: 18, legendOpen: false, region: null, locale: null });
    expect(readLocalSettings(fakeStore({ [STORAGE_KEY]: "99", [LEGEND_STORAGE_KEY]: "1" }))).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
  });
  test("a throwing storage (private mode) yields the defaults", () => {
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => {}, removeItem: () => {} };
    expect(readLocalSettings(boom)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("writeLocalSettings", () => {
  test("writes only the patched keys; null removes the key", () => {
    const s = fakeStore({ [STORAGE_KEY]: "18" });
    writeLocalSettings(s, { legendOpen: false });
    expect(s.dump()).toEqual({ [STORAGE_KEY]: "18", [LEGEND_STORAGE_KEY]: "0" });
    writeLocalSettings(s, { yourKey: null });
    expect(s.dump()).toEqual({ [LEGEND_STORAGE_KEY]: "0" });
    writeLocalSettings(s, { yourKey: 21, legendOpen: true });
    expect(s.dump()).toEqual({ [STORAGE_KEY]: "21", [LEGEND_STORAGE_KEY]: "1" });
  });
  test("no storage or a throwing storage is a no-op", () => {
    writeLocalSettings(null, { yourKey: 1 });
    writeLocalSettings({ getItem: () => null, setItem: () => { throw new Error("denied"); }, removeItem: () => {} }, { legendOpen: true });
  });
});

describe("parseServerSettings", () => {
  test("accepts the server shape and clamps garbage to the defaults", () => {
    expect(parseServerSettings({ yourKey: 18, legendOpen: false })).toMatchObject({ yourKey: 18, legendOpen: false, region: null, locale: null });
    expect(parseServerSettings({ yourKey: null, legendOpen: true })).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
    expect(parseServerSettings({ yourKey: 99 })).toMatchObject({ yourKey: null, legendOpen: true, region: null, locale: null });
    expect(parseServerSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseServerSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });
});

test("region is remembered in the browser and parsed from the server, junk → null", () => {
  const store = fakeStore({ "bmpl.region": "us" });
  expect(readLocalSettings(store).region).toBe("us");
  writeLocalSettings(store, { region: "kr" });
  expect(store.getItem("bmpl.region")).toBe("kr");
  writeLocalSettings(store, { region: null });
  expect(store.getItem("bmpl.region")).toBeNull();
  expect(readLocalSettings(fakeStore({ "bmpl.region": "cn" })).region).toBeNull();
  expect(parseServerSettings({ region: "tw" }).region).toBe("tw");
  expect(parseServerSettings({ region: "cn" }).region).toBeNull();
  expect(parseServerSettings({}).region).toBeNull();
});

test("locale: read from bmpl.locale, invalid values ignored, written and removed like the region", () => {
  const store = fakeStore({ "bmpl.locale": "fr" });
  expect(readLocalSettings(store).locale).toBe("fr");
  expect(readLocalSettings(fakeStore({ "bmpl.locale": "de" })).locale).toBeNull();
  writeLocalSettings(store, { locale: "en" });
  expect(store.getItem("bmpl.locale")).toBe("en");
  writeLocalSettings(store, { locale: null });
  expect(store.getItem("bmpl.locale")).toBeNull();
  expect(parseServerSettings({ yourKey: null, legendOpen: true, region: null, locale: "fr" }).locale).toBe("fr");
  expect(parseServerSettings({ yourKey: null, legendOpen: true, region: null, locale: "xx" }).locale).toBeNull();
});

test("Live settings round-trip through local storage, with defaults on junk", () => {
  const store = fakeStore();
  writeLocalSettings(store, { liveSort: "verdict", liveRoles: ["tank", "healer"], liveClasses: ["Druid"] });
  expect(readLocalSettings(store)).toMatchObject({ liveSort: "verdict", liveRoles: ["tank", "healer"], liveClasses: ["Druid"] });

  store.setItem("bmpl.liveSort", "nonsense");
  store.setItem("bmpl.liveRoles", "not json");
  store.setItem("bmpl.liveClasses", '"not an array"');
  expect(readLocalSettings(store)).toMatchObject({ liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [] });
});
