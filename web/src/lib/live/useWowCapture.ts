// Screen capture → roster. `liveState` is pure (no React, no DOM) so capture.test.ts exercises the
// chip's state machine directly. `createCapture` is the browser-loop *logic*, built against an
// injectable `CaptureDeps` so its lifecycle (teardown on the track's `ended` event or `disconnect()`,
// no leaked interval/listener across two `connect()`s) is testable with fake deps and no real DOM;
// `useWowCapture` is a thin React wrapper around it (real `navigator`/`document`/timers as deps).
import { useEffect, useRef, useState } from "react";
import { decodeCells } from "./codec.ts";
import type { LiveFrame } from "./codec.ts";
import { findStrip, toGray } from "./scan.ts";
import { RosterAssembler } from "./roster.ts";
import type { Roster } from "./roster.ts";

export const CAPTURE_HZ = 20;
export const MARKER_TIMEOUT_MS = 5_000;
/** A window of frames: `crcTotal` never grows past it, so the ratio below is always over a bounded, recent sample. */
export const CRC_FAIL_WINDOW = 50;
export const CRC_FAIL_RATIO = 0.5;

/** The addon only ever draws in the corner; cropping keeps the canvas small regardless of the shared window's size. */
const CROP_W = 900;
const CROP_H = 500;

export interface CaptureStats {
  connected: boolean;
  lastFrameAt: number | null;
  lastMarkerAt: number | null;
  rosterAt: number | null;
  crcFails: number;
  crcTotal: number;
  now: number;
}

export type LiveState =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "live"; players: number }
  | { kind: "reconnect" }
  | { kind: "error"; code: "fullscreen" | "scale" };

/**
 * The chip's state machine. `rosterAt` and `lastMarkerAt` are timestamps of the last time each was
 * true (not booleans): a caller that keeps `rosterAt` fresh only while `RosterAssembler.current(now)`
 * is non-null gets "live" exactly while a roster is actually on screen, with no extra staleness math
 * needed here. `lastMarkerAt: null` means "never established" (e.g. the Group Finder is simply closed,
 * which is normal) and never times out on its own — only a marker that WAS seen and then vanishes for
 * `MARKER_TIMEOUT_MS` reads as the exclusive-fullscreen error.
 */
export function liveState(s: CaptureStats): LiveState {
  if (!s.connected) return { kind: "off" };
  if (s.lastFrameAt === null) return { kind: "reconnect" };
  if (s.crcTotal >= CRC_FAIL_WINDOW && s.crcFails / s.crcTotal > CRC_FAIL_RATIO) return { kind: "error", code: "scale" };
  if (s.lastMarkerAt !== null && s.now - s.lastMarkerAt >= MARKER_TIMEOUT_MS) return { kind: "error", code: "fullscreen" };
  if (s.rosterAt !== null) return { kind: "live", players: 0 };
  return { kind: "waiting" };
}

const OFF: LiveState = { kind: "off" };

/**
 * `publish`'s "notify only on a real transition" check (review round 1, finding 1): compares the fields
 * each `kind` actually carries, not object identity — `liveState` returns a fresh object literal every
 * call, so `a === b` would never be true even when nothing changed.
 */
function sameLiveState(a: LiveState, b: LiveState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "live" && b.kind === "live") return a.players === b.players;
  if (a.kind === "error" && b.kind === "error") return a.code === b.code;
  return true; // off / waiting / reconnect carry no other field
}

// --- Injectable capture surface -------------------------------------------------------------------
// Narrow shapes of the DOM APIs the loop actually calls, so a test can supply fakes with no real
// browser: a real MediaStreamTrack/HTMLVideoElement/HTMLCanvasElement structurally satisfies these
// (browserDeps below adapts them with a boundary cast) without dragging the full DOM surface into a test.

