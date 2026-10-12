// src/server/routes-live.ts
// The Live panel's only server call: names → the verdicts bmpl already has. Never touches WCL.
import { config } from "../config.ts";
import type { Evaluation } from "../evaluation/types.ts";
import { parseNameRealm } from "../util.ts";
import { jsonResponse } from "./http.ts";
import { historyOf } from "./lookup.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { LIVE_CACHED_BODY, parseBody } from "./validate.ts";

export interface LiveVerdict {
  character: string;
  verdict: Evaluation["verdict"];
  score: number | null;
  targetLevel: number;
  fetchedAt: number;
  /** The spec the cached lookup was for, else the payload's character spec. */
  spec: string | null;
  /** The payload's equipped item level, when it holds a finite number. */
  ilvl: number | null;
}

export function liveRoutes(): Route[] {
  return [
    route("POST", "/api/live/cached", async (req, _url, rc) => {
      const b = await parseBody(req, LIVE_CACHED_BODY);
      if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
      const history = historyOf(rc);
      const verdicts = b.value.players.map((p): LiveVerdict | null => {
        // `LIVE_PLAYER`'s CHARACTER regex allows a trailing "-" inside the 32-char realm
        // group (e.g. "A-B-"), which parseNameRealm() then rejects (its lastIndexOf() split
        // lands on the very last char) — so this guard is not dead code, just a rare shape
        // the regex alone doesn't rule out.
        const parsed = parseNameRealm(p.character);
        if (!parsed) return null;
        // Contract: the caller sends each player's *effective* region (the same
        // effectiveRegion(settings.region, status.region) the front uses for every other
        // lookup), not left to default. `config.region` here is only the instance-default
        // dead-letter fallback for a caller that omits it — cacheKey() embeds region, so a
        // mismatch against the region the entry was actually cached under reads as a silent
        // "not in history" (null), not an error.
        // `peek`, never `cached`: this route runs automatically on every roster change with up to 40
        // names. `cached()` writes (recency bump, and hosted it copies another member's entry into the
        // caller's history, pruning to HISTORY_MAX_PER_USER), which would evict the member's real
        // lookups and persist applicant names the spec says only live for the request's duration.
        const entry = history.peek({
          character: p.character,
          level: b.value.level,
          spec: null,
          metric: null,
          region: p.region ?? config.region,
        });
        const result = entry?.result as
          | { evaluation?: Evaluation; character?: { spec?: unknown }; summary?: { ilvl?: unknown } }
          | undefined;
        const evaluation = result?.evaluation;
        if (!entry || !evaluation) return null;
        // Spec and ilvl come from the payload already in memory (no new read, 0 WCL pts); read defensively.
        const payloadSpec = result?.character?.spec;
        const ilvl = result?.summary?.ilvl;
        // The verdict and score are the history row's (kept in step with today's re-evaluation by `syncSummary`), so
        // Live shows what Récents shows; a row without a verdict is INSUFFICIENT DATA. The level is the payload's.
        return {
          character: p.character,
          verdict: entry.verdict ?? "insufficient",
          score: entry.score,
          targetLevel: evaluation.targetLevel,
          fetchedAt: entry.fetchedAt,
          spec: entry.spec ?? (typeof payloadSpec === "string" ? payloadSpec : null),
          ilvl: typeof ilvl === "number" && Number.isFinite(ilvl) ? ilvl : null,
        };
      });
      return jsonResponse({ ok: true, verdicts });
    }),
  ];
}
