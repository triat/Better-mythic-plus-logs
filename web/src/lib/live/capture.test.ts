import { describe, expect, test } from "bun:test";
import { CAPTURE_HZ, CRC_FAIL_WINDOW, MARKER_TIMEOUT_MS, createCapture, liveState } from "./useWowCapture.ts";
import type { CaptureCanvas, CaptureDeps, CaptureStream, CaptureTrack, CaptureVideo } from "./useWowCapture.ts";
import { STRIP, chunkRoster, decodeCells, encodeCells } from "./codec.ts";
import type { Gray } from "./scan.ts";

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

// --- createCapture: the browser-loop *lifecycle* against fake deps, no real DOM. -------------------
// A regression test for the bug fixed in review round 1: the track's `ended` event (the browser's own
// "Stop sharing") must tear the whole session down and latch `reconnect` so nothing — not a lingering
// timer, not a call made directly on a stale reference — can silently revert the chip back to "live".

function fakeTrack(): CaptureTrack & { stopped: boolean; fireEnded: () => void } {
  let ended: (() => void) | null = null;
  return {
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener(_type, listener) { ended = listener; },
    fireEnded() { ended?.(); },
  };
}

function fakeVideo(): CaptureVideo & { paused: boolean } {
  return {
    srcObject: null,
    readyState: 0, // never "ready": these lifecycle tests don't need the pixel-scanning path (scan.test.ts / codec.test.ts own that).
    videoWidth: 0,
    videoHeight: 0,
    paused: false,
    async play() {},
    pause() { this.paused = true; },
  };
}

const fakeCanvas = (): CaptureCanvas => ({ width: 0, height: 0, getContext: () => null });

/** Every `getDisplayMedia()` call returns a fresh track/stream, exactly like a real re-pick of the
 * window would — required to exercise the "a stale session's `ended` must not touch a newer one" guard. */
function fakeDeps() {
  const tracks: ReturnType<typeof fakeTrack>[] = [];
  const videos: ReturnType<typeof fakeVideo>[] = [];
  const ticks: Array<() => void> = [];
  const activeIds = new Set<number>();
  let nextId = 1;
  let clock = 0;
  const deps: CaptureDeps = {
    getDisplayMedia: async () => {
      const track = fakeTrack();
      tracks.push(track);
      const stream: CaptureStream = { getTracks: () => [track], getVideoTracks: () => [track] };
      return stream;
    },
    createVideo: () => { const v = fakeVideo(); videos.push(v); return v; },
    createCanvas: fakeCanvas,
    now: () => clock,
    setInterval: (fn) => { const id = nextId++; activeIds.add(id); ticks.push(fn); return id; },
    clearInterval: (id) => { activeIds.delete(id); },
  };
  return { deps, tracks, videos, ticks, activeIds, setClock: (t: number) => { clock = t; } };
}