export interface CaptureTrack {
  stop(): void;
  addEventListener(type: "ended", listener: () => void): void;
}
export interface CaptureStream {
  getTracks(): CaptureTrack[];
  getVideoTracks(): CaptureTrack[];
}
export interface CaptureVideo {
  srcObject: CaptureStream | null;
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
  pause(): void;
}
export interface CaptureImageData { data: Uint8ClampedArray }
export interface CaptureContext2D {
  drawImage(source: CaptureVideo, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): CaptureImageData;
}
export interface CaptureCanvas {
  width: number;
  height: number;
  getContext(type: "2d", options?: { willReadFrequently?: boolean }): CaptureContext2D | null;
}
export interface CaptureDeps {
  getDisplayMedia(): Promise<CaptureStream>;
  createVideo(stream: CaptureStream): CaptureVideo;
  createCanvas(): CaptureCanvas;
  now(): number;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** `readyState >= HAVE_CURRENT_DATA` (2): the video has at least one decoded frame to draw. Hardcoded
 * rather than read off a real `HTMLVideoElement` so `CaptureVideo` stays a plain data shape for fakes. */
const HAVE_CURRENT_DATA = 2;

interface Mutable {
  connected: boolean;
  lastFrameAt: number | null;
  lastMarkerAt: number | null;
  crcFails: number;
  crcTotal: number;
}

const initialStats = (): Mutable => ({ connected: false, lastFrameAt: null, lastMarkerAt: null, crcFails: 0, crcTotal: 0 });

export interface Capture {
  getState(): LiveState;
  getRoster(): Roster | null;
  /** Fires after every state/roster change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
}

/**
 * The capture loop against an injected `CaptureDeps`, with no DOM/React of its own — see
 * capture.test.ts's `createCapture` suite for the lifecycle this guards: the track's `ended` event
 * (browser "Stop sharing") must tear the whole session down and latch `{ kind: "reconnect" }` so that
 * no tick still in flight (real or forced by a test) can silently revert the chip to "live"; `connect()`
 * is the only thing that clears that latch.
 */
export function createCapture(deps: CaptureDeps): Capture {
  let state: LiveState = OFF;
  let roster: Roster | null = null;
  const listeners = new Set<() => void>();

  let stats: Mutable = initialStats();
  let stream: CaptureStream | null = null;
  let video: CaptureVideo | null = null;
  let canvas: CaptureCanvas | null = null;
  let intervalId: number | null = null;
  let assembler = new RosterAssembler();
  /** Set by `ended`/`disconnect`, cleared only by a fresh `connect()`: guards `tick` even if something
   * (a stray timer, a test) invokes it after the session it belonged to has already been torn down. */
  let latched = true;

  const notify = () => { for (const l of listeners) l(); };

  const teardown = () => {
    if (intervalId !== null) { deps.clearInterval(intervalId); intervalId = null; }
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video?.pause();
    video = null;
    canvas = null;
    assembler = new RosterAssembler();
  };

  const publish = (now: number) => {
    const current = assembler.current(now);
    // `RosterAssembler.current()` returns the SAME object reference across every tick that re-decodes an
    // unchanged, already-assembled roster (it only ever creates a new object when a roster completes) —
    // so reference inequality is exactly "a new roster arrived or the old one went stale", not a proxy.
    const rosterChanged = current !== roster;
    const next = liveState({ ...stats, rosterAt: current?.at ?? null, now });
    const nextState: LiveState = next.kind === "live" ? { kind: "live", players: current!.players.length } : next;
    const stateChanged = !sameLiveState(state, nextState);
    roster = current;
    // Review round 1, finding 1: at CAPTURE_HZ (10/s) this ran unconditionally, so every tick re-rendered
    // the whole `Main` tree while connected. Notify only on a real transition.
    if (!rosterChanged && !stateChanged) return;
    state = nextState;
    notify();
  };

  const tick = () => {
    if (latched) return; // the session this tick was scheduled for has already ended.
    const now = deps.now();
    if (!video || !canvas || video.readyState < HAVE_CURRENT_DATA) {
      publish(now);
      return;
    }
    stats.lastFrameAt = now;
    const w = Math.min(video.videoWidth, CROP_W);
    const h = Math.min(video.videoHeight, CROP_H);
    if (w > 0 && h > 0) {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const gray = toGray(data, w, h);
        // One scan per tick. `accept` both validates a candidate row (so a decoy pattern drawn
        // elsewhere in the game UI, above the real strip, is skipped rather than returned) and records
        // what it saw, so a null `findStrip` result can still tell "no marker row anywhere" (Group
        // Finder simply closed — normal) apart from "a marker row exists but nothing under it decodes"
        // (the strip is on screen but unreadable — the scale error) without a second scan.
        let seenCandidate = false;
        let decoded: LiveFrame | null = null;
        const geom = findStrip(gray, (cells) => {
          seenCandidate = true;
          decoded = decodeCells(cells);
          return decoded !== null;
        });
        if (geom && decoded) {
          stats.lastMarkerAt = now;
          stats.crcFails = 0;
          stats.crcTotal = 0;
          assembler.push(decoded, now);
        } else if (seenCandidate) {
          stats.lastMarkerAt = now;
          stats.crcFails = Math.min(CRC_FAIL_WINDOW, stats.crcFails + 1);
          stats.crcTotal = Math.min(CRC_FAIL_WINDOW, stats.crcTotal + 1);
        }
      }
    }
    publish(now);
  };

