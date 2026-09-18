import { afterAll, describe, expect, test } from "bun:test";
import { broadcast, broadcastTo, eventsResponse } from "../src/server/sse.ts";

const decoder = new TextDecoder();
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

/** Opens a stream and returns a `next(ms)` that resolves with the next chunk or null when nothing arrives in time. */
function open(userId: number | null) {
  const reader = eventsResponse({ event: "status", data: { active: false } }, userId).body!.getReader();
  readers.push(reader);
  let pending: Promise<string | null> | null = null;
  const next = (ms = 80): Promise<string | null> => {
    pending ??= reader.read().then((x) => { pending = null; return x.done ? null : decoder.decode(x.value); });
    return Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  };
  return { next };
}

afterAll(() => { for (const r of readers) void r.cancel(); });

describe("SSE fan-out", () => {
  test("every stream starts with the initial event", async () => {
    const c = open(null);
    expect(await c.next()).toBe('event: status\ndata: {"active":false}\n\n');
  });

  test("broadcastTo reaches only that user's clients; broadcast reaches only local (user-less) clients", async () => {
    const local = open(null);
    const u1a = open(1);
    const u1b = open(1);
    const u2 = open(2);
    for (const c of [local, u1a, u1b, u2]) expect(await c.next()).toContain("event: status");

    broadcastTo(1, "result", { key: "k" });
    expect(await u1a.next()).toBe('event: result\ndata: {"key":"k"}\n\n');
    expect(await u1b.next()).toBe('event: result\ndata: {"key":"k"}\n\n');
    expect(await u2.next()).toBeNull();
    expect(await local.next()).toBeNull();

    broadcast("status", { active: true });
    expect(await local.next()).toBe('event: status\ndata: {"active":true}\n\n');
    expect(await u1a.next()).toBeNull();
    expect(await u2.next()).toBeNull();
  });
});
