import { describe, expect, test } from "bun:test";
import { FLUSH_AT, MAX_PER_NAME, createTracker } from "./usage.ts";
import type { UsageBatch } from "./usage.ts";

const setup = () => {
  const sent: Array<{ events: UsageBatch; keepalive: boolean }> = [];
  const t = createTracker((events, keepalive) => sent.push({ events, keepalive }));
  return { t, sent };
};

describe("createTracker", () => {
  test("disabled (local mode, signed out): nothing is queued or sent", () => {
    const { t, sent } = setup();
    t.track("axis_expand");
    t.flush(false);
    expect(t.queued).toBe(0);
    expect(sent).toEqual([]);
  });
  test("counts per name and sends one batch on flush; an empty flush sends nothing", () => {
    const { t, sent } = setup();
    t.setEnabled(true);
    t.track("axis_expand");
    t.track("axis_expand");
    t.track("compare_open");
    t.flush(true);
    t.flush(false);
    expect(sent).toEqual([{ events: { axis_expand: 2, compare_open: 1 }, keepalive: true }]);
    expect(t.queued).toBe(0);
  });
  test("sends on its own once the batch holds FLUSH_AT events", () => {
    const { t, sent } = setup();
    t.setEnabled(true);
    for (let i = 0; i < FLUSH_AT - 1; i++) t.track(i % 2 ? "help_link" : "axis_expand");
    expect(sent).toHaveLength(0);
    t.track("help_link");
    expect(sent).toHaveLength(1);
    expect(Object.values(sent[0]!.events).reduce((a, b) => a + (b ?? 0), 0)).toBe(FLUSH_AT);
  });
  test("never lets one name exceed the server's per-name cap", () => {
    const { t, sent } = setup();
    t.setEnabled(true);
    // FLUSH_AT trips first in practice; the cap guards a FLUSH_AT raised above it.
    for (let i = 0; i < MAX_PER_NAME * 2; i++) t.track("axis_expand");
    expect(sent.every((s) => (s.events.axis_expand ?? 0) <= MAX_PER_NAME)).toBe(true);
  });
  test("disabling drops what was queued", () => {
    const { t, sent } = setup();
    t.setEnabled(true);
    t.track("axis_expand");
    t.setEnabled(false);
    t.setEnabled(true);
    t.flush(false);
    expect(sent).toEqual([]);
  });
});
