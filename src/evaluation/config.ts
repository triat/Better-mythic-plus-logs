import defaultJson from "./default-config.json";
import { resolveEvalConfigPath } from "../setup.ts";
import { AXIS_KEYS, type AxisKey, type CurvePoints, type EvaluationConfig, type Role } from "./types.ts";

export const DEFAULT_CONFIG = defaultJson as unknown as EvaluationConfig;
const ROLES: readonly Role[] = ["dps", "healer", "tank"];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Objects merge recursively, arrays and scalars replace. Never mutates inputs. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObj(base) || !isObj(override)) return override === undefined ? base : structuredClone(override);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

/**
 * `deepMerge(base, override)` for a user's evaluation.json: a sub-signal whose `curve` the file sets, without
 * `curves`, keeps that curve for every role, so `base`'s per-role `curves`, which would win over it (`curveFor`), are
 * dropped for that sub-signal (validity spec 2026-10-27, decision 8).
 */
export function mergeUserConfig(base: unknown, override: unknown): unknown {
  const merged = deepMerge(base, override);
  if (!isObj(merged) || !isObj(override) || !isObj(override.axes) || !isObj(merged.axes)) return merged;
  for (const [axis, a] of Object.entries(override.axes)) {
    if (!isObj(a) || !isObj(a.subSignals)) continue;
    const subs = (merged.axes as Record<string, unknown>)[axis];
    if (!isObj(subs) || !isObj(subs.subSignals)) continue;
    for (const [id, s] of Object.entries(a.subSignals)) {
      // deepMerge rebuilt every object the file touches, so the default config itself is never changed here.
      const target = subs.subSignals[id];
      if (isObj(s) && "curve" in s && !("curves" in s) && isObj(target)) delete target.curves;
    }
  }
  return merged;
}

class ConfigError extends Error {}
const fail = (path: string, msg: string): never => { throw new ConfigError(`${path}: ${msg}`); };

const expectKeys = (obj: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`${path}.${k}`, "unknown key");
  for (const k of allowed) if (!(k in obj)) fail(`${path}.${k}`, "missing");
};

const checkCurve = (v: unknown, path: string, yLo: number, yHi: number): CurvePoints => {
  if (!Array.isArray(v) || v.length < 1) return fail(path, "must be a non-empty array of [x, y]");
  let prevX = -Infinity;
  for (const [i, p] of v.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number")
      return fail(`${path}[${i}]`, "must be [number, number]");
    if (p[0] <= prevX) return fail(path, `x must be strictly increasing (at index ${i})`);
    if (p[1] < yLo || p[1] > yHi) return fail(`${path}[${i}]`, `y must be within ${yLo}..${yHi}`);
    prevX = p[0];
  }
  return v as CurvePoints;
};

const checkNumber = (v: unknown, path: string, min = 0): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) return fail(path, `must be a number ≥ ${min}`);
  return v;
};

const checkWeights = (v: unknown, path: string): Record<Role, number> => {
  if (!isObj(v)) return fail(path, "must be an object");
  expectKeys(v, ROLES, path);
  const out = {} as Record<Role, number>;
  for (const r of ROLES) out[r] = checkNumber(v[r], `${path}.${r}`);
  return out;
};