describe("createCapture", () => {
  test("connecting reads as waiting, not a reconnect flash, before the first tick", async () => {
    const { deps } = fakeDeps();
    const capture = createCapture(deps);
    await capture.connect();
    expect(capture.getState()).toEqual({ kind: "waiting" });
  });

  test("the track's `ended` event tears the session down and latches reconnect against a forced tick", async () => {
    const { deps, tracks, videos, activeIds, ticks } = fakeDeps();
    const capture = createCapture(deps);
    await capture.connect();
    expect(activeIds.size).toBe(1);
    const forcedTick = ticks[0]!;
    tracks[0]!.fireEnded();
    expect(capture.getState()).toEqual({ kind: "reconnect" });
    expect(activeIds.size).toBe(0); // the interval was cleared
    expect(tracks[0]!.stopped).toBe(true); // the track was stopped
    expect(videos[0]!.paused).toBe(true); // the video was released
    // A tick still in flight — or, as here, forced directly, bypassing whatever would normally have
    // stopped it — must not be able to overwrite the latched state.
    forcedTick();
    expect(capture.getState()).toEqual({ kind: "reconnect" });
  });

  test("disconnect() does the same teardown, latching off instead of reconnect", async () => {
    const { deps, tracks, videos, activeIds, ticks } = fakeDeps();
    const capture = createCapture(deps);
    await capture.connect();
    const forcedTick = ticks[0]!;
    capture.disconnect();
    expect(capture.getState()).toEqual({ kind: "off" });
    expect(capture.getRoster()).toBeNull();
    expect(activeIds.size).toBe(0);
    expect(tracks[0]!.stopped).toBe(true);
    expect(videos[0]!.paused).toBe(true);
    forcedTick();
    expect(capture.getState()).toEqual({ kind: "off" });
  });

  test("a second connect() leaves no interval or listener from the first session behind", async () => {
    const { deps, tracks, videos, activeIds } = fakeDeps();
    const capture = createCapture(deps);
    await capture.connect();
    await capture.connect();
    expect(activeIds.size).toBe(1); // exactly one live interval, not two
    expect(tracks[0]!.stopped).toBe(true); // the first session's track was stopped by the second connect()
    expect(videos[0]!.paused).toBe(true); // and its video released
    // The first (already replaced) session's track ending must be a no-op on the second session.
    tracks[0]!.fireEnded();
    expect(capture.getState()).not.toEqual({ kind: "reconnect" });
    // The active session's own track still behaves correctly.
    tracks[1]!.fireEnded();
    expect(capture.getState()).toEqual({ kind: "reconnect" });
    expect(activeIds.size).toBe(0);
  });

});

// --- publish() notifies only on a real transition (review round 1, finding 1): at CAPTURE_HZ (10/s)
// this used to run unconditionally, re-rendering the whole `Main` tree on every tick while connected.

describe("createCapture: publish only on a real transition", () => {
  test("ticks with nothing changing produce exactly one state notification; a real transition produces one more", async () => {
    const { deps, tracks, ticks } = fakeDeps();
    const capture = createCapture(deps);
    let notifications = 0;
    capture.subscribe(() => { notifications++; });
    await capture.connect(); // off -> waiting: the one real transition so far.
    expect(notifications).toBe(1);
    const doTick = ticks[0]!;
    for (let i = 0; i < 20; i++) doTick(); // the video never reaches HAVE_CURRENT_DATA, no roster: nothing changes.
    expect(notifications).toBe(1);
    tracks[0]!.fireEnded(); // waiting -> reconnect: a real transition.
    expect(notifications).toBe(2);
  });

  test("re-decoding the same completed roster every tick keeps the roster reference stable and notifies once", async () => {
    // A roster line is 2 chunks at v3's 9 payload bytes, so the strip has to show them in turn before
    // the roster completes — exactly what the addon's cadence does after a change, before it parks on
    // the last chunk. `show` repaints the shared pixel buffer the fake canvas hands back.
    const chunks = chunkRoster("a|Foo-Bar|2|H|100\n", 1);
    expect(chunks.length).toBeGreaterThan(1);
    const first = paint(encodeCells(chunks[0]!), STRIP.cell);
    const rgba = grayToRgba(first);
    const show = (index: number) => rgba.set(grayToRgba(paint(encodeCells(chunks[index]!), STRIP.cell)));
    const { deps, ticks } = fakeDepsShowing(rgba, first.width, first.height);
    const capture = createCapture(deps);
    let notifications = 0;
    capture.subscribe(() => { notifications++; });
    await capture.connect();
    const doTick = ticks[0]!;
    for (let i = 0; i < chunks.length; i++) { show(i); doTick(); } // the roster completes on the last chunk.
    show(chunks.length - 1); // the addon parks on the frame it painted last.
    expect(capture.getState()).toMatchObject({ kind: "live" });
    const afterFirstTick = notifications;
    const rosterRef = capture.getRoster();
    // 200 ticks = 20 s of wall clock, well past ROSTER_STALE_MS: the one parked frame decodes again and
    // again and the roster must stay live (C1) on the very same object (publish-on-change). This is the
    // property addon/bmpl/cadence.lua leans on when it stops repainting.
    for (let i = 0; i < 200; i++) doTick();
    expect(capture.getState()).toMatchObject({ kind: "live" });
    expect(notifications).toBe(afterFirstTick); // no extra notifications
    expect(capture.getRoster()).toBe(rosterRef); // same object reference, not merely equal content
  });
});

