// Per-user lookup history in SQLite (hosted mode). Same semantics as the in-memory `History`
// (src/server-history.ts): keys use the effective level, an auto request remembers the level it
// resolved to, a cache hit moves the entry to the newest position, the oldest is evicted past the
// cap. Plus one hosted-only rule: a fresh entry of *another* user for the same key counts as a
// cache hit (copied into the caller's history), so two members vetting the same applicant cost
// one WCL fetch.
import type { Database } from "bun:sqlite";
import { cacheKey, requestFromJson } from "../server-history.ts";
import type { HistoryEntry, HistoryListItem, HistoryRecord, HistoryRequest, HistoryStore } from "../server-history.ts";
import type { Region } from "../wow/regions.ts";

export const HISTORY_MAX_PER_USER = 20;
/** Another user's entry is reused only while younger than this. */
export const SHARED_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

export interface UserHistoryRepo {
  /** A `HistoryStore` bound to one user. `now` is injectable for tests. */
  forUser(userId: number, now?: () => number): HistoryStore;
}

interface ItemRaw { key: string; request: string; label: string; char_class: number; spec: string | null; target_level: number; target_auto: number; fetched_at: number }
interface EntryRaw extends ItemRaw { payload: string }

const ITEM_COLUMNS = "key, request, label, char_class, spec, target_level, target_auto, fetched_at";

const item = (r: ItemRaw, defaultRegion: Region): HistoryListItem => ({
  key: r.key,
  request: requestFromJson(r.request, defaultRegion),
  fetchedAt: r.fetched_at,
  label: r.label,
  charClass: r.char_class,
  spec: r.spec,
  targetLevel: r.target_level,
  targetAutoDetected: r.target_auto === 1,
});
const entry = (r: EntryRaw, defaultRegion: Region): HistoryEntry => ({ ...item(r, defaultRegion), result: JSON.parse(r.payload) as unknown });
const asRecord = (e: HistoryEntry): HistoryRecord =>
  ({ result: e.result, label: e.label, charClass: e.charClass, spec: e.spec, targetLevel: e.targetLevel, targetAutoDetected: e.targetAutoDetected });

/** Table pair backing a repo: the hosted per-user tables, or local mode's FK-free copies in the signals store. */
export interface HistoryTables { history: string; auto: string }
export const USER_HISTORY_TABLES: HistoryTables = { history: "user_history", auto: "user_history_auto" };

/**
 * Rows stored before the region travelled with the request have a 4-element key (`["char",18,"",""]`)
 * and a request without `region`: they would never hit again and would sit next to a duplicate tab.
 * One-shot and idempotent: append the instance default to every 4-element key/alias and set it on the
 * request. SQLite's JSON1 minifies its output exactly like `JSON.stringify`, so the migrated key equals
 * `cacheKey()`'s. A 4-element row whose migrated key already exists for the same user (looked up again
 * since the upgrade) is dropped: the newer row wins.
 */
function migrateRegionlessKeys(db: Database, tables: HistoryTables, defaultRegion: Region): void {
  const T = tables.history;
  const A = tables.auto;
  db.transaction(() => {
    db.run(
      `DELETE FROM ${T} WHERE json_array_length(key) = 4
         AND EXISTS (SELECT 1 FROM ${T} t2 WHERE t2.user_id = ${T}.user_id AND t2.key = json_insert(${T}.key, '$[4]', ?))`,
      [defaultRegion],
    );
    db.run(
      `UPDATE ${T} SET key = json_insert(key, '$[4]', ?), request = json_set(request, '$.region', ?) WHERE json_array_length(key) = 4`,
      [defaultRegion, defaultRegion],
    );
    db.run(
      `DELETE FROM ${A} WHERE json_array_length(alias_key) = 4
         AND EXISTS (SELECT 1 FROM ${A} a2 WHERE a2.user_id = ${A}.user_id AND a2.alias_key = json_insert(${A}.alias_key, '$[4]', ?))`,
      [defaultRegion],
    );
    db.run(`UPDATE ${A} SET alias_key = json_insert(alias_key, '$[4]', ?) WHERE json_array_length(alias_key) = 4`, [defaultRegion]);
  })();
}

