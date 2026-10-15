import { describe, expect, test } from "bun:test";
import { MAX_REPORTS, clientErrorReport, createErrorReporter } from "./clientErrors.ts";
import type { ClientErrorReport } from "./clientErrors.ts";

const ctx = { page: "/candidate", origin: "https://bmpl.example.com", version: "0.10.5" };

describe("client errors", () => {
  test("an Error becomes name: message, its stack clipped; the page and version are kept", () => {
    const e = new TypeError("x is undefined");
    const r = clientErrorReport("error", e, { ...ctx, source: "https://bmpl.example.com/assets/app.js" })!;
    expect(r).toMatchObject({ kind: "error", message: "TypeError: x is undefined", page: "/candidate", version: "0.10.5" });
    expect(r.stack).toContain("x is undefined");
    const long = clientErrorReport("rejection", "m".repeat(900), ctx)!;
    expect(long.message.length).toBe(500);
    expect(long.stack).toBeNull();
  });
  test("other origins, browser noise and empty reasons are dropped", () => {
    expect(clientErrorReport("error", new Error("boom"), { ...ctx, source: "https://wow.zamimg.com/js/tooltips.js" })).toBeNull();
    expect(clientErrorReport("error", "Script error.", ctx)).toBeNull();
    expect(clientErrorReport("error", "ResizeObserver loop completed with undelivered notifications.", ctx)).toBeNull();
    expect(clientErrorReport("rejection", undefined, ctx)).toBeNull();
  });
  test("a page or version the server would refuse is replaced, never sent as is", () => {
    expect(clientErrorReport("error", "boom", { ...ctx, page: "/candidate?open=Tom-Hyjal", version: "dev" })).toMatchObject({ page: "/", version: null });
  });
  test("the reporter sends each distinct error once, and at most five per page load", () => {
    const sent: ClientErrorReport[] = [];
    const report = createErrorReporter((r) => sent.push(r));
    const of = (m: string) => clientErrorReport("error", m, ctx);
    report(of("a"));
    report(of("a"));
    report(null);
    for (let i = 0; i < 10; i++) report(of(`b${i}`));
    expect(sent.map((r) => r.message)).toEqual(["a", "b0", "b1", "b2", "b3"]);
    expect(sent).toHaveLength(MAX_REPORTS);
  });
});
