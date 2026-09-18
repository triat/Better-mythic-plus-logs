import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SHIPPED, specDefensives } from "../../src/deepdive/table.ts";
import { openHosted } from "../../src/hosted/db.ts";
import { decide, propose, tablesFor } from "../../src/hosted/defensives.ts";

const HOLY = { className: "Paladin", spec: "Holy" };
const DP = 498; // Divine Protection, shipped Paladin:Holy, cd 60

function setup() {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const mk = (discordId: string, role: "member" | "admin") =>
    hosted.users.upsertFromDiscord({ discordId, username: "u" + discordId.slice(-2), globalName: null, avatarHash: null }, role, 0);
  const tom = mk("100000000000000001", "member");
  const bob = mk("100000000000000002", "member");
  const boss = mk("100000000000000003", "admin");
  const repo = hosted.defensives;
  const entry = (userId: number | null, id = DP) => specDefensives(SHIPPED, tablesFor(repo, userId).override, HOLY.className, HOLY.spec).entries.find((e) => e.id === id);
  return { db, hosted, repo, tom, bob, boss, entry };
}

describe("tablesFor", () => {
  test("without any layer it is the shipped table, source shared, no path", () => {
    const { repo, tom } = setup();
    const t = tablesFor(repo, tom.id);
    expect(t.source).toBe("shared");
    expect(t.overridePath).toBeNull();
    expect(t.override).toEqual({});
    expect(t.shipped).toBe(SHIPPED);
  });
});

