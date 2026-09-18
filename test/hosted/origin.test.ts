import { describe, expect, test } from "bun:test";
import { checkOrigin } from "../../src/hosted/origin.ts";

const base = "https://bmpl.example";
const h = (o: Record<string, string>) => new Headers(o);

describe("checkOrigin", () => {
  test("no header at all passes (curl, same-origin fetch in old browsers)", () => {
    expect(checkOrigin(new Headers(), base)).toBeNull();
  });
  test("Origin equal to the base URL passes", () => {
    expect(checkOrigin(h({ Origin: base }), base)).toBeNull();
    expect(checkOrigin(h({ Origin: base + "/" }), base)).toBeNull(); // trailing slash: still the same origin
  });
  test("a foreign Origin is refused", () => {
    expect(checkOrigin(h({ Origin: "https://evil.example" }), base)).toBe("origin");
  });
  test("the literal `null` Origin (sandboxed iframe, redirect chains) is refused", () => {
    expect(checkOrigin(h({ Origin: "null" }), base)).toBe("origin");
  });
  test("an unparsable Origin is refused", () => {
    expect(checkOrigin(h({ Origin: "not a url" }), base)).toBe("origin");
  });
  test("Sec-Fetch-Site same-origin / none pass", () => {
    expect(checkOrigin(h({ "Sec-Fetch-Site": "same-origin" }), base)).toBeNull();
    expect(checkOrigin(h({ "Sec-Fetch-Site": "none" }), base)).toBeNull();
  });
  test("Sec-Fetch-Site cross-site / same-site are refused", () => {
    expect(checkOrigin(h({ "Sec-Fetch-Site": "cross-site" }), base)).toBe("fetch-site");
    expect(checkOrigin(h({ "Sec-Fetch-Site": "same-site" }), base)).toBe("fetch-site");
  });
  test("a matching Origin does not excuse a cross-site Sec-Fetch-Site (belt and braces)", () => {
    expect(checkOrigin(h({ Origin: base, "Sec-Fetch-Site": "cross-site" }), base)).toBe("fetch-site");
  });
  test("a foreign Origin wins over a reassuring Sec-Fetch-Site", () => {
    expect(checkOrigin(h({ Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" }), base)).toBe("origin");
  });
  test("the port is part of the origin", () => {
    expect(checkOrigin(h({ Origin: "http://localhost:3000" }), "http://localhost")).toBe("origin");
    expect(checkOrigin(h({ Origin: "http://localhost" }), "http://localhost")).toBeNull();
  });
});