/** Structural + semantic validation. Throws with the offending path in the message. */
export function validateConfig(obj: unknown): EvaluationConfig {
  if (!isObj(obj)) return fail("config", "must be an object");
  expectKeys(obj, "shrinkage" in obj
    ? ["version", "levelScale", "expectedIlvl", "axes", "axisWeights", "globalCurve", "reference", "verdict", "confidence", "shrinkage"]
    : ["version", "levelScale", "expectedIlvl", "axes", "axisWeights", "globalCurve", "reference", "verdict", "confidence"], "config");
  if (typeof obj.version !== "string") fail("version", "must be a string");
  const levelScale = checkCurve(obj.levelScale, "levelScale", 0, 10);

  if (!isObj(obj.expectedIlvl)) fail("expectedIlvl", "must be an object");
  const expectedIlvl: Record<string, CurvePoints> = {};
  for (const [slug, c] of Object.entries(obj.expectedIlvl as Record<string, unknown>))
    expectedIlvl[slug] = checkCurve(c, `expectedIlvl.${slug}`, 0, 1000);

  if (!isObj(obj.axes)) fail("axes", "must be an object");
  expectKeys(obj.axes as Record<string, unknown>, AXIS_KEYS, "axes");
  const axes = {} as EvaluationConfig["axes"];
  const defaultAxes = (defaultJson as unknown as EvaluationConfig).axes;
  for (const k of AXIS_KEYS) {
    const a = (obj.axes as Record<string, unknown>)[k];
    if (!isObj(a)) fail(`axes.${k}`, "must be an object");
    expectKeys(a as Record<string, unknown>, ["subSignals"], `axes.${k}`);
    const subs = (a as Record<string, unknown>).subSignals;
    if (!isObj(subs)) fail(`axes.${k}.subSignals`, "must be an object");
    expectKeys(subs as Record<string, unknown>, Object.keys(defaultAxes[k].subSignals), `axes.${k}.subSignals`);
    const outSubs: EvaluationConfig["axes"][AxisKey]["subSignals"] = {};
    for (const [id, s] of Object.entries(subs as Record<string, unknown>)) {
      const p = `axes.${k}.subSignals.${id}`;
      if (!isObj(s)) fail(p, "must be an object");
      const so = s as Record<string, unknown>;
      expectKeys(so, ["curve", "weights", ...("pillarOnly" in so ? ["pillarOnly"] : []), ...("curves" in so ? ["curves"] : [])], p);
      if ("pillarOnly" in so && typeof so.pillarOnly !== "boolean") fail(`${p}.pillarOnly`, "must be a boolean");
      let curves: Partial<Record<Role, CurvePoints>> | undefined;
      if ("curves" in so) {
        if (!isObj(so.curves)) fail(`${p}.curves`, "must be an object");
        curves = {};
        for (const [r, c] of Object.entries(so.curves as Record<string, unknown>)) {
          if (!(ROLES as readonly string[]).includes(r)) fail(`${p}.curves.${r}`, "unknown role");
          curves[r as Role] = checkCurve(c, `${p}.curves.${r}`, 0, 100);
        }
      }
      outSubs[id] = {
        curve: checkCurve(so.curve, `${p}.curve`, 0, 100),
        ...(curves ? { curves } : {}),
        weights: checkWeights(so.weights, `${p}.weights`),
        ...(so.pillarOnly === true ? { pillarOnly: true } : {}),
      };
    }
    axes[k] = { subSignals: outSubs };
  }

  if (!isObj(obj.axisWeights)) fail("axisWeights", "must be an object");
  expectKeys(obj.axisWeights as Record<string, unknown>, ROLES, "axisWeights");
  const axisWeights = {} as EvaluationConfig["axisWeights"];
  for (const r of ROLES) {
    const w = (obj.axisWeights as Record<string, unknown>)[r];
    if (!isObj(w)) fail(`axisWeights.${r}`, "must be an object");
    expectKeys(w as Record<string, unknown>, AXIS_KEYS, `axisWeights.${r}`);
    const out = {} as Record<AxisKey, number>;
    for (const k of AXIS_KEYS) out[k] = checkNumber((w as Record<string, unknown>)[k], `axisWeights.${r}.${k}`);
    axisWeights[r] = out;
  }

  if (!isObj(obj.globalCurve)) fail("globalCurve", "must be an object");
  expectKeys(obj.globalCurve as Record<string, unknown>, ROLES, "globalCurve");
  const globalCurve = {} as EvaluationConfig["globalCurve"];
  for (const r of ROLES) {
    const c = checkCurve((obj.globalCurve as Record<string, unknown>)[r], `globalCurve.${r}`, 0, 100);
    // A falling segment would rank a better raw score below a worse one.
    for (let i = 1; i < c.length; i++) if (c[i]![1] < c[i - 1]![1]) fail(`globalCurve.${r}`, `y must not decrease (at index ${i})`);
    globalCurve[r] = c;
  }

  if (!isObj(obj.reference)) fail("reference", "must be an object");
  expectKeys(obj.reference as Record<string, unknown>, ROLES, "reference");
  const known = new Set(AXIS_KEYS.flatMap((k) => Object.keys(defaultAxes[k].subSignals).map((id) => `${k}.${id}`)));
  const finite = (v: unknown, path: string): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fail(path, "must be a finite number");
  const reference = {} as EvaluationConfig["reference"];
  for (const r of ROLES) {
    const byRole = (obj.reference as Record<string, unknown>)[r];
    if (!isObj(byRole)) fail(`reference.${r}`, "must be an object");
    reference[r] = {};
    for (const [src, ref] of Object.entries(byRole as Record<string, unknown>)) {
      const p = `reference.${r}.${src}`;
      if (!known.has(src)) fail(p, "unknown source");
      if (!isObj(ref)) fail(p, "must be an object");
      expectKeys(ref as Record<string, unknown>, ["x", "value"], p);
      reference[r][src] = { x: finite((ref as Record<string, unknown>).x, `${p}.x`), value: finite((ref as Record<string, unknown>).value, `${p}.value`) };
    }
  }

  if (!isObj(obj.verdict)) fail("verdict", "must be an object");
  expectKeys(obj.verdict as Record<string, unknown>, ["invite", "maybe", "minRuns"], "verdict");
  const vd = obj.verdict as Record<string, unknown>;
  const verdict = { invite: checkNumber(vd.invite, "verdict.invite"), maybe: checkNumber(vd.maybe, "verdict.maybe"), minRuns: checkNumber(vd.minRuns, "verdict.minRuns") };
  if (verdict.maybe > verdict.invite) fail("verdict.maybe", "must be ≤ verdict.invite");

  if (!isObj(obj.confidence)) fail("confidence", "must be an object");
  expectKeys(obj.confidence as Record<string, unknown>, ["high", "medium", "consistencyMinRuns", "deepdiveMinRuns"], "confidence");
  const cf = obj.confidence as Record<string, unknown>;
  const confidence = {
    high: checkNumber(cf.high, "confidence.high"),
    medium: checkNumber(cf.medium, "confidence.medium"),
    consistencyMinRuns: checkNumber(cf.consistencyMinRuns, "confidence.consistencyMinRuns"),
    deepdiveMinRuns: checkNumber(cf.deepdiveMinRuns, "confidence.deepdiveMinRuns"),
  };

  let shrinkage: EvaluationConfig["shrinkage"];
  if ("shrinkage" in obj) {
    if (!isObj(obj.shrinkage)) fail("shrinkage", "must be an object");
    shrinkage = {};
    for (const [r, byRole] of Object.entries(obj.shrinkage as Record<string, unknown>)) {
      if (!(ROLES as readonly string[]).includes(r)) fail(`shrinkage.${r}`, "unknown role");
      if (!isObj(byRole)) fail(`shrinkage.${r}`, "must be an object");
      const out: Record<string, number> = {};
      for (const [src, k] of Object.entries(byRole as Record<string, unknown>)) {
        if (!known.has(src)) fail(`shrinkage.${r}.${src}`, "unknown source");
        out[src] = checkNumber(k, `shrinkage.${r}.${src}`);
      }
      shrinkage[r as Role] = out;
    }
  }

  return { version: obj.version as string, levelScale, expectedIlvl, axes, axisWeights, globalCurve, reference, verdict, confidence, ...(shrinkage ? { shrinkage } : {}) };
}

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

