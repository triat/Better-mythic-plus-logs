import { describe, expect, test } from "bun:test";
import { CRC_FAIL_WINDOW, MARKER_TIMEOUT_MS, liveState } from "./useWowCapture.ts";

const base = { connected: true, lastFrameAt: 1_000, lastMarkerAt: 1_000, rosterAt: 1_000, crcFails: 0, crcTotal: 20, now: 1_000 };

describe("liveState", () => {
  test("off before connecting", () => {
    expect(liveState({ ...base, connected: false })).toEqual({ kind: "off" });
  });
  test("live while the roster is fresh", () => {
    expect(liveState({ ...base, now: 3_000 })).toMatchObject({ kind: "live" });
  });
  test("waiting once the strip is gone but the capture is alive (Group Finder closed)", () => {
    expect(liveState({ ...base, lastMarkerAt: null, rosterAt: null, now: 2_000 })).toEqual({ kind: "waiting" });
  });
  test("the fullscreen hint only after the marker has been missing for 5 s", () => {
    expect(liveState({ ...base, lastMarkerAt: 1_000, rosterAt: null, now: 1_000 + MARKER_TIMEOUT_MS - 1 })).toEqual({ kind: "waiting" });
    expect(liveState({ ...base, lastMarkerAt: 1_000, rosterAt: null, now: 1_000 + MARKER_TIMEOUT_MS })).toEqual({ kind: "error", code: "fullscreen" });
  });
  test("the scale hint when more than half of a full window of frames fails its CRC", () => {
    expect(liveState({ ...base, crcTotal: CRC_FAIL_WINDOW, crcFails: CRC_FAIL_WINDOW / 2 + 1 })).toEqual({ kind: "error", code: "scale" });
    expect(liveState({ ...base, crcTotal: CRC_FAIL_WINDOW - 1, crcFails: CRC_FAIL_WINDOW })).not.toMatchObject({ code: "scale" });
  });
  test("reconnect when the stream died", () => {
    expect(liveState({ ...base, lastFrameAt: null })).toEqual({ kind: "reconnect" });
  });
});
