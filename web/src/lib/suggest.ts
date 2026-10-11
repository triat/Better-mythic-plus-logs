// The search field's suggestions (canvas "suggest", SuggestChosen: A + C). Pure: no React, no fetch. Every source is
// already in the page or, locally, in bmpl's own database: suggesting costs no Warcraft Logs point and no external call.
import { CLASS_NAMES, className } from "@shared/wow/classes.ts";
import type { HistoryItem, KnownCharacter, MyCharacter, Region } from "../types.ts";
import { realmName } from "./format.ts";
import { slugOf } from "./me.ts";
import { isRegion } from "./regions.ts";

export interface Suggestion {
  /** Region, realm slug and lower-cased name: one row per character, whichever sources know it. */
  id: string;
  name: string;
  /** The realm as shown ("Tarren Mill"), never its slug. */
  realm: string;
  region: Region;
  charClass: number | null;
  spec: string | null;
  /** What the field gets: "Name-Realm", the form the server parses (a hyphenated slug would split at its last "-"). */
  fill: string;
  /** The character's newest history tab: choosing the row opens it (0 pts) instead of looking the character up. */
  historyKey: string | null;
}

/** Fewer typed letters than this: no list. */
export const SUGGEST_MIN = 2;
export const SUGGEST_MAX = 8;

const fold = (s: string): string => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cap = (n: string): string => n[0]!.toLocaleUpperCase() + n.slice(1).toLocaleLowerCase();
const CLASS_IDS = new Map(Object.entries(CLASS_NAMES).map(([id, name]) => [name, Number(id)]));

function make(name: string, realm: string, region: Region, charClass: number | null, spec: string | null, historyKey: string | null): Suggestion | null {
  const n = name.trim();
  const slug = slugOf(realm);
  if (!n || !slug) return null;
  const shown = realmName(slug);
  return { id: `${region}|${slug}|${n.toLowerCase()}`, name: cap(n), realm: shown, region, charClass, spec, fill: `${cap(n)}-${shown}`, historyKey };
}

// The server stores a history request as "Name-Realm"; a WoW name has no "-" and no space, so the first one ends it.
function fromHistory(it: HistoryItem): Suggestion | null {
  const raw = it.request.character.trim();
  const cut = raw.search(/[-\s]/);
  return cut <= 0 || cut === raw.length - 1 ? null : make(raw.slice(0, cut), raw.slice(cut + 1), it.request.region, it.charClass, it.spec, it.key);
}

function fromCache(k: KnownCharacter): Suggestion | null {
  if (!isRegion(k.region)) return null;
  const s = make(k.displayName ?? k.name, k.realm, k.region, k.className ? CLASS_IDS.get(k.className) ?? null : null, k.spec, null);
  // Raider.IO's own spelling of the realm ("Kel'Thuzad") beats the one rebuilt from the slug.
  return s && k.displayRealm ? { ...s, realm: k.displayRealm, fill: `${s.name}-${k.displayRealm}` } : s;
}

const present = <T>(v: T | null): v is T => v !== null;

/**
 * Every character the field can suggest, best first: My characters (the main first), then history newest first, then,
 * locally, the database's cache newest first (`known` stays empty when hosted). One row per character; a row takes its
 * class and spec from history, else from the cache, and its realm's spelling from the cache.
 */
export function suggestionsOf(characters: MyCharacter[], history: HistoryItem[], known: KnownCharacter[]): Suggestion[] {
  const hist = history.map(fromHistory).filter(present);
  const cache = known.map(fromCache).filter(present);
  const out = new Map<string, Suggestion>();
  const mine = characters.map((c) => make(c.name, c.realm, c.region, null, null, null)).filter(present);
  for (const s of [...mine, ...hist, ...cache]) {
    if (out.has(s.id)) continue;
    const h = hist.find((x) => x.id === s.id);
    const k = cache.find((x) => x.id === s.id);
    const realm = k?.realm ?? s.realm;
    out.set(s.id, {
      ...s, realm, fill: `${s.name}-${realm}`,
      charClass: h?.charClass ?? s.charClass ?? k?.charClass ?? null,
      spec: h?.spec ?? s.spec ?? k?.spec ?? null,
      historyKey: h?.historyKey ?? null,
    });
  }
  return [...out.values()];
}

/**
 * The rows for what is typed: names that start with it, or, past the first "-" or space, that name on realms that start
 * with the rest. No list for a Raider.IO link, nor once the field holds a full Name-Realm of one of them (canvas details).
 */
export function matchSuggestions(all: Suggestion[], typed: string, max = SUGGEST_MAX): Suggestion[] {
  const s = typed.trim();
  if (fold(s).length < SUGGEST_MIN || /raider\.io|\//i.test(s)) return [];
  const cut = s.search(/[-\s]/);
  const name = fold(cut < 0 ? s : s.slice(0, cut));
  const realm = cut < 0 ? null : slugOf(s.slice(cut + 1));
  const hits = all.filter((x) => (realm === null ? fold(x.name).startsWith(name) : fold(x.name) === name && slugOf(x.realm).startsWith(realm)));
  if (realm && hits.some((x) => slugOf(x.realm) === realm)) return [];
  return hits.slice(0, max);
}

/** How many letters of a row's name to show in bold: the typed name, before any realm. */
export function typedNameLength(typed: string): number {
  const s = typed.trim();
  const cut = s.search(/[-\s]/);
  return cut < 0 ? s.length : cut;
}

/** The grey rest of the field (Tab accepts it): what the highlighted row adds to what is typed, if it extends it. */
export function ghostOf(typed: string, s: Suggestion | undefined): string | null {
  if (!s || !typed || s.fill.length <= typed.length) return null;
  return s.fill.toLowerCase().startsWith(typed.toLowerCase()) ? s.fill.slice(typed.length) : null;
}

/** The right-hand column: "Holy Priest", the class alone, or nothing. WCL's spec names have no space ("BeastMastery"). */
export function classLine(s: Suggestion): string {
  if (s.charClass === null) return "";
  return s.spec ? `${s.spec.replace(/([a-z])([A-Z])/g, "$1 $2")} ${className(s.charClass)}` : className(s.charClass);
}