describe("propose / decide lifecycle", () => {
  test("a member's proposal applies to the author immediately (pending) and to nobody else", () => {
    const { repo, tom, bob, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ key: "Paladin:Holy", spellId: DP, patch: { id: DP, cooldownS: 45 }, proposedBy: tom.id, status: "pending", createdAt: 1000, decidedBy: null, decidedAt: null, note: null });
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(entry(bob.id)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    expect(entry(null)).toMatchObject({ cooldownS: 60, origin: "shipped" });
  });

  test("a second proposal for the same spell merges into the pending row (dedupe)", () => {
    const { repo, tom, entry } = setup();
    const first = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    const second = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, durationS: 9 }, 2000);
    expect(first.ok && second.ok && first.proposal.id === second.proposal.id).toBe(true);
    if (second.ok) expect(second.proposal.patch).toEqual({ id: DP, cooldownS: 45, durationS: 9 });
    expect(repo.pendingOf(tom.id).length).toBe(1);
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "pending" });
    const ignore = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 3000);
    if (ignore.ok) expect(ignore.proposal.patch).toEqual({ id: DP, ignore: true });
    expect(entry(tom.id)).toBeUndefined();
  });

  test("approval moves the correction to the shared layer for everyone; the author's row is no longer pending", () => {
    const { repo, tom, bob, boss, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (!r.ok) throw new Error(r.error);
    const decided = decide(repo, r.proposal.id, boss, "approved", "matches the tooltip", 5000);
    expect(decided).toMatchObject({ id: r.proposal.id, status: "approved", decidedBy: boss.id, decidedAt: 5000, note: "matches the tooltip" });
    expect(entry(bob.id)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(entry(null)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(repo.shared()).toEqual({ "Paladin:Holy": [{ id: DP, cooldownS: 45, origin: "shared" }] });
    expect(repo.pendingOf(tom.id)).toEqual([]);
    expect(decide(repo, r.proposal.id, boss, "rejected", null, 6000)).toBeNull(); // already decided
    expect(decide(repo, 9999, boss, "approved", null, 6000)).toBeNull();
  });

  test("a later approval merges over the shared entry; an approved ignore removes it", () => {
    const { repo, tom, boss, entry } = setup();
    const a = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (a.ok) decide(repo, a.proposal.id, boss, "approved", null, 2000);
    const b = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, durationS: 9 }, 3000);
    if (b.ok) decide(repo, b.proposal.id, boss, "approved", null, 4000);
    expect(repo.shared()["Paladin:Holy"]).toEqual([{ id: DP, cooldownS: 45, durationS: 9, origin: "shared" }]);
    const c = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 5000);
    if (c.ok) decide(repo, c.proposal.id, boss, "approved", null, 6000);
    expect(entry(null)).toBeUndefined();
    expect(specDefensives(SHIPPED, tablesFor(repo, null).override, "Paladin", "Holy").ignored).toEqual([DP]);
  });

  test("rejection drops the correction for the author and keeps the note in their proposals", () => {
    const { repo, tom, boss, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 1000);
    if (!r.ok) throw new Error(r.error);
    expect(entry(tom.id)).toBeUndefined();
    decide(repo, r.proposal.id, boss, "rejected", "Divine Protection is a real defensive", 2000);
    expect(entry(tom.id)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    expect(repo.proposalsOf(tom.id, "Paladin:Holy").map((p) => [p.status, p.note])).toEqual([["rejected", "Divine Protection is a real defensive"]]);
  });

  test("an admin's proposal is approved on the spot", () => {
    const { repo, bob, boss, entry } = setup();
    const r = propose(repo, boss, HOLY.className, HOLY.spec, { id: DP, cooldownS: 50 }, 1000);
    expect(r.ok && r.proposal.status === "approved" && r.proposal.decidedBy === boss.id && r.proposal.decidedAt === 1000).toBe(true);
    expect(entry(bob.id)).toMatchObject({ cooldownS: 50, origin: "shared" });
    expect(repo.pendingOf(boss.id)).toEqual([]);
  });

  test("invalid or incomplete patches are refused with the validator's message; nothing is stored", () => {
    const { repo, tom } = setup();
    const bad = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, kind: "huge" }, 1000);
    expect(bad).toMatchObject({ ok: false, status: 400 });
    if (!bad.ok) expect(bad.error).toMatch(/kind/);
    const incomplete = propose(repo, tom, HOLY.className, HOLY.spec, { id: 999999, cooldownS: 30 }, 1000);
    if (!incomplete.ok) expect(incomplete.error).toMatch(/999999/);
    expect(repo.pendingOf(tom.id)).toEqual([]);
    const unknownKey = propose(repo, tom, "Paladin", "Not A Spec", { id: DP, cooldownS: 30 }, 1000);
    expect(unknownKey.ok).toBe(false); // "Paladin:NotASpec" has no table: an existing id patch is still refused as unknown
  });

  test("listProposals joins the proposer's username and filters by status", () => {
    const { repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    expect(repo.listProposals("pending").map((p) => [p.id, p.username])).toEqual([[r.ok ? r.proposal.id : -1, "u01"]]);
    if (r.ok) decide(repo, r.proposal.id, boss, "approved", null, 2000);
    expect(repo.listProposals("pending")).toEqual([]);
    expect(repo.listProposals("approved").length).toBe(1);
  });

  test("deleting a proposer cascades their proposals; approvals survive an admin's deletion", () => {
    const { db, repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (r.ok) decide(repo, r.proposal.id, boss, "approved", null, 2000);
    db.run("DELETE FROM users WHERE id = ?", [boss.id]);
    expect(repo.shared()["Paladin:Holy"]?.[0]).toMatchObject({ id: DP, cooldownS: 45 });
    db.run("DELETE FROM users WHERE id = ?", [tom.id]);
    expect(repo.listProposals("approved")).toEqual([]);
  });

  test("deciding an already-decided proposal refuses and leaves defensives_shared unchanged", () => {
    const { repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (!r.ok) throw new Error(r.error);
    decide(repo, r.proposal.id, boss, "approved", null, 2000);
    const before = repo.shared();
    expect(decide(repo, r.proposal.id, boss, "rejected", "too late", 3000)).toBeNull();
    expect(repo.shared()).toEqual(before);
  });

  test("if upsertShared throws inside the transaction, the decision is not recorded either", () => {
    const { repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (!r.ok) throw new Error(r.error);
    repo.upsertShared = () => { throw new Error("boom"); };
    expect(() => decide(repo, r.proposal.id, boss, "approved", null, 2000)).toThrow("boom");
    expect(repo.proposalById(r.proposal.id)).toMatchObject({ status: "pending" });
  });

  test("a member's pending patch after a shared ignore starts over", () => {
    const { repo, tom, boss } = setup();
    const ignored = propose(repo, boss, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 1000);
    expect(ignored.ok && ignored.proposal.status === "approved").toBe(true);
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, name: "Divine Protection", cooldownS: 45, durationS: 8, kind: "major" }, 2000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const forTom = specDefensives(SHIPPED, tablesFor(repo, tom.id).override, HOLY.className, HOLY.spec);
    expect(forTom.entries.find((e) => e.id === DP)).toMatchObject({ cooldownS: 45, origin: "pending" });
    const forNobody = specDefensives(SHIPPED, tablesFor(repo, null).override, HOLY.className, HOLY.spec);
    expect(forNobody.entries.find((e) => e.id === DP)).toBeUndefined();
    expect(forNobody.ignored).toEqual([DP]);
  });
});