  const disconnect = () => {
    latched = true;
    teardown();
    stats = initialStats();
    roster = null;
    state = OFF;
    notify();
  };

  const connect = async () => {
    teardown(); // drop whatever the previous session (if any) left running before starting a new one.
    latched = true;
    const nextStream = await deps.getDisplayMedia();
    stream = nextStream;
    // `lastFrameAt` is set here, not left for the first tick: without it the state machine would read
    // "reconnect" (lastFrameAt === null) for the ~100 ms until that first tick runs.
    stats = { ...initialStats(), connected: true, lastFrameAt: deps.now() };
    video = deps.createVideo(nextStream);
    await video.play().catch(() => {});
    canvas = deps.createCanvas();
    const [track] = nextStream.getVideoTracks();
    track?.addEventListener("ended", () => {
      if (stream !== nextStream) return; // a later connect() already replaced this session.
      latched = true;
      teardown();
      stats.lastFrameAt = null;
      publish(deps.now());
    });
    latched = false;
    publish(deps.now());
    intervalId = deps.setInterval(tick, 1000 / CAPTURE_HZ);
  };

  return {
    getState: () => state,
    getRoster: () => roster,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    connect,
    disconnect,
  };
}

const supportsCapture = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

const browserDeps: CaptureDeps = {
  getDisplayMedia: async () => {
    if (!supportsCapture()) throw new Error("getDisplayMedia unsupported"); // LiveChip never offers the button in this case; belt and suspenders.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CAPTURE_HZ }, audio: false });
    return stream as unknown as CaptureStream;
  },
  createVideo: (stream) => {
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = stream as unknown as MediaStream;
    return video as unknown as CaptureVideo;
  },
  createCanvas: () => document.createElement("canvas") as unknown as CaptureCanvas,
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id) => clearInterval(id),
};

export function useWowCapture(): { state: LiveState; roster: Roster | null; connect: () => Promise<void>; disconnect: () => void } {
  const captureRef = useRef<Capture | null>(null);
  captureRef.current ??= createCapture(browserDeps);
  const capture = captureRef.current;
  const [state, setState] = useState<LiveState>(capture.getState());
  const [roster, setRoster] = useState<Roster | null>(capture.getRoster());

  useEffect(() => capture.subscribe(() => { setState(capture.getState()); setRoster(capture.getRoster()); }), [capture]);
  useEffect(() => () => capture.disconnect(), [capture]);

  return { state, roster, connect: capture.connect, disconnect: capture.disconnect };
}
