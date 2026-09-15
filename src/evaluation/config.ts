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
  expectKeys(obj, ["version", "levelScale", "expectedIlvl", "axes", "axisWeights", "verdict", "confidence"], "config");
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
      expectKeys(s as Record<string, unknown>, ["curve", "weights"], p);
      outSubs[id] = {
        curve: checkCurve((s as Record<string, unknown>).curve, `${p}.curve`, 0, 100),
        weights: checkWeights((s as Record<string, unknown>).weights, `${p}.weights`),
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

  if (!isObj(obj.verdict)) fail("verdict", "must be an object");
  expectKeys(obj.verdict as Record<string, unknown>, ["invite", "maybe", "minRuns"], "verdict");
  const vd = obj.verdict as Record<string, unknown>;
  const verdict = { invite: checkNumber(vd.invite, "verdict.invite"), maybe: checkNumber(vd.maybe, "verdict.maybe"), minRuns: checkNumber(vd.minRuns, "verdict.minRuns") };
  if (verdict.maybe > verdict.invite) fail("verdict.maybe", "must be ≤ verdict.invite");

  if (!isObj(obj.confidence)) fail("confidence", "must be an object");
  expectKeys(obj.confidence as Record<string, unknown>, ["high", "medium", "consistencyMinRuns"], "confidence");
  const cf = obj.confidence as Record<string, unknown>;
  const confidence = { high: checkNumber(cf.high, "confidence.high"), medium: checkNumber(cf.medium, "confidence.medium"), consistencyMinRuns: checkNumber(cf.consistencyMinRuns, "confidence.consistencyMinRuns") };

  return { version: obj.version as string, levelScale, expectedIlvl, axes, axisWeights, verdict, confidence };
}

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

/** First 8 hex chars of SHA-256 over canonical (sorted-key) JSON. */
export const configVersion = (cfg: EvaluationConfig): string =>
  new Bun.CryptoHasher("sha256").update(canonical(cfg)).digest("hex").slice(0, 8);

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
  try {
    return { config: validateConfig(deepMerge(DEFAULT_CONFIG, override)) };
  } catch (e) {
    return { config: base, warning: `bmpl: ignoring ${userPath}: ${e instanceof Error ? e.message : String(e)}` };
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
