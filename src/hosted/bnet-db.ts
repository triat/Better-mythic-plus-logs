// Battle.net linking storage (spec docs/superpowers/specs/2026-10-11-battlenet-linking-design.md): the link, the
// one-hour candidate list of an import, the labels the 30-day check removed, and the launch migration.
import type { Database } from "bun:sqlite";
import { parseCharacters, type MyCharacter } from "../self/characters.ts";
import type { Region } from "../wow/regions.ts";

export const BNET_IMPORT_TTL_MS = 60 * 60 * 1000;

/** One character of the account as `/profile/user/wow` lists it, already checked against bmpl's name/realm rules. */
export interface BnetCandidate { bnetId: number; name: string; realm: string; realmName: string; region: Region; level: number; classID: number | null }
export interface BnetLink { userId: number; accountId: string; battletag: string | null; linkedAt: number; removed: string[] }

export interface BnetRepo {
  link: {
    get(userId: number): BnetLink | null;
    byAccount(accountId: string): number | null;
    /**
     * Upserts the member's link (a new import refreshes the BattleTag); throws when another member holds `accountId`.
     * Linking a different account first unlinks the old one (its import and its `bnet` characters go), so a member
     * never keeps characters of an account they no longer hold (decision 5).
     */
    put(userId: number, accountId: string, battletag: string | null, now: number): void;
  };
  imports: {
    put(userId: number, candidates: BnetCandidate[], now: number): void;
    /** The member's import, or null when absent or older than BNET_IMPORT_TTL_MS (an expired row is deleted). */
    get(userId: number, now: number): { candidates: BnetCandidate[]; createdAt: number } | null;
    delete(userId: number): void;
  };
  /** `Name-Realm` labels the check round removed, shown on /me until the next pick or unlink. */
  removed: { add(userId: number, labels: string[]): void; clear(userId: number): void };
  /** Every member whose list holds a `bnet` entry, with the whole parsed list (the check round's input). */
  withBnetCharacters(): Array<{ userId: number; characters: MyCharacter[] }>;
  /** DELETE /api/bnet: the link, any import, and the `bnet` entries of the list. */
  unlink(userId: number, now: number): void;
}

interface LinkRaw { user_id: number; account_id: string; battletag: string | null; linked_at: number; removed: string | null }
interface ImportRaw { candidates: string; created_at: number }
interface CharactersRaw { user_id: number; characters: string | null }

/** The `removed` column, defensively: anything but an array of strings reads as empty. */
const parseLabels = (raw: string | null): string[] => {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};
const link = (r: LinkRaw): BnetLink =>
  ({ userId: r.user_id, accountId: r.account_id, battletag: r.battletag, linkedAt: r.linked_at, removed: parseLabels(r.removed) });

export function openBnet(db: Database): BnetRepo {
  const linkGet = db.query<LinkRaw, [number]>("SELECT * FROM user_bnet WHERE user_id = ?");
  const linkByAccount = db.query<{ user_id: number }, [string]>("SELECT user_id FROM user_bnet WHERE account_id = ?");
  const linkPut = db.query(
    "INSERT INTO user_bnet (user_id, account_id, battletag, linked_at, removed) VALUES (?, ?, ?, ?, NULL) " +
    "ON CONFLICT(user_id) DO UPDATE SET account_id = excluded.account_id, battletag = excluded.battletag",
  );
  const linkDelete = db.query("DELETE FROM user_bnet WHERE user_id = ?");
  const removedSet = db.query("UPDATE user_bnet SET removed = ? WHERE user_id = ?");
  const importPut = db.query(
    "INSERT INTO bnet_imports (user_id, candidates, created_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET candidates = excluded.candidates, created_at = excluded.created_at",
  );
  const importGet = db.query<ImportRaw, [number]>("SELECT candidates, created_at FROM bnet_imports WHERE user_id = ?");
  const importDelete = db.query("DELETE FROM bnet_imports WHERE user_id = ?");
  const charactersGet = db.query<{ characters: string | null }, [number]>("SELECT characters FROM user_settings WHERE user_id = ?");
  const charactersSet = db.query("UPDATE user_settings SET characters = ?, updated_at = ? WHERE user_id = ?");
  // A cheap pre-filter on the JSON column; parseCharacters decides.
  const withBnet = db.query<CharactersRaw, []>(`SELECT user_id, characters FROM user_settings WHERE characters LIKE '%"bnet"%' ORDER BY user_id`);

  const unlink = db.transaction((userId: number, now: number) => {
    linkDelete.run(userId);
    importDelete.run(userId);
    const r = charactersGet.get(userId);
    if (!r) return;
    const all = parseCharacters(r.characters);
    const kept = all.filter((c) => c.source !== "bnet");
    if (kept.length !== all.length) charactersSet.run(JSON.stringify(kept), now, userId);
  });

  const put = db.transaction((userId: number, accountId: string, battletag: string | null, now: number) => {
    const current = linkGet.get(userId);
    if (current && current.account_id !== accountId) unlink(userId, now);
    linkPut.run(userId, accountId, battletag, now);
  });

  return {
    link: {
      get(userId) { const r = linkGet.get(userId); return r ? link(r) : null; },
      byAccount: (accountId) => linkByAccount.get(accountId)?.user_id ?? null,
      put(userId, accountId, battletag, now) { put(userId, accountId, battletag, now); },
    },
    imports: {
      put(userId, candidates, now) { importPut.run(userId, JSON.stringify(candidates), now); },
      get(userId, now) {
        const r = importGet.get(userId);
        if (!r) return null;
        if (now - r.created_at > BNET_IMPORT_TTL_MS) { importDelete.run(userId); return null; }
        return { candidates: JSON.parse(r.candidates) as BnetCandidate[], createdAt: r.created_at };
      },
      delete(userId) { importDelete.run(userId); },
    },
    removed: {
      add(userId, labels) {
        const r = linkGet.get(userId);
        if (r) removedSet.run(JSON.stringify([...parseLabels(r.removed), ...labels]), userId);
      },
      clear(userId) { removedSet.run(null, userId); },
    },
    withBnetCharacters: () =>
      withBnet.all()
        .map((r) => ({ userId: r.user_id, characters: parseCharacters(r.characters) }))
        .filter((r) => r.characters.some((c) => c.source === "bnet")),
    unlink(userId, now) { unlink(userId, now); },
  };
}

/**
 * Battle.net spec, decision 7: every `manual` entry leaves the hosted lists, one `characters_reset` audit row per
 * member touched. Self-detecting and idempotent (run by openHosted at every start): once no stored list holds a
 * `manual` entry it writes nothing. Returns the number of members touched.
 */
export function resetManualCharacters(db: Database, now: number): number {
  const rows = db.query<CharactersRaw, []>(`SELECT user_id, characters FROM user_settings WHERE characters LIKE '%"manual"%'`);
  const set = db.query("UPDATE user_settings SET characters = ?, updated_at = ? WHERE user_id = ?");
  const audit = db.query("INSERT INTO audit_log (at, user_id, action, target, detail, ip) VALUES (?, ?, 'characters_reset', ?, ?, NULL)");
  return db.transaction(() => {
    let touched = 0;
    for (const r of rows.all()) {
      const all = parseCharacters(r.characters);
      const kept = all.filter((c) => c.source !== "manual");
      if (kept.length === all.length) continue;
      set.run(JSON.stringify(kept), now, r.user_id);
      audit.run(now, r.user_id, `user ${r.user_id}`, JSON.stringify({ removed: all.length - kept.length }));
      touched++;
    }
    return touched;
  })();
}
