// Screen capture → roster. `liveState` is pure (no React, no DOM) so capture.test.ts exercises the
// chip's state machine directly; `useWowCapture` is the browser-only loop that feeds it.
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeCells } from "./codec.ts";
import { findStrip, readCells, toGray } from "./scan.ts";
import { RosterAssembler } from "./roster.ts";
import type { Roster } from "./roster.ts";

export const CAPTURE_HZ = 10;
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

const supportsCapture = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

interface Mutable {
  connected: boolean;
  lastFrameAt: number | null;
  lastMarkerAt: number | null;
  crcFails: number;
  crcTotal: number;
}

const initialStats = (): Mutable => ({ connected: false, lastFrameAt: null, lastMarkerAt: null, crcFails: 0, crcTotal: 0 });

export function useWowCapture(): { state: LiveState; roster: Roster | null; connect: () => Promise<void>; disconnect: () => void } {
  const [state, setState] = useState<LiveState>(OFF);
  const [roster, setRoster] = useState<Roster | null>(null);
  const statsRef = useRef<Mutable>(initialStats());
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assemblerRef = useRef(new RosterAssembler());

  const stop = useCallback(() => {
    if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null; }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    videoRef.current?.pause();
    videoRef.current = null;
    canvasRef.current = null;
    assemblerRef.current = new RosterAssembler();
  }, []);

  const disconnect = useCallback(() => {
    stop();
    statsRef.current = initialStats();
    setState(OFF);
    setRoster(null);
  }, [stop]);

  /** `liveState` doesn't know the player count (`CaptureStats` carries no roster) — filled in here from the roster the assembler actually holds. */
  const publish = useCallback((now: number) => {
    const current = assemblerRef.current.current(now);
    setRoster(current);
    const next = liveState({ ...statsRef.current, rosterAt: current?.at ?? null, now });
    setState(next.kind === "live" ? { kind: "live", players: current!.players.length } : next);
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const stats = statsRef.current;
    const now = Date.now();
    if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA) {
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
        // findStrip must validate every candidate row through decodeCells: a decoy pattern drawn
        // elsewhere in the game UI (above the real strip) would otherwise starve detection forever.
        const geom = findStrip(gray, (cells) => decodeCells(cells) !== null);
        if (geom) {
          stats.lastMarkerAt = now;
          const frame = decodeCells(readCells(gray, geom));
          if (frame) {
            stats.crcFails = 0;
            stats.crcTotal = 0;
            assemblerRef.current.push(frame, now);
          } else {
            // Unreachable in practice (findStrip already validated this geometry), kept as a guard.
            stats.crcFails = Math.min(CRC_FAIL_WINDOW, stats.crcFails + 1);
            stats.crcTotal = Math.min(CRC_FAIL_WINDOW, stats.crcTotal + 1);
          }
        } else {
          // No row passed the accept gate. A raw (unvalidated) scan tells us whether a marker-shaped
          // row exists at all: present but never decoding is the "scale too small" error; genuinely
          // absent is the Group Finder simply being closed, which must not count against the CRC ratio.
          const raw = findStrip(gray);
          if (raw) {
            stats.lastMarkerAt = now;
            stats.crcFails = Math.min(CRC_FAIL_WINDOW, stats.crcFails + 1);
            stats.crcTotal = Math.min(CRC_FAIL_WINDOW, stats.crcTotal + 1);
          }
        }
      }
    }
    publish(now);
  }, [publish]);

  const connect = useCallback(async () => {
    if (!supportsCapture()) return; // LiveChip renders the dictionary's "unsupported" message instead of calling this.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CAPTURE_HZ }, audio: false });
    stop();
    statsRef.current = { ...initialStats(), connected: true };
    streamRef.current = stream;
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    videoRef.current = video;
    canvasRef.current = document.createElement("canvas");
    const [track] = stream.getVideoTracks();
    track?.addEventListener("ended", () => {
      statsRef.current.lastFrameAt = null;
      publish(Date.now());
    });
    publish(Date.now());
    intervalRef.current = setInterval(tick, 1000 / CAPTURE_HZ);
  }, [stop, tick, publish]);

  useEffect(() => () => stop(), [stop]);

  return { state, roster, connect, disconnect };
}
