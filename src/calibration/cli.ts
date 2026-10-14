// `bmpl calibrate --hourly | --fit`: the weekly recalibration's two systemd units (deploy/bmpl-calibrate-*.service).
// Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md.
import { getDefensives } from "../deepdive/table.ts";
import { DEFAULT_CONFIG, validateConfig } from "../evaluation/config.ts";
import { buildLookupPayload, performLookup } from "../lookup.ts";
import { resolveCalibrationDbPath } from "../setup.ts";
import { openStore } from "../signals/store.ts";
import { gql } from "../wcl/client.ts";
import { getCurrentMplusZone } from "../mplus.ts";
import { collectHour, WINDOW_MS } from "./collect.ts";
import { fitAndCompare, writeFit } from "./report.ts";
import { ensureMarker, memberMarkerAt, resolveMarkerPath } from "./marker.ts";
import { openSamples } from "./samples.ts";
import { reserveFromEnv } from "./window.ts";

const stamp = (l: string) => console.log(`${new Date().toISOString()} ${l}`);

/** One hour of collection; `minutes` bounds it so the next hourly run never overlaps. */
export async function runHourly(minutes = 55): Promise<void> {
  const path = await resolveCalibrationDbPath();
  const marker = await resolveMarkerPath();
  ensureMarker(marker);
  const samples = openSamples(path);
  const store = openStore(path);
  const evalConfig = validateConfig(DEFAULT_CONFIG);
  const tables = await getDefensives();
  try {
    await collectHour({
      samples, gql, reserve: reserveFromEnv(process.env.BMPL_CALIBRATION_RESERVE), endAt: Date.now() + minutes * 60_000,
      memberAt: () => memberMarkerAt(marker), log: stamp,
      lookup: async (c) => {
        const o = await performLookup({ name: c.name, realm: c.server, region: "eu", level: c.level, spec: c.spec, enrich: true }, { store, evalConfig, tables });
        return o.ok ? { ok: true, payload: buildLookupPayload(o, c.server) } : { ok: false, error: o.error };
      },
    });
  } finally {
    store.close();
    samples.close();
  }
}

/** The weekly fit, 0 WCL points: reads the window's samples, writes candidate.json and comparison.md. */
export async function runFit(): Promise<void> {
  const path = await resolveCalibrationDbPath();
  const samples = openSamples(path);
  try {
    const zone = await getCurrentMplusZone();
    const now = Date.now();
    samples.prune(zone.id, now - WINDOW_MS);
    const r = fitAndCompare(samples.list(zone.id, now - WINDOW_MS), validateConfig(DEFAULT_CONFIG), now);
    writeFit(path, r);
    stamp(`fit: ${r.test} held-out characters; ${r.reason}`);
  } finally {
    samples.close();
  }
}

export async function cmdCalibrate(rest: string[]): Promise<void> {
  if (rest.includes("--fit")) {
    await runFit();
    return;
  }
  if (rest.includes("--hourly")) {
    const i = rest.indexOf("--minutes");
    const minutes = i >= 0 ? Number(rest[i + 1]) : 55;
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes must be a positive number");
    await runHourly(minutes);
    return;
  }
  throw new Error("Usage: bmpl calibrate --hourly [--minutes 55] | --fit");
}
