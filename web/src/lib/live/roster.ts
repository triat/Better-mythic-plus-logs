// Frames → roster, then the view's ordering and filtering. Pure.
import type { LiveFrame } from "./codec.ts";

export type LiveRole = "tank" | "healer" | "dps";
export const LIVE_ROLES: readonly LiveRole[] = ["tank", "healer", "dps"];
export type LiveSort = "arrival" | "verdict" | "score" | "role" | "class";
export const LIVE_SORTS: readonly LiveSort[] = ["arrival", "verdict", "score", "role", "class"];
export const isLiveRole = (v: unknown): v is LiveRole => typeof v === "string" && (LIVE_ROLES as readonly string[]).includes(v);
export const isLiveSort = (v: unknown): v is LiveSort => typeof v === "string" && (LIVE_SORTS as readonly string[]).includes(v);

/** A roster older than this is not shown (the strip is gone: the Group Finder was closed). */
export const ROSTER_STALE_MS = 10_000;

export interface RosterPlayer {
  /**
   * The addon's line kind: `applicant` (`a`), `party` (`p`, another group member) or `self` (`s`, the
   * player's own character). `self` behaves exactly like `party` everywhere that separates applicants
   * from the group (never sorted/filtered as an applicant, never auto-queued) — it is only ever
   * distinguished to show the "you" label instead of a verdict/Check button (review round 1, finding 5;
   * Task 8's addon brief carries the `s`-for-self / `p`-for-others line-format contract).
   */
  kind: "applicant" | "party" | "self";
  name: string;
  realm: string;
  /** `Name-Realm`, the form every bmpl lookup takes. */
  character: string;
  className: string;
  spec: string;
  role: LiveRole;
  /** Declared Raider.IO score, 0 when the game did not give one. */
  score: number;
  /** Position in the strip; applicants are listed oldest first. */
  index: number;
}

export interface Roster { seq: number; players: RosterPlayer[]; at: number }

/** What `POST /api/live/cached` returns per player (Task 4). */
export interface CachedVerdict {
  verdict: "invite" | "maybe" | "pass" | "insufficient";
  score: number | null;
  targetLevel: number;
  fetchedAt: number;
}

const ROLE_OF: Record<string, LiveRole> = { T: "tank", H: "healer", D: "dps" };
const NAME_REALM = /^[^|]{1,24}-[^|]{1,32}$/;

export function parseRoster(text: string): RosterPlayer[] {
  const players: RosterPlayer[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split("|");
    if (parts.length !== 6) continue;
    const [kind, character, className, spec, role, score] = parts as [string, string, string, string, string, string];
    if ((kind !== "a" && kind !== "p" && kind !== "s") || !NAME_REALM.test(character) || !ROLE_OF[role] || !className || !spec) continue;
    const dash = character.lastIndexOf("-");
    players.push({
      kind: kind === "a" ? "applicant" : kind === "p" ? "party" : "self",
      name: character.slice(0, dash),
      realm: character.slice(dash + 1),
      character,
      className,
      spec,
      role: ROLE_OF[role]!,
      score: Number.isFinite(Number(score)) ? Math.max(0, Math.trunc(Number(score))) : 0,
      index: players.length,
    });
  }
  return players;
}

/** Collects the chunks of one roster sequence; a new sequence replaces an unfinished one. */
export class RosterAssembler {
  private seq: number | null = null;
  private chunks = new Map<number, Uint8Array>();
  private count = 0;
  private roster: Roster | null = null;

  /** Returns the roster on the frame that completes it, otherwise null. */
  push(f: LiveFrame, at: number): Roster | null {
    if (f.rosterSeq !== this.seq) {
      this.seq = f.rosterSeq;
      this.chunks = new Map();
      this.count = f.chunkCount;
    }
    if (this.roster?.seq === f.rosterSeq) return null; // already assembled
    this.chunks.set(f.chunkIndex, f.payload);
    if (this.chunks.size < this.count) return null;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < this.count; i++) parts.push(this.chunks.get(i)!);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { joined.set(p, o); o += p.length; }
    this.roster = { seq: f.rosterSeq, players: parseRoster(new TextDecoder().decode(joined)), at };
    return this.roster;
  }

  current(at: number): Roster | null {
    return this.roster && at - this.roster.at < ROSTER_STALE_MS ? this.roster : null;
  }
}

const VERDICT_RANK: Record<CachedVerdict["verdict"], number> = { invite: 0, maybe: 1, pass: 2, insufficient: 3 };
const ROLE_RANK: Record<LiveRole, number> = { tank: 0, healer: 1, dps: 2 };

export function sortApplicants(players: readonly RosterPlayer[], sort: LiveSort, verdictOf: (character: string) => CachedVerdict | null): RosterPlayer[] {
  const newestFirst = (a: RosterPlayer, b: RosterPlayer) => b.index - a.index;
  const list = [...players];
  switch (sort) {
    case "arrival":
      return list.sort(newestFirst);
    case "verdict":
      return list.sort((a, b) => {
        const va = verdictOf(a.character);
        const vb = verdictOf(b.character);
        const ra = va ? VERDICT_RANK[va.verdict] : 4;
        const rb = vb ? VERDICT_RANK[vb.verdict] : 4;
        return ra - rb || (vb?.score ?? -1) - (va?.score ?? -1) || newestFirst(a, b);
      });
    case "score":
      return list.sort((a, b) => b.score - a.score || newestFirst(a, b));
    case "role":
      return list.sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || newestFirst(a, b));
    case "class":
      return list.sort((a, b) => a.className.localeCompare(b.className) || newestFirst(a, b));
  }
}

export function filterApplicants(players: readonly RosterPlayer[], f: { roles: readonly LiveRole[]; classes: readonly string[] }): RosterPlayer[] {
  return players.filter((p) => f.roles.includes(p.role) && (f.classes.length === 0 || f.classes.includes(p.className)));
}
