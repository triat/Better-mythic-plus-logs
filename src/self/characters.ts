// "Me" (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 1): up to twenty characters per
// member (docs/superpowers/specs/2026-10-11-battlenet-linking-design.md). `manual` entries are added by hand (local
// mode); `bnet` entries come only from the Battle.net import, which writes them itself — the hosted
// PUT /api/settings may only reorder or remove stored entries (restrictToStored).
import { realmToSlug } from "../util.ts";
import { isRegion, type Region } from "../wow/regions.ts";

// Same patterns as src/server/validate.ts (WOW_NAME, WOW_REALM), duplicated so validate.ts can import
// MAX_CHARACTERS without a cycle; test/self/characters.test.ts pins them equal.
const NAME = /^\p{L}{2,32}$/u;
const REALM = /^[\p{L}\d' -]{2,32}$/u;
export const CHARACTER_PATTERNS = { name: NAME, realm: REALM };

export const MAX_CHARACTERS = 20;
export type CharacterSource = "manual" | "bnet";
export interface MyCharacter {
  name: string;
  /** The WCL realm slug (`payload.character.realmSlug`); Blizzard's `realm.slug` for a `bnet` entry. */
  realm: string;
  region: Region;
  source: CharacterSource;
  /** `bnet` only: Blizzard's character id, the key of the 30-day status check. */
  bnetId?: number;
  /** `bnet` only: last successful status check (or the pick), epoch ms. */
  verifiedAt?: number;
}

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

const isCharacter = (v: unknown): v is MyCharacter => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && NAME.test(o.name) && typeof o.realm === "string" && REALM.test(o.realm)
    && isRegion(o.region) && (o.source === "manual" || o.source === "bnet")
    && (o.source !== "bnet" || (posInt(o.bnetId) && posInt(o.verifiedAt)));
};

/** Identity of a character in the list: region, then realm and name case-insensitively. */
export const characterKey = (c: { name: string; realm: string; region: Region }): string =>
  `${c.region}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;

/** The stored JSON column, defensively: invalid entries dropped, duplicates removed (first kept), capped. */
export function parseCharacters(raw: string | null): MyCharacter[] {
  if (raw === null) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: MyCharacter[] = [];
  for (const c of v) {
    if (!isCharacter(c) || seen.has(characterKey(c))) continue;
    seen.add(characterKey(c));
    out.push(c.source === "bnet"
      ? { name: c.name, realm: c.realm, region: c.region, source: "bnet", bnetId: c.bnetId!, verifiedAt: c.verifiedAt! }
      : { name: c.name, realm: c.realm, region: c.region, source: "manual" });
    if (out.length === MAX_CHARACTERS) break;
  }
  return out;
}

/** Hosted PUT /api/settings (Battle.net spec, decision 4): a reorder or a subset of the stored list, never an addition.
 * The stored objects in `next`'s order, or null when `next` holds an entry absent from `stored`. */
export function restrictToStored(
  next: readonly { name: string; realm: string; region: Region }[],
  stored: readonly MyCharacter[],
): MyCharacter[] | null {
  const byKey = new Map(stored.map((c) => [characterKey(c), c]));
  const out: MyCharacter[] = [];
  for (const c of next) {
    const s = byKey.get(characterKey(c));
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/** Whether a looked-up `Name-Realm` (any realm spelling, any name case) is in the member's list. */
export const ownsCharacter = (list: readonly MyCharacter[], c: { name: string; realm: string; region: Region }): boolean => {
  const realm = realmToSlug(c.realm);
  const name = c.name.toLowerCase();
  return list.some((x) => x.region === c.region && x.realm.toLowerCase() === realm && x.name.toLowerCase() === name);
};
