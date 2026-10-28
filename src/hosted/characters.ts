// The admin's "Searched characters" page (canvas "bmpl · Personnages recherchés", A + B + C in tabs): every character
// this instance has looked up, from data it already holds (0 WCL pts, nothing new recorded). Members appear only as a
// count, never by name.
//   - character_runs: every character a lookup fetched rankings for (their runs, the best timed key, last seen);
//   - rio_profile: Raider.IO's casing, class, spec, role and season score;
//   - user_history: the newest verdict any member's history holds for the character, and how many members hold one.
// A character whose every history tab was closed keeps its runs and Raider.IO profile, without a verdict.
import type { Database } from "bun:sqlite";
import { HEALER_SPECS, TANK_SPECS } from "../roles.ts";

export type CharacterRole = "tank" | "healer" | "dps";

export interface AdminCharacter {
  region: string;
  /** The realm slug and name, lower-cased, as the tables key them. */
  realm: string;
  name: string;
  /** The best casing known: Raider.IO's, else the history label's, else the key's. */
  displayName: string;
  displayRealm: string;
  /** WCL class id (history), null when no history row holds the character. */
  classId: number | null;
  /** Raider.IO's class name ("Death Knight"). */
  className: string | null;
  spec: string | null;
  role: CharacterRole | null;
  /** The newest verdict in any member's history, with its score and the key level it was computed for. */
  verdict: "invite" | "maybe" | "pass" | null;
  score: number | null;
  targetLevel: number | null;
  /** Members whose history holds the character (a count, never who). */
  members: number;
  /** Newest lookup of the character by any member (history), else the newest Raider.IO fetch, else its runs' last sighting. */
  lookedUpAt: number | null;
  /** Raider.IO's season score ("all"). */
  rio: number | null;
  /** Highest timed key of the newest season with runs, and its dungeon. */
  bestTimed: number | null;
  bestDungeon: string | null;
  runs: number;
}

const roleOfSpec = (spec: string | null): CharacterRole | null =>
  spec === null ? null : HEALER_SPECS.has(spec) ? "healer" : TANK_SPECS.has(spec) ? "tank" : "dps";
const rioRole = (r: string | null): CharacterRole | null =>
  r === "TANK" ? "tank" : r === "HEALING" ? "healer" : r === "DPS" ? "dps" : null;
const VERDICTS = new Set(["invite", "maybe", "pass"]);
const keyOf = (region: string, realm: string, name: string) => `${region}|${realm}|${name}`;

interface HistoryRow {
  user_id: number; region: string | null; realm: string | null; name: string | null; label: string;
  char_class: number; spec: string | null; verdict: string | null; score: number | null; target_level: number; fetched_at: number;
}
interface RioRow {
  region: string; realm: string; name: string; dname: string | null; drealm: string | null; cls: string | null; spec: string | null;
  role: string | null; score: number | null; at: number;
}
interface RunsRow { region: string; realm: string; name: string; zone_id: number; runs: number; seen: number; best: number | null; dungeon: string | null }

