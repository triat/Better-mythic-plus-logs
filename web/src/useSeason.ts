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
 * The season of one character (GET /api/season, 0 pts), reloaded when the character or `reloadKey` changes — the
 * result page passes its payload object, which `reloadActive` in App replaces after a deep-dive. The sync loops one batch per request (decision 3) until
 * nothing is pending, a batch fetches nothing, an error, or Cancel; leaving the page stops it, and the next sync
 * resumes from the cache.
 */
export function useSeason(who: SeasonWho, self: SelfActions, reloadKey?: unknown): SeasonState {
  const [view, setView] = useState<SeasonView | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SeasonState["progress"]>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const id = `${who.region}|${who.realm}|${who.name}|${who.level ?? ""}`;

  const load = useCallback(async () => {
    const r = await api.season(who);
    if (r.ok) setView(r.season);
    setLoading(false);
  }, [id, reloadKey]);

  useEffect(() => {
    setLoading(true);
    setView(null);
    void load();
    return () => { cancelled.current = true; };
  }, [load]);

  const start = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setError(null);
    let done = 0;
    let pts = 0;
    let total = view?.state.pending ?? 0;
    let refresh = true;
    setProgress({ done, total, pts });
    while (!cancelled.current) {
      const r = await api.seasonSync({ name: who.name, realm: who.realm, region: who.region, refresh });
      refresh = false;
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
    stop: () => { cancelled.current = true; },
  };
}
