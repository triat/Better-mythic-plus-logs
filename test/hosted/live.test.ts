import { expect, test } from "bun:test";
import { LIVE_ROLES, LIVE_SORTS } from "../../src/hosted/live.ts";
import { LIVE_ROLES as FRONT_LIVE_ROLES, LIVE_SORTS as FRONT_LIVE_SORTS } from "../../web/src/lib/live/roster.ts";

// The front has its own copy (web/src/lib/live/roster.ts, types only cross); this pins that both agree.
// Lives in test/ rather than web/src because importing src/hosted/live.ts from web/src would be a runtime
// src/ import, which the front's types-only rule forbids (test/ may import both trees).
test("the server's copy of the Live lists matches the front's", () => {
  expect([...LIVE_SORTS]).toEqual([...FRONT_LIVE_SORTS]);
  expect([...LIVE_ROLES]).toEqual([...FRONT_LIVE_ROLES]);
});