export function searchedCharacters(db: Database): AdminCharacter[] {
  // json_extract reads the few fields without parsing whole payloads in JS.
  const history = db.query<HistoryRow, []>(
    "SELECT user_id, json_extract(payload, '$.character.region') AS region, json_extract(payload, '$.character.realmSlug') AS realm, " +
    "json_extract(payload, '$.character.name') AS name, label, char_class, spec, verdict, score, target_level, fetched_at FROM user_history",
  ).all();
  const rio = db.query<RioRow, []>(
    "SELECT region, realm, name, json_extract(json, '$.name') AS dname, json_extract(json, '$.realm') AS drealm, json_extract(json, '$.class') AS cls, " +
    "json_extract(json, '$.active_spec_name') AS spec, json_extract(json, '$.active_spec_role') AS role, " +
    "json_extract(json, '$.mythic_plus_scores_by_season[0].scores.all') AS score, fetched_at AS at FROM rio_profile",
  ).all();
  const runs = db.query<RunsRow, []>(
    "SELECT region, realm, name, zone_id, COUNT(*) AS runs, MAX(seen_at) AS seen, MAX(CASE WHEN timed = 1 THEN key_level END) AS best, " +
    "(SELECT encounter_name FROM character_runs b WHERE b.region = a.region AND b.realm = a.realm AND b.name = a.name AND b.zone_id = a.zone_id AND b.timed = 1 " +
    "ORDER BY b.key_level DESC, b.start_time DESC LIMIT 1) AS dungeon " +
    "FROM character_runs a GROUP BY region, realm, name, zone_id",
  ).all();

  const out = new Map<string, AdminCharacter>();
  const get = (region: string, realm: string, name: string): AdminCharacter => {
    const k = keyOf(region, realm, name);
    let c = out.get(k);
    if (!c) {
      c = {
        region, realm, name, displayName: name, displayRealm: realm, classId: null, className: null, spec: null, role: null,
        verdict: null, score: null, targetLevel: null, members: 0, lookedUpAt: null, rio: null, bestTimed: null, bestDungeon: null, runs: 0,
      };
      out.set(k, c);
    }
    return c;
  };

  // Runs: the newest season (highest zone id) a character has runs in.
  const zoneOf = new Map<string, number>();
  const seenOf = new Map<string, number>();
  for (const r of runs) {
    const k = keyOf(r.region, r.realm, r.name);
    if ((zoneOf.get(k) ?? -1) > r.zone_id) continue;
    zoneOf.set(k, r.zone_id);
    const c = get(r.region, r.realm, r.name);
    c.runs = r.runs;
    c.bestTimed = r.best;
    c.bestDungeon = r.best === null ? null : r.dungeon;
    seenOf.set(k, Math.max(seenOf.get(k) ?? 0, r.seen));
  }

  // History: the newest row wins the verdict; members are counted once each.
  const membersOf = new Map<string, Set<number>>();
  const newest = new Map<string, number>();
  for (const h of history) {
    if (!h.region || !h.realm || !h.name) continue;
    // Lower-cased here, as the store keys them: SQLite's lower() leaves "É" as is, JavaScript's does not.
    const [region, realm, name] = [h.region.toLowerCase(), h.realm.toLowerCase(), h.name.toLowerCase()];
    const k = keyOf(region, realm, name);
    const c = get(region, realm, name);
    let set = membersOf.get(k);
    if (!set) { set = new Set(); membersOf.set(k, set); }
    set.add(h.user_id);
    if ((newest.get(k) ?? -1) >= h.fetched_at) continue;
    newest.set(k, h.fetched_at);
    const dash = h.label.indexOf("-");
    if (dash > 0) { c.displayName = h.label.slice(0, dash); c.displayRealm = h.label.slice(dash + 1); }
    c.classId = h.char_class;
    c.spec = h.spec;
    c.role = roleOfSpec(h.spec);
    c.verdict = h.verdict && VERDICTS.has(h.verdict) ? (h.verdict as AdminCharacter["verdict"]) : null;
    c.score = h.score;
    c.targetLevel = h.target_level;
    c.lookedUpAt = h.fetched_at;
  }
  for (const [k, set] of membersOf) out.get(k)!.members = set.size;

  // Raider.IO: casing, class, season score; spec and role only when no history row named them.
  for (const r of rio) {
    const c = get(r.region, r.realm, r.name);
    if (r.dname) c.displayName = r.dname;
    if (r.drealm) c.displayRealm = r.drealm;
    c.className = r.cls;
    c.rio = typeof r.score === "number" ? Math.round(r.score) : null;
    if (c.spec === null) { c.spec = r.spec; c.role = rioRole(r.role); }
    if (c.lookedUpAt === null) c.lookedUpAt = r.at;
  }

  for (const [k, seen] of seenOf) { const c = out.get(k)!; if (c.lookedUpAt === null) c.lookedUpAt = seen; }

  return [...out.values()].sort((a, b) => (b.lookedUpAt ?? 0) - (a.lookedUpAt ?? 0) || a.name.localeCompare(b.name));
}
