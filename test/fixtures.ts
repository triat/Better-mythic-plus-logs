import * as path from "node:path";

const dir = path.join(import.meta.dir, "fixtures");

const WCL_FILES = {
  "s1-tank": "wcl-run-s1-magisters-terrace-tank.json",
  "s2-healer": "wcl-run-s2-voidscar-arena-healer.json",
} as const;

export type WclFixtureName = keyof typeof WCL_FILES;

// Shape: { character: string; run: MPlusRun; report: <raw WCL report object> }
export const loadWclFixture = async (name: WclFixtureName): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, WCL_FILES[name])).text());

export const loadRioFixture = async (): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, "rio-profile-muleyoxo.json")).text());

const DEEPDIVE_FILES = {
  "s2-healer": "deepdive-s2-voidscar-arena-healer.json",
  "s2-rogue": "deepdive-s2-temple-of-sethraliss-rogue.json",
} as const;

export type DeepdiveFixtureName = keyof typeof DEEPDIVE_FILES;

// Shape: { character: string; run: MPlusRun; report: RawRunReport; deepdive: RawDeepDive }
export const loadDeepdiveFixture = async (name: DeepdiveFixtureName): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, DEEPDIVE_FILES[name])).text());
