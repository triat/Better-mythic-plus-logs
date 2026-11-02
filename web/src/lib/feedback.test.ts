import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { tEn } from "../i18n/t.ts";
import type { FeedbackRow } from "../types.ts";
import { feedbackLine, NEW_PROMPT, PROMPT_MAX, parsePrompt, promptAfterLookup, promptDue, promptLater, promptStop, verdictSubject } from "./feedback.ts";

const DAY = 86_400_000;
const payload = (verdict: string, global: number | null) =>
  ({ character: { name: "Vachâman", realmSlug: "ysondre", region: "eu" }, evaluation: { verdict, global, targetLevel: 16 } }) as unknown as LookupPayload;

describe("feedback", () => {
  test("verdictSubject: the character as the store keys it, the level and bmpl's verdict; none without a verdict", () => {
    expect(verdictSubject(payload("invite", 78.4))).toEqual({
      target: { region: "eu", realm: "ysondre", name: "vachâman", level: 16 }, label: "Vachâman-Ysondre", verdict: "invite", score: 78,
    });
    expect(verdictSubject(payload("insufficient", null))).toBeNull();
  });
  test("the invitation: after the 5th lookup, twice at most, later waits 14 days and 10 lookups, the cross or a message stop it", () => {
    let s = NEW_PROMPT;
    const now = 1_800_000_000_000;
    for (let i = 0; i < 4; i++) s = promptAfterLookup(s);
    expect(promptDue(s, now, false)).toBe(false);
    s = promptAfterLookup(s);
    expect(promptDue(s, now, false)).toBe(true);
    expect(promptDue(s, now, true)).toBe(false);
    s = promptLater(s, now);
    expect(promptDue(s, now + 20 * DAY, false)).toBe(false); // 14 days passed, not 10 more lookups
    for (let i = 0; i < 10; i++) s = promptAfterLookup(s);
    expect(promptDue(s, now + 13 * DAY, false)).toBe(false);
    expect(promptDue(s, now + 14 * DAY, false)).toBe(true);
    s = promptLater(s, now + 14 * DAY);
    expect(s.shown).toBe(PROMPT_MAX);
    for (let i = 0; i < 50; i++) s = promptAfterLookup(s);
    expect(promptDue(s, now + 400 * DAY, false)).toBe(false);
    expect(promptDue(promptStop({ ...NEW_PROMPT, lookups: 9 }), now, false)).toBe(false);
  });
  test("parsePrompt: stored state read back, anything unreadable is a new state", () => {
    const s = promptLater({ ...NEW_PROMPT, lookups: 6 }, 5);
    expect(parsePrompt(JSON.stringify(s))).toEqual(s);
    expect(parsePrompt(null)).toEqual(NEW_PROMPT);
    expect(parsePrompt("{oops")).toEqual(NEW_PROMPT);
    expect(parsePrompt(JSON.stringify({ lookups: -3, stopped: "yes" }))).toEqual(NEW_PROMPT);
  });
  test("feedbackLine: the verdict judged, the Discord name only when the member agreed", () => {
    const base: FeedbackRow = { id: 1, at: 5, kind: "verdict", userId: 2, username: null, discordId: null, replyOk: false, message: "Dies on packs", rating: "unfair", reason: "generous", context: { label: "Vachâman-Ysondre", verdict: "invite", score: 78 }, target: "eu|ysondre|vachâman|16", readAt: null };
    expect(feedbackLine(tEn, base)).toEqual({ id: 1, kind: "Verdict", at: 5, unread: true, who: "no answer asked", context: "Vachâman-Ysondre at +16 · bmpl said INVITE 78 · judged too generous", message: "Dies on packs" });
    expect(feedbackLine(tEn, { ...base, rating: "fair", reason: null }).context).toContain("judged right");
    const idea = feedbackLine(tEn, { ...base, kind: "idea", username: "tom", replyOk: true, rating: null, reason: null, context: { page: "home" }, target: null, readAt: 9 });
    expect([idea.kind, idea.who, idea.context, idea.unread]).toEqual(["Idea", "answer @tom", null, false]);
  });
});
