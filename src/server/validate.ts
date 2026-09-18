// One validator for every JSON body the server accepts (issue #9): explicit shapes, unknown fields refused,
// numbers finite, integers where the domain is integer. Pure; the routes call parseBody().
import { DISCORD_ID } from "../hosted/config.ts";
import { KEY_MAX, KEY_MIN } from "../hosted/settings-limits.ts"; // moved out of routes-user.ts (which now imports them from here too) — no validate ↔ routes cycle

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Schema<T> { parse(v: unknown, path: string): Result<T> }

const fail = (error: string): Result<never> => ({ ok: false, error });
const label = (path: string) => `\`${path}\``;

export const str = (o: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Schema<string> => ({
  parse(v, path) {
    if (typeof v !== "string") return fail(`${label(path)} must be a string`);
    const s = o.trim ? v.trim() : v;
    if (o.min !== undefined && s.length < o.min) return fail(`${label(path)} must be at least ${o.min} characters`);
    if (o.max !== undefined && s.length > o.max) return fail(`${label(path)} must be at most ${o.max} characters`);
    if (o.pattern && !o.pattern.test(s)) return fail(`${label(path)} is not valid`);
    return { ok: true, value: s };
  },
});
const bounded = (v: number, path: string, o: { min?: number; max?: number }): Result<number> => {
  if (o.min !== undefined && v < o.min) return fail(`${label(path)} must be at least ${o.min}`);
  if (o.max !== undefined && v > o.max) return fail(`${label(path)} must be at most ${o.max}`);
  return { ok: true, value: v };
};
export const int = (o: { min?: number; max?: number } = {}): Schema<number> => ({
  parse: (v, path) => (typeof v === "number" && Number.isInteger(v) ? bounded(v, path, o) : fail(`${label(path)} must be an integer`)),
});
export const num = (o: { min?: number; max?: number } = {}): Schema<number> => ({
  parse: (v, path) => (typeof v === "number" && Number.isFinite(v) ? bounded(v, path, o) : fail(`${label(path)} must be a number`)),
});
export const bool = (): Schema<boolean> => ({ parse: (v, path) => (typeof v === "boolean" ? { ok: true, value: v } : fail(`${label(path)} must be a boolean`)) });
export const oneOf = <T extends string>(values: readonly T[]): Schema<T> => ({
  parse: (v, path) => (typeof v === "string" && (values as readonly string[]).includes(v) ? { ok: true, value: v as T } : fail(`${label(path)} must be one of ${values.join(", ")}`)),
});
/** Absent or `undefined` is fine; the key is then left out of the value. */
export const opt = <T>(s: Schema<T>): Schema<T | undefined> & { optional: true } => ({ optional: true, parse: (v, path) => (v === undefined ? { ok: true, value: undefined } : s.parse(v, path)) });
export const nullable = <T>(s: Schema<T>): Schema<T | null> => ({ parse: (v, path) => (v === null ? { ok: true, value: null } : s.parse(v, path)) });
export const any = (): Schema<unknown> => ({ parse: (v) => ({ ok: true, value: v }) });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The shape obj() produces: a field built with opt() becomes an optional key on the result type (not
// just a `| undefined` value), so a caller never has to cast `b.value` after parseBody().
type Infer<S> = S extends Schema<infer T> ? T : never;
type OptionalKeys<F> = { [K in keyof F]: F[K] extends { optional: true } ? K : never }[keyof F];
type ObjShape<F> = { [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]> } & { [K in OptionalKeys<F> & keyof F]?: Infer<F[K]> };

export const obj = <F extends Record<string, Schema<unknown>>>(fields: F): Schema<ObjShape<F>> => ({
  parse(v, path) {
    if (!isObj(v)) return fail(path ? `${label(path)} must be an object` : "Body must be a JSON object");
    for (const k of Object.keys(v)) if (!Object.hasOwn(fields, k)) return fail(`Unexpected field \`${path ? `${path}.` : ""}${k}\``);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(fields)) {
      const schema = fields[k] as Schema<unknown> & { optional?: true };
      const sub = path ? `${path}.${k}` : k;
      if (!(k in v) || v[k] === undefined) {
        if (schema.optional) continue;
        return fail(`${label(sub)} is required`);
      }
      const r = schema.parse(v[k], sub);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out as ObjShape<F> };
  },
});

/** Reads and validates a JSON body. `emptyAs` turns an empty body into that value first (the watcher's `{}`). */
export async function parseBody<T>(req: Request, schema: Schema<T>, emptyAs?: unknown): Promise<Result<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" && emptyAs !== undefined ? emptyAs : JSON.parse(text);
  } catch {
    return fail("Invalid JSON body");
  }
  return schema.parse(raw, "");
}

export const WOW_NAME = /^\p{L}{2,32}$/u;
export const WOW_REALM = /^[\p{L}\d' -]{2,32}$/u;
const METRIC = ["dps", "hps"] as const;
export const LOOKUP_BODY = obj({ character: str({ min: 1, max: 200, trim: true }), level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32, trim: true }))), metric: opt(nullable(oneOf(METRIC))), refresh: opt(bool()) });
export const DEEPDIVE_BODY = obj({ reportCode: str({ min: 1, max: 32, pattern: /^[A-Za-z0-9]+$/ }), fightID: int({ min: 1, max: 100_000 }), character: str({ min: 1, max: 64, trim: true }), force: opt(bool()) });
export const DEFENSIVES_BODY = obj({ className: str({ min: 1, max: 32, trim: true }), spec: str({ min: 1, max: 32, trim: true }), patch: obj({ id: int({ min: 1 }), name: opt(str({ min: 1, max: 64 })), cooldownS: opt(num({ min: 0 })), durationS: opt(num({ min: 0 })), kind: opt(oneOf(["major", "immunity", "minor"] as const)), ignore: opt(bool()) }) });
export const SETTINGS_BODY = obj({ yourKey: opt(nullable(int({ min: KEY_MIN, max: KEY_MAX }))), legendOpen: opt(bool()) });
export const INVITE_BODY = obj({ discordId: str({ pattern: DISCORD_ID }), note: opt(nullable(str({ max: 200, trim: true }))) });
export const NOTE_BODY = obj({ note: opt(nullable(str({ max: 500, trim: true }))) });
export const ROLE_BODY = obj({ role: oneOf(["member", "admin"] as const) });
export const SETUP_BODY = obj({ clientId: str({ min: 1, max: 200, trim: true }), clientSecret: str({ min: 1, max: 200, trim: true }) });
export const WATCH_BODY = obj({ level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32, trim: true }))), metric: opt(nullable(oneOf(METRIC))) });