/** First 8 hex chars of SHA-256 over canonical (sorted-key) JSON. */
export const configVersion = (cfg: EvaluationConfig): string =>
  new Bun.CryptoHasher("sha256").update(canonical(cfg)).digest("hex").slice(0, 8);

export const LEGACY_EXPERIENCE_NOTICE = "the experience axis was removed — its keys are ignored";
/** The warning of a pre-v7 user file that validated once its experience keys were dropped (the loader's other warnings' style). */
export const legacyExperienceWarning = (userPath: string): string => `bmpl: ${userPath}: ${LEGACY_EXPERIENCE_NOTICE}`;

/** Drops a pre-v7 user file's `experience` keys (`axes.experience`, `axisWeights.<role>.experience`,
 * `reference.<role>["experience.<id>"]`) instead of failing validation on them. Never mutates its input. */
export function dropLegacyExperience(override: unknown): { override: unknown; dropped: boolean } {
  if (!isObj(override)) return { override, dropped: false };
  const out = structuredClone(override);
  let dropped = false;
  if (isObj(out.axes) && "experience" in out.axes) { delete out.axes.experience; dropped = true; }
  for (const section of ["axisWeights", "reference"] as const) {
    const byRole = out[section];
    if (!isObj(byRole)) continue;
    for (const r of Object.values(byRole)) {
      if (!isObj(r)) continue;
      for (const k of Object.keys(r)) if (k === "experience" || k.startsWith("experience.")) { delete r[k]; dropped = true; }
    }
  }
  return { override: out, dropped };
}

/** Default config, deep-merged with the user's file when it exists and is valid. */
export async function loadConfig(userPath: string | null): Promise<{ config: EvaluationConfig; warning?: string }> {
  const base = validateConfig(DEFAULT_CONFIG);
  if (!userPath) return { config: base };
  const file = Bun.file(userPath);
  if (!(await file.exists())) return { config: base };
  let override: unknown;
  try {
    override = JSON.parse(await file.text());
  } catch (e) {
    return { config: base, warning: `bmpl: ignoring ${userPath}: not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  const legacy = dropLegacyExperience(override);
  try {
    const config = validateConfig(mergeUserConfig(DEFAULT_CONFIG, legacy.override));
    return legacy.dropped ? { config, warning: legacyExperienceWarning(userPath) } : { config };
  } catch (e) {
    // The file is ignored for another reason: the experience notice still goes with it, so it is not lost on the fix.
    const also = legacy.dropped ? `; also, ${LEGACY_EXPERIENCE_NOTICE}` : "";
    return { config: base, warning: `bmpl: ignoring ${userPath}: ${e instanceof Error ? e.message : String(e)}${also}` };
  }
}

let cached: Promise<EvaluationConfig> | null = null;
/** Process-wide effective config (user override next to .env, if any). Warns once on stderr. */
export const getEvalConfig = (): Promise<EvaluationConfig> => {
  if (!cached) {
    cached = resolveEvalConfigPath().then(loadConfig).then((r) => {
      if (r.warning) console.error(r.warning);
      return r.config;
    });
  }
  return cached;
};
