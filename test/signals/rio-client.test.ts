import { describe, expect, test } from "bun:test";
import { RIO_RETRY_DELAYS_MS, fetchRioProfile } from "../../src/signals/rio-client.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadRioFixture } from "../fixtures.ts";

const noSleep = async () => {};
const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchRioProfile", () => {
  test("200 → parsed profile, cached", async () => {
    const raw = await loadRioFixture();
    const store = openStore(":memory:");
    const urls: string[] = [];
    const fetchFn = (async (u: string | URL | Request) => { urls.push(String(u)); return jsonResp(raw); }) as unknown as typeof fetch;
    const r = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 42 });
    expect(r.fromCache).toBe(false);
    expect(r.profile?.itemLevel).toBe(322);
    expect(r.profile?.fetchedAt).toBe(42);
    expect(urls[0]).toContain("region=eu&realm=silvermoon&name=Muleyoxo");

    const again = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 43 });
    expect(again.fromCache).toBe(true);
    expect(again.profile?.fetchedAt).toBe(42);
    expect(urls.length).toBe(1);

    const forced = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 44, refresh: true });
    expect(forced.fromCache).toBe(false);
    expect(urls.length).toBe(2);
    store.close();
  });

  test("404 → error, no retry", async () => {
    const store = openStore(":memory:");
    let n = 0;
    const fetchFn = (async () => { n++; return jsonResp({ statusCode: 400, error: "Bad Request", message: "Could not find requested character" }, 400); }) as unknown as typeof fetch;
    const r = await fetchRioProfile("EU", "Nerzhul", "Nobody", store, { fetchFn, sleep: noSleep });
    expect(r.profile).toBeNull();
    expect(r.error).toBe("Not found on Raider.IO");
    expect(n).toBe(1);
    store.close();
  });

  test("5xx → retries with backoff, then error", async () => {
    const store = openStore(":memory:");
    const delays: number[] = [];
    let n = 0;
    const fetchFn = (async () => { n++; return new Response("error code: 502", { status: 502 }); }) as unknown as typeof fetch;
    const r = await fetchRioProfile("EU", "Nerzhul", "X", store, { fetchFn, sleep: async (ms) => { delays.push(ms); } });
    expect(n).toBe(RIO_RETRY_DELAYS_MS.length + 1);
    expect(delays).toEqual(RIO_RETRY_DELAYS_MS);
    expect(r.profile).toBeNull();
    expect(r.error).toBe("Raider.IO unavailable (HTTP 502)");
    store.close();
  });

  test("network error then success", async () => {
    const raw = await loadRioFixture();
    const store = openStore(":memory:");
    let n = 0;
    const fetchFn = (async () => { n++; if (n === 1) throw new Error("ECONNRESET"); return jsonResp(raw); }) as unknown as typeof fetch;
    const r = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep });
    expect(n).toBe(2);
    expect(r.profile?.recentRuns.length).toBe(10);
    store.close();
  });
});
