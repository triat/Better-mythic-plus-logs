import { describe, expect, test } from "bun:test";
import { DEEPDIVE_BODY, LOOKUP_BODY, bool, int, num, nullable, obj, oneOf, opt, parseBody, str } from "../../src/server/validate.ts";

const body = (v: unknown, raw = false) => new Request("http://x/api", { method: "POST", body: raw ? (v as string) : JSON.stringify(v), headers: { "Content-Type": "application/json" } });

describe("combinators", () => {
  test("str: type, bounds, pattern, trim", () => {
    expect(str().parse("a", "x")).toEqual({ ok: true, value: "a" });
    expect(str({ trim: true }).parse("  a ", "x")).toEqual({ ok: true, value: "a" });
    expect(str().parse(1, "x")).toEqual({ ok: false, error: "`x` must be a string" });
    expect(str({ min: 2 }).parse("a", "x")).toEqual({ ok: false, error: "`x` must be at least 2 characters" });
    expect(str({ max: 2 }).parse("abc", "x")).toEqual({ ok: false, error: "`x` must be at most 2 characters" });
    expect(str({ pattern: /^\d+$/ }).parse("a1", "x")).toEqual({ ok: false, error: "`x` is not valid" });
  });
  test("int/num: finite, integer, bounds; bool; oneOf", () => {
    expect(int().parse(3, "x")).toEqual({ ok: true, value: 3 });
    expect(int().parse(1.5, "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int().parse(Number.NaN, "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int().parse("3", "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int({ min: 2, max: 4 }).parse(5, "x")).toEqual({ ok: false, error: "`x` must be at most 4" });
    expect(int({ min: 2 }).parse(1, "x")).toEqual({ ok: false, error: "`x` must be at least 2" });
    expect(num().parse(Number.POSITIVE_INFINITY, "x")).toEqual({ ok: false, error: "`x` must be a number" });
    expect(bool().parse("true", "x")).toEqual({ ok: false, error: "`x` must be a boolean" });
    expect(oneOf(["dps", "hps"]).parse("tank", "x")).toEqual({ ok: false, error: "`x` must be one of dps, hps" });
  });
  test("obj: required, optional, nullable, unknown fields", () => {
    const s = obj({ a: int(), b: opt(str()), c: nullable(int()) });
    expect(s.parse({ a: 1, c: null }, "")).toEqual({ ok: true, value: { a: 1, c: null } });
    expect(s.parse({ a: 1, b: undefined, c: 2 }, "")).toEqual({ ok: true, value: { a: 1, c: 2 } });
    expect(s.parse({ c: 1 }, "")).toEqual({ ok: false, error: "`a` is required" });
    expect(s.parse({ a: 1, c: 1, zzz: 1 }, "")).toEqual({ ok: false, error: "Unexpected field `zzz`" });
    expect(s.parse({ a: 1, c: 1, toString: 1 }, "")).toEqual({ ok: false, error: "Unexpected field `toString`" }); // own fields only, never the prototype's
    expect(s.parse([], "")).toEqual({ ok: false, error: "Body must be a JSON object" });
    expect(obj({ n: obj({ k: int() }) }).parse({ n: { k: "1" } }, "")).toEqual({ ok: false, error: "`n.k` must be an integer" });
  });
});

describe("request schemas", () => {
  test("lookup: the front's shapes pass, junk is refused", async () => {
    expect((await parseBody(body({ character: " Biwaadrood-Nerzhul ", level: 18, spec: null, metric: "dps", refresh: false }), LOOKUP_BODY))).toEqual({ ok: true, value: { character: "Biwaadrood-Nerzhul", level: 18, spec: null, metric: "dps", refresh: false } });
    expect((await parseBody(body({ character: "x".repeat(201) }), LOOKUP_BODY)).ok).toBe(false);
    expect(await parseBody(body({ character: "a", level: "18" }), LOOKUP_BODY)).toEqual({ ok: false, error: "`level` must be an integer" });
    expect(await parseBody(body({ character: "a", evil: 1 }), LOOKUP_BODY)).toEqual({ ok: false, error: "Unexpected field `evil`" });
    expect(await parseBody(body("{not json", true), LOOKUP_BODY)).toEqual({ ok: false, error: "Invalid JSON body" });
    expect(await parseBody(body([1]), LOOKUP_BODY)).toEqual({ ok: false, error: "Body must be a JSON object" });
  });
  test("deepdive: fightID must be a positive integer, reportCode alphanumeric", async () => {
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: 7, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: true, value: { reportCode: "ab12CD", fightID: 7, character: "Biwa" } });
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: 1.5, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`fightID` must be an integer" });
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: "7", character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`fightID` must be an integer" });
    expect(await parseBody(body({ reportCode: "../x", fightID: 7, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`reportCode` is not valid" });
  });
});