/** `defaultRegion` (the instance default) completes rows that predate the region — at open, then on read. */
export function openUserHistory(db: Database, max: number, tables: HistoryTables, defaultRegion: Region): UserHistoryRepo {
  const T = tables.history;
  const A = tables.auto;
  migrateRegionlessKeys(db, tables, defaultRegion);
  const toItem = (r: ItemRaw) => item(r, defaultRegion);
  const toEntry = (r: EntryRaw) => entry(r, defaultRegion);
  const getOne = db.query<EntryRaw, [number, string]>(`SELECT ${ITEM_COLUMNS}, payload FROM ${T} WHERE user_id = ? AND key = ?`);
  const listAll = db.query<ItemRaw, [number]>(`SELECT ${ITEM_COLUMNS} FROM ${T} WHERE user_id = ? ORDER BY seq DESC`);
  const count = db.query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM ${T} WHERE user_id = ?`);
  const nextSeq = db.query<{ n: number }, [number]>(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ${T} WHERE user_id = ?`);
  const oldest = db.query<ItemRaw, [number]>(`SELECT ${ITEM_COLUMNS} FROM ${T} WHERE user_id = ? ORDER BY seq ASC LIMIT 1`);
  const touch = db.query(`UPDATE ${T} SET seq = ? WHERE user_id = ? AND key = ?`);
  const upsert = db.query(
    `INSERT INTO ${T} (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET request = excluded.request, payload = excluded.payload, label = excluded.label,
       char_class = excluded.char_class, spec = excluded.spec, target_level = excluded.target_level,
       target_auto = excluded.target_auto, fetched_at = excluded.fetched_at, seq = excluded.seq`,
  );
  const setPayload = db.query(`UPDATE ${T} SET payload = ? WHERE user_id = ? AND key = ?`);
  const deleteOne = db.query(`DELETE FROM ${T} WHERE user_id = ? AND key = ?`);
  const deleteAll = db.query(`DELETE FROM ${T} WHERE user_id = ?`);
  const sharedNewest = db.query<EntryRaw, [string, number, number]>(
    `SELECT ${ITEM_COLUMNS}, payload FROM ${T} WHERE key = ? AND fetched_at >= ? AND user_id <> ? ORDER BY fetched_at DESC LIMIT 1`,
  );

  const autoGet = db.query<{ level: number }, [number, string]>(`SELECT level FROM ${A} WHERE user_id = ? AND alias_key = ?`);
  const autoNewest = db.query<{ level: number }, [string, number]>(`SELECT level FROM ${A} WHERE alias_key = ? AND set_at >= ? ORDER BY set_at DESC LIMIT 1`);
  const autoSet = db.query(`INSERT INTO ${A} (user_id, alias_key, level, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, alias_key) DO UPDATE SET level = excluded.level, set_at = excluded.set_at`);
  const autoDeleteIf = db.query(`DELETE FROM ${A} WHERE user_id = ? AND alias_key = ? AND level = ?`);
  const autoDeleteAll = db.query(`DELETE FROM ${A} WHERE user_id = ?`);

  return {
    forUser(userId, now = Date.now) {
      // Drop the auto alias only if it pointed at this entry (mirrors History.forget).
      const forget = (e: ItemRaw): void => {
        deleteOne.run(userId, e.key);
        autoDeleteIf.run(userId, cacheKey({ ...requestFromJson(e.request, defaultRegion), level: null }), e.target_level);
      };

      const write = (r: HistoryRequest, rec: HistoryRecord, fetchedAt: number): HistoryEntry => {
        const key = cacheKey({ ...r, level: rec.targetLevel });
        if (r.level === null) {
          const aliasKey = cacheKey(r);
          const previous = autoGet.get(userId, aliasKey)?.level;
          // The auto-detected level moved: drop the stale auto entry (never an explicit one).
          if (previous !== undefined && previous !== rec.targetLevel) {
            const old = getOne.get(userId, cacheKey({ ...r, level: previous }));
            if (old && old.target_auto === 1) deleteOne.run(userId, old.key);
          }
          autoSet.run(userId, aliasKey, rec.targetLevel, fetchedAt);
        }
        upsert.run(userId, key, JSON.stringify(r), JSON.stringify(rec.result), rec.label, rec.charClass, rec.spec, rec.targetLevel, rec.targetAutoDetected ? 1 : 0, fetchedAt, nextSeq.get(userId)!.n);
        while (count.get(userId)!.n > max) {
          const o = oldest.get(userId);
          if (!o) break;
          forget(o);
        }
        return { key, request: r, fetchedAt, ...rec };
      };
      const record = db.transaction((r: HistoryRequest, rec: HistoryRecord, fetchedAt: number) => write(r, rec, fetchedAt));

      /** Effective key for a request, or null when an auto request has not been resolved yet. */
      const resolveKey = (r: HistoryRequest): string | null => {
        if (r.level !== null) return cacheKey(r);
        const level = autoGet.get(userId, cacheKey(r))?.level;
        return level === undefined ? null : cacheKey({ ...r, level });
      };

      /** Another user's fresh entry for the same request, or null. Auto requests follow the newest alias any user set. */
      const shared = (r: HistoryRequest): HistoryEntry | null => {
        const since = now() - SHARED_HISTORY_TTL_MS;
        const level = r.level ?? autoNewest.get(cacheKey(r), since)?.level;
        if (level === undefined) return null;
        const row = sharedNewest.get(cacheKey({ ...r, level }), since, userId);
        return row ? toEntry(row) : null;
      };

      return {
        get size() { return count.get(userId)!.n; },
        cached(r) {
          const key = resolveKey(r);
          const own = key === null ? null : getOne.get(userId, key);
          if (own) {
            touch.run(nextSeq.get(userId)!.n, userId, key!);
            return toEntry(own);
          }
          const other = shared(r);
          // The copy reflects the caller's own request, not the other user's: an explicit request
          // copying an auto-resolved row must not inherit that row's "auto" badge.
          return other ? record(r, { ...asRecord(other), targetAutoDetected: r.level === null }, other.fetchedAt) : null;
        },
        record: (r, rec) => record(r, rec, now()),
        get(key) {
          const row = getOne.get(userId, key);
          return row ? toEntry(row) : undefined;
        },
        list: () => listAll.all(userId).map(toItem),
        remove(key) {
          const row = getOne.get(userId, key);
          if (!row) return false;
          forget(row);
          return true;
        },
        clear() {
          deleteAll.run(userId);
          autoDeleteAll.run(userId);
        },
        updateResult(key, result) { setPayload.run(JSON.stringify(result), userId, key); },
      };
    },
  };
}
