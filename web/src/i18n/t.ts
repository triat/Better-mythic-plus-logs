import type { Locale } from "../lib/locale.ts";
import { fmtNumber, pluralCategory } from "../lib/locale.ts";
import { en } from "./en.ts";

export type Dictionary = typeof en;
/** The same tree with every leaf widened to string — what fr.ts must satisfy. */
export type Mirror<D> = { [K in keyof D]: D[K] extends string ? string : Mirror<D[K]> };
type Leaves<D, P extends string = ""> = { [K in keyof D & string]: D[K] extends string ? `${P}${K}` : Leaves<D[K], `${P}${K}.`> }[keyof D & string];
export type MessageKey = Leaves<Dictionary>;
export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

/** Dotted paths of every leaf, in declaration order — the parity test and the missing-key lookup use it. */
export function leafKeys(dict: object, prefix = ""): string[] {
  return Object.entries(dict).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : leafKeys(v as object, `${prefix}${k}.`)));
}

const PLURAL = /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g;
const PARAM = /\{(\w+)\}/g;

/** {name} → the param (numbers per locale); {count, plural, one {…} other {…}} → the branch, # → the count. */
export function formatMessage(locale: Locale, message: string, params: Params = {}): string {
  const fmt = (v: string | number): string => (typeof v === "number" ? fmtNumber(locale, v) : v);
  const withPlurals = message.replace(PLURAL, (_m, name: string, one: string, other: string) => {
    const v = params[name];
    if (typeof v !== "number") return other.replaceAll("#", v === undefined ? "?" : String(v));
    return (pluralCategory(locale, v) === "one" ? one : other).replaceAll("#", fmt(v));
  });
  return withPlurals.replace(PARAM, (m, name: string) => (name in params ? fmt(params[name]!) : m));
}

const lookup = (dict: object, key: string): string | undefined =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict) as string | undefined;

/** A translator bound to one dictionary and locale. A missing key returns the key: never throws, easy to spot on screen. */
export function makeT(dict: Mirror<Dictionary>, locale: Locale): T {
  return (key, params) => {
    const m = lookup(dict, key);
    return m === undefined ? key : formatMessage(locale, m, params);
  };
}

/** English translator for tests: assertions keep the strings they had before the locale work. */
export const tEn: T = makeT(en, "en");
