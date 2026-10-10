import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { LookupPayload, Region, SeasonView } from "./types.ts";
import type { SelfActions } from "./components/self/ResultHead.tsx";

/** Whose season: the result page passes the payload's character and target level, the personal page `level: null`. */
export interface SeasonWho { name: string; realm: string; region: Region; level: number | null }
export const seasonWho = (p: LookupPayload): SeasonWho =>
  ({ name: p.character.name, realm: p.character.realmSlug, region: p.character.region, level: p.targetLevel });

export interface SeasonState {
  view: SeasonView | null;
  loading: boolean;
  syncOpen: boolean;
  openSync: () => void;
  closeSync: () => void;
  running: boolean;
  progress: { done: number; total: number; pts: number } | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * The season of one character (GET /api/season, 0 pts). A new character resets the view and stops a running sync;
 * a new `reloadKey` for the same character (the result page passes its payload, which `reloadActive` in App replaces
 * after a deep-dive) reloads in place, keeping the current view and any running sync. An answer that arrives for an
 * earlier character, or after a newer request, is dropped. The sync loops one batch per request (decision 3; a batch
 * fetches the missing raw reports and crowd control, `state.pending` counts both) until
 * nothing is pending, a batch fetches nothing, an error, Cancel or a character change; the batch already in flight
 * still completes, and the next sync resumes from the cache.
 */
export function useSeason(who: SeasonWho, self: SelfActions, reloadKey?: unknown): SeasonState {
  const [view, setView] = useState<SeasonView | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SeasonState["progress"]>(null);
  const [error, setError] = useState<string | null>(null);
  const stopSync = useRef(false);
  const seq = useRef(0);
  const id = `${who.region}|${who.realm}|${who.name}|${who.level ?? ""}`;
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const asked = id;
    const r = await api.season(who);
    if (seq.current !== mine || idRef.current !== asked) return;
    if (r.ok) setView(r.season);
    setLoading(false);
  }, [id]);

  // Another character: start from an empty view; leaving it (or unmounting) stops its sync.
  useEffect(() => {
    stopSync.current = false;
    setView(null);
    setLoading(true);
    setSyncOpen(false);
    setError(null);
    return () => { stopSync.current = true; };
  }, [id]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const start = useCallback(async () => {
    stopSync.current = false;
    setRunning(true);
    setError(null);
    let done = 0;
    let pts = 0;
    let total = view?.state.pending ?? 0;
    let refresh = true;
    setProgress({ done, total, pts });
    while (!stopSync.current) {
      const r = await api.seasonSync({ name: who.name, realm: who.realm, region: who.region, refresh });
      refresh = false;
      if (stopSync.current) break;
      if (!r.ok) { setError(r.error); break; }
      if (r.ownClient !== undefined) self.setOwnClient(r.ownClient);
      done += r.fetched + r.failed;
      pts += r.pointsSpent;
      total = Math.max(total, done + r.state.pending);
      setProgress({ done, total, pts });
      await load();
      if (r.state.pending === 0 || r.fetched + r.failed === 0) break;
    }
    setRunning(false);
    setProgress(null);
  }, [id, view, load, self]);

  return {
    view, loading, syncOpen, running, progress, error, start,
    openSync: () => setSyncOpen(true),
    closeSync: () => setSyncOpen(false),
    stop: () => { stopSync.current = true; },
  };
}