// --- One scan per tick (review round 1, finding 2): a marker row that is present but never decodes
// must read as a CRC failure (eventually the "scale" error), not as an absent marker (which would only
// ever read as the "fullscreen" error after MARKER_TIMEOUT_MS) — derived from the single `accept`-gated
// `findStrip` call, with no second, unguarded scan.

/**
 * Paints the cell matrix at `scale` px/cell in the addon's DEFAULT palette — the two greys
 * addon/bmpl/strip.lua draws (0.10 / 0.45 of white), not black and white, so these end-to-end capture
 * tests run against what a member's screen actually carries.
 */
function paint(cells: Uint8Array, scale: number): Gray {
  const w = 600;
  const h = 300;
  const data = new Uint8Array(w * h).fill(28);
  for (let y = 0; y < STRIP.rows; y++) {
    for (let x = 0; x < STRIP.cols; x++) {
      const v = cells[y * STRIP.cols + x] ? 115 : 26;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) data[(y * scale + dy) * w + (x * scale + dx)] = v;
    }
  }
  return { width: w, height: h, data };
}

/** r = g = b = v round-trips exactly through `toGray`'s Rec. 601 weights (77 + 150 + 29 = 256). */
function grayToRgba(img: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    const v = img.data[i]!;
    out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
  }
  return out;
}

/**
 * A clock that advances one capture period per tick, like the real loop: a frozen clock hid C1 (the
 * panel blanking 10 s into a stable queue) from every task review, so no fake here stands still.
 */
function fakeDepsShowing(rgba: Uint8ClampedArray, w: number, h: number) {
  const tracks: ReturnType<typeof fakeTrack>[] = [];
  const ticks: Array<() => void> = [];
  const activeIds = new Set<number>();
  let nextId = 1;
  let clock = 0;
  const deps: CaptureDeps = {
    getDisplayMedia: async () => {
      const track = fakeTrack();
      tracks.push(track);
      const stream: CaptureStream = { getTracks: () => [track], getVideoTracks: () => [track] };
      return stream;
    },
    createVideo: () => ({
      srcObject: null,
      readyState: 2, // HAVE_CURRENT_DATA: tick() takes the scanning path.
      videoWidth: w,
      videoHeight: h,
      async play() {},
      pause() {},
    }),
    createCanvas: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: rgba }) }),
    }),
    now: () => clock,
    setInterval: (fn) => { const id = nextId++; activeIds.add(id); ticks.push(() => { clock += 1000 / CAPTURE_HZ; fn(); }); return id; },
    clearInterval: (id) => { activeIds.delete(id); },
  };
  return { deps, ticks, activeIds };
}

describe("createCapture: CRC bookkeeping from a single scan", () => {
  test("a marker that is on screen but never decodes trips the scale error, not the marker timeout", async () => {
    const frame = { version: STRIP.version, rosterSeq: 1, chunkIndex: 0, chunkCount: 1, payload: new TextEncoder().encode("a|Foo-Bar") };
    const cells = encodeCells(frame);
    cells[STRIP.cols + 1] = cells[STRIP.cols + 1]! ^ 1; // flip one data bit: marker intact, CRC now fails.
    expect(decodeCells(cells)).toBeNull(); // sanity: this really is undecodable.
    const img = paint(cells, STRIP.cell);
    const rgba = grayToRgba(img);

    const { deps, ticks } = fakeDepsShowing(rgba, img.width, img.height);
    const capture = createCapture(deps);
    await capture.connect();
    const doTick = ticks[0]!;
    for (let i = 0; i < CRC_FAIL_WINDOW; i++) doTick();
    expect(capture.getState()).toEqual({ kind: "error", code: "scale" });
  });
});
