// web/src/lib/live/roster.test.ts
import { describe, expect, test } from "bun:test";
import { chunkRoster } from "./codec.ts";
import { RosterAssembler, ROSTER_STALE_MS, filterApplicants, parseRoster, sortApplicants } from "./roster.ts";
import type { CachedVerdict, RosterPlayer } from "./roster.ts";

const TEXT =
  "a|Biwaadrood-Nerzhul|Druid|Restoration|H|3412\n" +
  "a|Tankadin-Hyjal|Paladin|Protection|T|2890\n" +
  "a|Sombrelame-Dalaran|DemonHunter|Havoc|D|3105\n" +
  "p|Muleyoxo-Hyjal|Monk|Windwalker|D|3240\n";

describe("parseRoster", () => {
  test("reads every field and keeps the strip order", () => {
    const players = parseRoster(TEXT);
    expect(players.length).toBe(4);
    expect(players[0]).toEqual({ kind: "applicant", name: "Biwaadrood", realm: "Nerzhul", character: "Biwaadrood-Nerzhul", className: "Druid", spec: "Restoration", role: "healer", score: 3412, index: 0 });
    expect(players[3]!.kind).toBe("party");
    expect(players[2]!.className).toBe("DemonHunter");
  });
  test("skips malformed lines instead of throwing", () => {
    expect(parseRoster("a|broken\n\nx|Nope-Realm|Druid|Feral|D|0\na|Ok-Realm|Druid|Feral|D|12\n").map((p) => p.name)).toEqual(["Ok"]);
  });
});

describe("RosterAssembler", () => {
  test("completes a multi-chunk roster, ignores duplicates and out-of-order chunks", () => {
    const frames = chunkRoster(TEXT, 3);
    expect(frames.length).toBeGreaterThan(1);
    const a = new RosterAssembler();
    const shuffled = [...frames].reverse();
    let roster = null;
    for (const f of shuffled) roster = a.push(f, 1000) ?? roster;
    expect(roster!.seq).toBe(3);
    expect(roster!.players.length).toBe(4);
    expect(a.push(frames[0]!, 1000)).toBeNull(); // already complete: no re-emit
  });
  test("a new sequence drops the unfinished one", () => {
    const a = new RosterAssembler();
    const long = chunkRoster(TEXT, 1);
    a.push(long[0]!, 0);
    for (const f of chunkRoster("a|Solo-Realm|Mage|Frost|D|1\n", 2)) a.push(f, 10);
    expect(a.current(10)!.seq).toBe(2);
  });
  test("goes stale after 10 s", () => {
    const a = new RosterAssembler();
    for (const f of chunkRoster("a|Solo-Realm|Mage|Frost|D|1\n", 5)) a.push(f, 1_000);
    expect(a.current(1_000 + ROSTER_STALE_MS - 1)).not.toBeNull();
    expect(a.current(1_000 + ROSTER_STALE_MS)).toBeNull();
  });
});

describe("sortApplicants / filterApplicants", () => {
  const players = parseRoster(TEXT);
  const applicants = players.filter((p) => p.kind === "applicant");
  const verdicts: Record<string, CachedVerdict> = {
    "Biwaadrood-Nerzhul": { verdict: "maybe", score: 54, targetLevel: 18, fetchedAt: 0 },
    "Tankadin-Hyjal": { verdict: "invite", score: 78, targetLevel: 18, fetchedAt: 0 },
  };
  const verdictOf = (c: string): CachedVerdict | null => verdicts[c] ?? null;
  const names = (list: RosterPlayer[]) => list.map((p) => p.name);

  test("arrival is newest first", () => {
    expect(names(sortApplicants(applicants, "arrival", verdictOf))).toEqual(["Sombrelame", "Tankadin", "Biwaadrood"]);
  });
  test("verdict orders invite → maybe → pass → not vetted, ties on arrival", () => {
    expect(names(sortApplicants(applicants, "verdict", verdictOf))).toEqual(["Tankadin", "Biwaadrood", "Sombrelame"]);
  });
  test("score is the declared Raider.IO score, descending", () => {
    expect(names(sortApplicants(applicants, "score", verdictOf))).toEqual(["Biwaadrood", "Sombrelame", "Tankadin"]);
  });
  test("role is tank → heal → dps, then arrival", () => {
    expect(names(sortApplicants(applicants, "role", verdictOf))).toEqual(["Tankadin", "Biwaadrood", "Sombrelame"]);
  });
  test("class is alphabetical on the WCL name", () => {
    expect(names(sortApplicants(applicants, "class", verdictOf))).toEqual(["Sombrelame", "Biwaadrood", "Tankadin"]);
  });
  test("sorting never mutates its input", () => {
    const before = names(applicants);
    sortApplicants(applicants, "score", verdictOf);
    expect(names(applicants)).toEqual(before);
  });
  test("filters by role and by class; empty classes means every class", () => {
    expect(names(filterApplicants(applicants, { roles: ["tank", "healer"], classes: [] }))).toEqual(["Biwaadrood", "Tankadin"]);
    expect(names(filterApplicants(applicants, { roles: ["tank", "healer", "dps"], classes: ["Druid", "DemonHunter"] }))).toEqual(["Biwaadrood", "Sombrelame"]);
    expect(filterApplicants(applicants, { roles: [], classes: [] })).toEqual([]);
  });
});
