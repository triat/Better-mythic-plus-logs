import { describe, expect, test } from "bun:test";
import { ANALYTICS_EVENTS, eventProps, pagePath, scriptAttributes } from "./analytics.ts";
import type { Page } from "./hostedMode.ts";

describe("analytics", () => {
  test("pagePath: the page's kind only, the signed-out home as the landing", () => {
    const pages: Page[] = ["home", "candidate", "compare", "live", "admin", "settings", "privacy", "help", "me"];
    expect(pages.map((p) => pagePath(p, false))).toEqual(["/", "/candidate", "/compare", "/live", "/admin", "/settings", "/privacy", "/help", "/me"]);
    expect(pagePath("home", true)).toBe("/landing");
    expect(pagePath("help", true)).toBe("/help");
  });
  test("the eight events of the spec and no other", () => {
    expect(Object.keys(ANALYTICS_EVENTS).sort()).toEqual(["bnet_link", "compare", "deepdive", "live_connect", "lookup", "season_sync", "sign_in_click", "wcl_client_set"]);
  });
  test("eventProps keeps only the allowed properties with allowed values", () => {
    expect(eventProps("lookup", { source: "cached" })).toEqual({ source: "cached" });
    expect(eventProps("lookup", { count: 3 })).toBeUndefined();
    expect(eventProps("compare", { count: 3, source: "fetched" })).toEqual({ count: 3 });
    expect(eventProps("compare", { count: 9 })).toBeUndefined();
    expect(eventProps("deepdive", { source: "fetched" })).toBeUndefined();
    // A value smuggled past the types (a character name) never goes through.
    expect(eventProps("lookup", { source: "Vachâman-Ysondre" as never })).toBeUndefined();
  });
  test("scriptAttributes: manual page views, no query or hash, Do Not Track, this host only", () => {
    expect(scriptAttributes({ url: "https://analytics.riat.dev", websiteId: "77bb2d19-7cfd-4c46-9100-232862ecd092" }, "bmpl.riat.dev")).toEqual({
      src: "https://analytics.riat.dev/script.js",
      "data-website-id": "77bb2d19-7cfd-4c46-9100-232862ecd092",
      "data-auto-track": "false",
      "data-exclude-search": "true",
      "data-exclude-hash": "true",
      "data-do-not-track": "true",
      "data-domains": "bmpl.riat.dev",
    });
  });
});
