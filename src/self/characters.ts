// "Me" (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 1): up to five characters per
// member. Phase 1 has manual entries only; `bnet` is reserved for the Battle.net import, which writes them itself —
// PUT /api/settings never accepts one.
import { realmToSlug } from "../util.ts";
import { isRegion, type Region } from "../wow/regions.ts";

// Same patterns as src/server/validate.ts (WOW_NAME, WOW_REALM), duplicated so validate.ts can import
// MAX_CHARACTERS without a cycle; test/self/characters.test.ts pins them equal.
const NAME = /^\p{L}{2,32}$/u;
const REALM = /^[\p{L}\d' -]{2,32}$/u;
export const CHARACTER_PATTERNS = { name: NAME, realm: REALM };

export const MAX_CHARACTERS = 5;
export type CharacterSource = "manual" | "bnet";
export interface MyCharacter {
  name: string;
  /** The WCL realm slug (`payload.character.realmSlug`). */
  realm: string;
  region: Region;
  source: CharacterSource;
}

const isCharacter = (v: unknown): v is MyCharacter => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && NAME.test(o.name) && typeof o.realm === "string" && REALM.test(o.realm)
    && isRegion(o.region) && (o.source === "manual" || o.source === "bnet");
};

const idOf = (c: MyCharacter): string => `${c.region}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;

/** The stored JSON column, defensively: invalid entries dropped, duplicates removed (first kept), capped. */
export function parseCharacters(raw: string | null): MyCharacter[] {
  if (raw === null) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: MyCharacter[] = [];
  for (const c of v) {
    if (!isCharacter(c) || seen.has(idOf(c))) continue;
    seen.add(idOf(c));
    out.push({ name: c.name, realm: c.realm, region: c.region, source: c.source });
    if (out.length === MAX_CHARACTERS) break;
  }
  return out;
}

/** Whether a looked-up `Name-Realm` (any realm spelling, any name case) is in the member's list. */
export const ownsCharacter = (list: readonly MyCharacter[], c: { name: string; realm: string; region: Region }): boolean => {
  const realm = realmToSlug(c.realm);
  const name = c.name.toLowerCase();
  return list.some((x) => x.region === c.region && x.realm.toLowerCase() === realm && x.name.toLowerCase() === name);
};
