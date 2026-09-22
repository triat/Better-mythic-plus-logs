import { describe, expect, test } from "bun:test";
import { History } from "../src/server-history.ts";
import type { RequestContext } from "../src/hosted/auth.ts";
import { liveRoutes } from "../src/server/routes-live.ts";

const payload = (verdict: string, global: number | null, targetLevel: number) => ({
  character: { name: "Biwaadrood", realmSlug: "nerzhul", region: "eu" },
  evaluation: { verdict, global, targetLevel, role: "healer", axes: [], runsUsed: 5, analyzedRuns: 2, configVersion: "test" },
});

function ctxWith(entries: Array<{ character: string; level: number; verdict: string; global: number | null }>, now = 1_000): RequestContext {
  const history = new History(20, () => now);
  for (const e of entries) {
    history.record(
      { character: e.character, level: e.level, spec: null, metric: null, region: "eu" },
      { result: payload(e.verdict, e.global, e.level), label: e.character, charClass: 11, spec: null, targetLevel: e.level, targetAutoDetected: false },
    );
  }
  return { hosted: false, history, user: null, now } as unknown as RequestContext;
}

const post = async (ctx: RequestContext, body: unknown) => {
  const r = liveRoutes()[0]!;
  const req = new Request("http://x/api/live/cached", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const res = await r.handle(req, new URL(req.url), ctx);
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; verdicts?: unknown[] } };
};

describe("POST /api/live/cached", () => {
  test("returns the cached verdict for a known character and null for an unknown one", async () => {
    const ctx = ctxWith([{ character: "Biwaadrood-Nerzhul", level: 18, verdict: "invite", global: 78.4 }]);
    const { status, json } = await post(ctx, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }, { character: "Nobody-Hyjal", region: "eu" }] });
    expect(status).toBe(200);
    expect(json.verdicts![0]).toEqual({ character: "Biwaadrood-Nerzhul", verdict: "invite", score: 78.4, targetLevel: 18, fetchedAt: 1_000 });
    expect(json.verdicts![1]).toBeNull();
  });

  test("a lookup made for another key level is not a hit", async () => {
    const ctx = ctxWith([{ character: "Biwaadrood-Nerzhul", level: 20, verdict: "invite", global: 78 }]);
    const { json } = await post(ctx, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }] });
    expect(json.verdicts![0]).toBeNull();
  });

  test("insufficient data comes back with a null score", async () => {
    const ctx = ctxWith([{ character: "Fresh-Hyjal", level: 18, verdict: "insufficient", global: null }]);
    const { json } = await post(ctx, { level: 18, players: [{ character: "Fresh-Hyjal", region: "eu" }] });
    expect(json.verdicts![0]).toMatchObject({ verdict: "insufficient", score: null });
  });

  test("refuses more than 40 players, an empty list and a malformed character", async () => {
    const ctx = ctxWith([]);
    const many = Array.from({ length: 41 }, (_, i) => ({ character: `A${i}-Hyjal`, region: "eu" as const }));
    expect((await post(ctx, { level: 18, players: many })).status).toBe(400);
    expect((await post(ctx, { level: 18, players: [] })).status).toBe(400);
    expect((await post(ctx, { level: 18, players: [{ character: "no-realm-here|bad", region: "eu" }] })).status).toBe(400);
  });

  test("spends no WCL point: the route never reaches a gql call", async () => {
    const ctx = ctxWith([{ character: "Biwaadrood-Nerzhul", level: 18, verdict: "pass", global: 31 }]);
    const failing = { ...ctx, runtime: { wcl: { gql: () => { throw new Error("WCL must not be called"); } } } } as unknown as RequestContext;
    const { status } = await post(failing, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }] });
    expect(status).toBe(200);
  });
});
