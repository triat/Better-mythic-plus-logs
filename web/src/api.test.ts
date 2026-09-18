import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./api.ts";
import type { RunDefensives } from "./types.ts";

const realFetch = globalThis.fetch;
const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => fn(String(url), init)) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; });

describe("api", () => {
  test("ok response is passed through", async () => {
    mock(() => Response.json({ ok: true, hosted: false, hasCredentials: true, envPath: "/x/.env" }));
    const r = await api.status();
    expect(r).toEqual({ ok: true, hosted: false, hasCredentials: true, envPath: "/x/.env" });
  });

  test("HTTP error with JSON error body", async () => {
    mock(() => Response.json({ ok: false, error: "Not in history" }, { status: 404 }));
    const r = await api.historyEntry("a b");
    expect(r).toEqual({ ok: false, error: "Not in history" });
  });

  test("HTTP error with non-JSON body", async () => {
    mock(() => new Response("boom", { status: 500 }));
    expect(await api.history()).toEqual({ ok: false, error: "HTTP 500" });
  });

  test("network failure", async () => {
    mock(() => { throw new TypeError("fetch failed"); });
    expect(await api.quit()).toEqual({ ok: false, error: "Network error" });
  });

  test("lookup posts JSON and encodes history keys", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    mock((url, init) => { seen.push({ url, init }); return Response.json({ ok: true }); });
    await api.lookup({ character: "A-B", level: 20, refresh: true });
    await api.removeHistory("k/1");
    expect(seen[0]!.url).toBe("/api/lookup");
    expect(seen[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ character: "A-B", level: 20, refresh: true });
    expect(seen[1]!.url).toBe("/api/history/k%2F1");
    expect(seen[1]!.init?.method).toBe("DELETE");
  });

  test("deepdive posts JSON and returns the analysis", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const result = { reportCode: "ABC", fightID: 3 } as unknown as RunDefensives;
    mock((url, init) => {
      seen.push({ url, init });
      return Response.json({ ok: true, result, fromCache: false, pointsSpent: 3 });
    });
    const r = await api.deepdive({ reportCode: "ABC", fightID: 3, character: "Muleyoxo" });
    expect(seen[0]!.url).toBe("/api/deepdive");
    expect(seen[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ reportCode: "ABC", fightID: 3, character: "Muleyoxo" });
    expect(r).toEqual({ ok: true, result, fromCache: false, pointsSpent: 3 });
  });
});
