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
        const entry = history.cached({
          character: p.character,
          level: b.value.level,
          spec: null,
          metric: null,
          region: p.region ?? config.region,
        });
        const evaluation = (entry?.result as { evaluation?: Evaluation } | undefined)?.evaluation;
        if (!entry || !evaluation) return null;
        return {
          character: p.character,
          verdict: evaluation.verdict,
          score: evaluation.global,
          targetLevel: evaluation.targetLevel,
          fetchedAt: entry.fetchedAt,
        };
      });
      return jsonResponse({ ok: true, verdicts });
    }),
  ];
}
