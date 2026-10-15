import { afterEach, describe, expect, test } from "bun:test";
import { errorFields, log, setLogSink, userRef } from "../src/log.ts";
import { upstreamFields } from "../src/upstream.ts";

let lines: string[] = [];
const capture = () => { lines = []; setLogSink((l) => lines.push(l), () => Date.parse("2026-10-15T08:30:00.123Z")); };
afterEach(() => setLogSink(null));

describe("structured logs", () => {
  test("one JSON object per line: ts in ISO 8601 UTC with ms, level, event, then the fields", () => {
    capture();
    log.info("http_request", { method: "GET", status: 200, user: userRef(4) });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.includes("\n")).toBe(false);
    log.info("http_request", { method: "GET", route: "/api/me", status: 200, ms: 4, user: userRef(4) });
    expect(JSON.parse(lines[0]!)).toEqual({ ts: "2026-10-15T08:30:00.123Z", level: "info", event: "http_request", msg: "GET undefined 200 undefined ms", method: "GET", status: 200, user: "user#4" });
    expect(JSON.parse(lines[1]!).msg).toBe("GET /api/me 200 4 ms");
  });
  test("never an IP, a Discord id or a username; undefined fields left out; reserved keys kept", () => {
    capture();
    log.warn("x", { ip: "1.2.3.4", discordId: "123", username: "tom", a: undefined, b: null, ts: "fake", event: "fake", msg: "fake" });
    expect(JSON.parse(lines[0]!)).toEqual({ ts: "2026-10-15T08:30:00.123Z", level: "warn", event: "x", msg: "x", b: null });
    log.error("server_error", { message: "boom" });
    expect(JSON.parse(lines[1]!).msg).toBe("server_error: boom");
  });
  test("long strings clipped, stacks with more room; an unserialisable value still logs a line", () => {
    capture();
    log.error("server_error", { message: "m".repeat(5000), stack: "s".repeat(5000) });
    const o = JSON.parse(lines[0]!);
    expect(o.message.length).toBe(1001);
    expect(o.stack.length).toBe(4001);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    log.error("bad", { loop });
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: "bad", unserializable: true });
  });
  test("errorFields and userRef", () => {
    expect(errorFields(new Error("boom")).message).toBe("boom");
    expect(errorFields(new Error("boom")).stack).toContain("boom");
    expect(errorFields("plain")).toEqual({ message: "plain", stack: null });
    expect(userRef(null)).toBeNull();
    expect(userRef(12)).toBe("user#12");
  });
  test("the stream labels `service` and `unit` are never shadowed; an upstream call names its dependency `dep`", () => {
    capture();
    log.info("upstream", { ...upstreamFields({ service: "raiderio", op: "profile", status: 503, ms: 120, ok: false }), unit: "x" });
    const o = JSON.parse(lines[0]!);
    expect(o).toMatchObject({ dep: "raiderio", op: "profile", status: 503, ok: false, msg: "raiderio profile 503 120 ms" });
    expect("service" in o || "unit" in o).toBe(false);
  });
});
