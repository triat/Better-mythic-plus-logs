import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  ageDays, deathsTone, fmtAge, fmtAmount, fmtDuration, higherTone, lowerTone, parseTier, realmName, rioHref, signed, toneClass, wclUrl,
} from "./format.ts";

const tFr = makeT(fr, "fr");

describe("format", () => {
  test("fmtAmount", () => {
    expect(fmtAmount(999)).toBe("999");
    expect(fmtAmount(1500)).toBe("1.5k");
    expect(fmtAmount(2_345_678)).toBe("2.35m");
  });
  test("fmtAge / ageDays", () => {
    const now = 1_000_000_000_000;
    const H = 3600e3, D = 24 * H;
    expect(fmtAge(tEn, now - 10 * 60e3, now)).toBe("just now");
    expect(fmtAge(tEn, now - 5 * H, now)).toBe("5h ago");
    expect(fmtAge(tEn, now - 3 * D, now)).toBe("3d ago");
    expect(fmtAge(tEn, now - 20 * D, now)).toBe("2w ago");
    expect(fmtAge(tEn, now - 100 * D, now)).toBe("3mo ago");
    expect(fmtAge(tEn, now - 800 * D, now)).toBe("2y ago");
    expect(ageDays(now - 2 * D, now)).toBe(2);
    expect(ageDays(now + D, now)).toBe(0);
  });
  test("fmtAge in French", () => {
    const now = 1_000_000_000_000;
    expect(fmtAge(tFr, now - 3 * 86400e3, now)).toBe("il y a 3 j");
  });
  test("fmtDuration", () => {
    expect(fmtDuration(1_796_000)).toBe("29:56");
    expect(fmtDuration(65_000)).toBe("1:05");
  });
  test("signed uses a real minus sign", () => {
    expect(signed(12.4)).toBe("+12");
    expect(signed(-6.6)).toBe("−7");
    expect(signed(0)).toBe("+0");
    expect(signed(-3.14, 1, "%")).toBe("−3.1%");
  });
  test("parseTier thresholds", () => {
    expect(parseTier(95)).toBe("legendary");
    expect(parseTier(75)).toBe("magenta");
    expect(parseTier(50)).toBe("blue");
    expect(parseTier(25)).toBe("green");
    expect(parseTier(24.9)).toBe("gray");
  });
  test("tones", () => {
    expect(deathsTone(0)).toBe("good");
    expect(deathsTone(2)).toBe("warn");
    expect(deathsTone(3)).toBe("bad");
    expect(lowerTone(-10)).toBe("good");
    expect(lowerTone(10)).toBe("neutral");
    expect(lowerTone(30)).toBe("warn");
    expect(lowerTone(31)).toBe("bad");
    expect(higherTone(0)).toBe("good");
    expect(higherTone(-25)).toBe("neutral");
    expect(higherTone(-26)).toBe("bad");
    expect(toneClass("good")).toBe("tone-good");
    expect(toneClass("neutral")).toBe("");
  });
  test("realmName", () => {
    expect(realmName("silvermoon")).toBe("Silvermoon");
    expect(realmName("twisting-nether")).toBe("Twisting Nether");
    expect(realmName("kel'thuzad")).toBe("Kel'Thuzad");
    expect(realmName("")).toBe("");
  });
  test("links", () => {
    expect(wclUrl("AbC/1", 7)).toBe("https://www.warcraftlogs.com/reports/AbC%2F1#fight=7");
    expect(rioHref("https://raider.io/characters/eu/x/y")).toBe("https://raider.io/characters/eu/x/y");
    expect(rioHref("javascript:alert(1)")).toBeNull();
    expect(rioHref(undefined)).toBeNull();
  });
});
