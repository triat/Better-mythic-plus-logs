// The personal page (self-review spec, decision 8; canvas MeMainFirst, variant C). Pure: no React, no fetch.
import type { HistoryItem, MyCharacter, PillarKey, Region, SeasonView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { fmtAge } from "./format.ts";
import { isRegion } from "./regions.ts";
import { MAX_ME, PILLAR_ORDER, scoreBand, trendView, type Band, type TrendView } from "./self.ts";

// The front's copy of src/util.ts realmToSlug (runtime code from src/ cannot be imported here); me.test.ts pins the
// two on the same samples.
const stripLatinDiacritics = (s: string): string =>
  [...s].map((ch) => {
    const dec = ch.normalize("NFKD");
    return /^[a-z0-9]/.test(dec) ? dec.replace(/[̀-ͯ]/g, "") : ch;
  }).join("");
export const slugOf = (realm: string): string =>
  stripLatinDiacritics(realm.trim().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())
    .replace(/['‘’ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

const NAME = /^\p{L}{2,32}$/u;
const RIO = /raider\.io\/characters\/([a-z]{2})\/([^/?#]+)\/([^/?#]+)/i;
const sameId = (a: MyCharacter, b: MyCharacter): boolean =>
  a.region === b.region && a.realm.toLowerCase() === b.realm.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();

function make(name: string, realm: string, region: Region): MyCharacter | null {
  const n = name.trim();
  const slug = slugOf(realm);
  if (!NAME.test(n) || slug.length < 2 || slug.length > 32) return null;
  return { name: n[0]!.toLocaleUpperCase() + n.slice(1).toLocaleLowerCase(), realm: slug, region, source: "manual" };
}

/** "Name-Realm" (the region chip's region) or a Raider.IO character link (its own region). */
export function parseEntry(raw: string, region: Region): MyCharacter | null {
  const s = raw.trim();
  const m = RIO.exec(s);
  if (m) {
    const r = m[1]!.toLowerCase();
    return isRegion(r) ? make(decodeURIComponent(m[3]!), decodeURIComponent(m[2]!), r) : null;
  }
  const i = s.lastIndexOf("-");
  return i <= 0 || i === s.length - 1 ? null : make(s.slice(0, i), s.slice(i + 1), region);
}

export function addCharacter(list: MyCharacter[], c: MyCharacter): { ok: true; list: MyCharacter[] } | { ok: false; error: "duplicate" | "full" } {
  if (list.some((x) => sameId(x, c))) return { ok: false, error: "duplicate" };
  if (list.length >= MAX_ME) return { ok: false, error: "full" };
  return { ok: true, list: [...list, c] };
}
export const makeMain = (list: MyCharacter[], i: number): MyCharacter[] => [list[i]!, ...list.filter((_, j) => j !== i)];
export const removeAt = (list: MyCharacter[], i: number): MyCharacter[] => list.filter((_, j) => j !== i);

/** Whether a lookup request is for one of the member's characters (the server checks it again when hosted). */
export const mineRequest = (list: MyCharacter[], character: string, region: Region): boolean => {
  const c = parseEntry(character, region);
  return c !== null && list.some((x) => sameId(x, c));
};

/** What the search field gets: a Raider.IO link, which carries the character's own region (the server's rule). */
export const lookupQuery = (c: MyCharacter): string =>
  `https://raider.io/characters/${c.region}/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name)}`;

/** The most recent history tab for the character (history is newest first), by Name-Realm or Raider.IO link. */
export function historyKeyFor(items: HistoryItem[], c: MyCharacter): string | null {
  for (const it of items) {
    if (it.request.region !== c.region) continue;
    const raw = it.request.character.trim();
    const m = RIO.exec(raw);
    const found = m ? make(decodeURIComponent(m[3]!), decodeURIComponent(m[2]!), c.region) : parseEntry(raw, c.region);
    if (found && sameId(found, c)) return it.key;
  }
  return null;
}

export function seasonLine(t: T, season: SeasonView | null, now = Date.now()): string {
  if (!season) return t("me.noSeason");
  const s = season.state;
  return t("me.seasonLine", {
    runs: s.runs,
    state: s.pending > 0 ? t("me.notAnalysed", { n: s.pending }) : t("me.allAnalysed"),
    checked: season.checkedAt !== null ? t("me.checked", { age: fmtAge(t, season.checkedAt, now) }) : "",
  });
}

const pillarsOf = (season: SeasonView | null) => season?.recent?.pillars ?? season?.season?.pillars ?? [];

export interface MainPillar { key: PillarKey; title: string; score: string; band: Band; trend: TrendView }

/** The main card's five tiles: the 4-week window when there is one, else the whole season. */
export const mainPillars = (t: T, season: SeasonView | null): MainPillar[] =>
  PILLAR_ORDER.map((key) => {
    const s = pillarsOf(season).find((p) => p.key === key)?.score ?? null;
    return {
      key,
      title: t(`self.pillars.${key}`),
      score: s === null ? t("self.pillar.na") : String(s),
      band: scoreBand(s),
      // No stored season yet: no trend line at all, rather than five "not enough runs (0)".
      trend: !season ? { text: "", cls: "faint" } : key === "control" && s === null ? { text: t("self.pillar.controlNote"), cls: "faint" } : trendView(t, season?.trends.find((x) => x.key === key)),
    };
  });

/** An other character's five small cells; "—" until a season is stored or a pillar has data. */
export const rowCells = (season: SeasonView | null): { text: string; band: Band }[] =>
  PILLAR_ORDER.map((key) => {
    const s = pillarsOf(season).find((p) => p.key === key)?.score ?? null;
    return { text: s === null ? "—" : String(s), band: scoreBand(s) };
  });
