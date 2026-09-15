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
