import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { History } from "../src/server-history.ts";
import type { HistoryStore } from "../src/server-history.ts";
import { authGate } from "../src/hosted/auth.ts";
import type { RequestContext } from "../src/hosted/auth.ts";
import { openHosted } from "../src/hosted/db.ts";
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

  // I2: the previous version of this test injected a throwing `gql` into `rc.runtime`, which the route
  // never reads — it could not fail. Two pins that can: every WCL call (OAuth token, then the GraphQL
  // POST) goes out through `fetch`, so a throwing `fetch` fails the request if the handler reaches WCL
  // by ANY route, imported or injected; and the handler must touch the history store through `peek`
  // alone, so it can neither spend nor write.
  test("spends no WCL point: no network call at all, and the history is only read", async () => {
    const ctx = ctxWith([{ character: "Biwaadrood-Nerzhul", level: 18, verdict: "pass", global: 31 }]);
    const calls: string[] = [];
    const spied = { ...ctx, history: spyHistory(ctx.history!, calls) } as unknown as RequestContext;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("no network call may leave POST /api/live/cached"); }) as unknown as typeof fetch;
    try {
      const { status, json } = await post(spied, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }] });
      expect(status).toBe(200);
      expect(json.verdicts![0]).toMatchObject({ verdict: "pass" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual(["peek"]); // never `cached` (which writes), never `record`
  });

  test("spends no WCL point: the route module imports nothing from src/wcl", () => {
    const source = readFileSync("src/server/routes-live.ts", "utf8");
    const imports = [...source.matchAll(/^\s*import[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => /wcl/i.test(i))).toEqual([]);
  });

  // The spec's Testing section names both of these; the suite had neither.
  test("an unauthenticated hosted request is refused before the handler runs", async () => {
    const r = liveRoutes()[0]!;
    expect(r.auth).toBe("user"); // not "public": the gate is what stops an anonymous caller
    const anonymous = { hosted: true, user: null, sessionId: null, ip: "1.2.3.4", now: 1_000, history: null } as RequestContext;
    const refusal = authGate(r, anonymous)!;
    expect(refusal).not.toBeNull();
    expect(refusal.status).toBe(401);
    // And if it ever did reach the handler, `historyOf` refuses rather than inventing a store.
    await expect(post(anonymous, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }] })).rejects.toThrow();
  });

  test("hosted: another member's fresh entry is a hit, and peeking it writes nothing to the caller", async () => {
    const db = new Database(":memory:");
    try {
      const hosted = openHosted(db);
      const ua = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, null, 0);
      const ub = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, null, 0);
      const now = () => 1_000;
      const a = hosted.history.forUser(ua.id, now);
      const b = hosted.history.forUser(ub.id, now);
      a.record(
        { character: "Biwaadrood-Nerzhul", level: 18, spec: null, metric: null, region: "eu" },
        { result: payload("invite", 78.4, 18), label: "Biwaadrood-Nerzhul", charClass: 11, spec: null, targetLevel: 18, targetAutoDetected: false },
      );
      const ctx = { hosted: true, history: b, user: { id: ub.id }, now: 1_000 } as unknown as RequestContext;
      const { status, json } = await post(ctx, { level: 18, players: [{ character: "Biwaadrood-Nerzhul", region: "eu" }] });
      expect(status).toBe(200);
      expect(json.verdicts![0]).toMatchObject({ character: "Biwaadrood-Nerzhul", verdict: "invite", score: 78.4, fetchedAt: 1_000 });
      expect(b.size).toBe(0); // I1: the applicant's name is NOT persisted into the caller's history
      expect(b.list()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

/** Records which `HistoryStore` methods a handler calls, delegating each one to the real store. */
function spyHistory(real: HistoryStore, calls: string[]): HistoryStore {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || prop === "constructor") return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
