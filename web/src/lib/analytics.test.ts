import { describe, expect, test } from "bun:test";
import { ANALYTICS_EVENTS, eventProps, pagePath, scriptAttributes, utmQuery } from "./analytics.ts";
import type { Page } from "./hostedMode.ts";

describe("analytics", () => {
  test("pagePath: the page's kind only, the signed-out home as the landing", () => {
    const pages: Page[] = ["home", "candidate", "compare", "live", "admin", "settings", "privacy", "help", "me"];
    expect(pages.map((p) => pagePath(p, false))).toEqual(["/", "/candidate", "/compare", "/live", "/admin", "/settings", "/privacy", "/help", "/me"]);
    expect(pagePath("home", true)).toBe("/landing");
    expect(pagePath("help", true)).toBe("/help");
  });
  test("utmQuery: the five campaign tags with plain values, nothing else of the query", () => {
    expect(utmQuery("?utm_source=discord&utm_campaign=guild-x&open=Vacha-Ysondre&q=Secret")).toBe("?utm_source=discord&utm_campaign=guild-x");
    expect(utmQuery("?open=Vacha-Ysondre")).toBe("");
    expect(utmQuery("")).toBe("");
    // A value with spaces, accents or slashes (a name, a free text, a URL) is dropped.
    expect(utmQuery("?utm_source=discord&utm_term=Vach%C3%A2man%20Ysondre&utm_content=a%2Fb")).toBe("?utm_source=discord");
    expect(utmQuery(`?utm_campaign=${"x".repeat(65)}`)).toBe("");
  });
  test("the events of the spec and no other", () => {
    expect(Object.keys(ANALYTICS_EVENTS).sort()).toEqual([
      "bnet_link", "compare", "contact_click", "deepdive", "dungeon_open", "feedback_open", "feedback_prompt", "feedback_sent", "feedback_verdict",
      "history_open", "key_level", "live_connect", "lookup", "lookup_failed",
      "run_pick", "run_sheet", "season_sync", "sign_in_click", "support_click", "tab", "timeline_layer", "wcl_client_set",
    ]);
  });
  test("every property is a closed list of words, or Compare's count", () => {
    for (const props of Object.values(ANALYTICS_EVENTS)) {
      for (const rule of Object.values(props) as (readonly string[] | "count")[]) {
        if (rule !== "count") for (const v of rule) expect(v).toMatch(/^[a-z_]+$/);
      }
    }
    expect(eventProps("tab", { view: "candidate", tab: "runs" })).toEqual({ view: "candidate", tab: "runs" });
    expect(eventProps("tab", { view: "candidate", tab: "Vacha-Ysondre" })).toEqual({ view: "candidate" });
    expect(eventProps("support_click", { place: "menu" })).toEqual({ place: "menu" });
    expect(eventProps("lookup_failed", { reason: "quota" })).toEqual({ reason: "quota" });
  });
  test("eventProps keeps only the allowed properties with allowed values", () => {
    expect(eventProps("lookup", { source: "cached" })).toEqual({ source: "cached" });
    expect(eventProps("lookup", { count: 3 })).toBeUndefined();
    expect(eventProps("compare", { count: 3, source: "fetched" })).toEqual({ count: 3 });
    expect(eventProps("compare", { count: 9 })).toBeUndefined();
    expect(eventProps("deepdive", { source: "fetched" })).toBeUndefined();
    // A value smuggled in (a character name) never goes through.
    expect(eventProps("lookup", { source: "Vachâman-Ysondre" })).toBeUndefined();
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
