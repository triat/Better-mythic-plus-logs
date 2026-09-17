import {
  type ClipboardBackend,
  detectClipboardReader,
  isPlausibleNameRealm,
} from "../clipboard.ts";
import type { Metric } from "../roles.ts";
import { broadcast } from "./sse.ts";
import { runLookupWithCache } from "./lookup.ts";

// --- Clipboard watcher state machine ---------------------------------------

interface WatcherState {
  active: boolean;
  opts: {
    level: number | null;
    spec: string | null;
    metric: Metric | null;
  };
  intervalId: ReturnType<typeof setInterval> | null;
  backend: ClipboardBackend | null;
  lastSeen: string;
}

const watcher: WatcherState = {
  active: false,
  opts: { level: null, spec: null, metric: null },
  intervalId: null,
  backend: null,
  lastSeen: "",
};

async function watcherTick(): Promise<void> {
  if (!watcher.backend) return;
  let value = "";
  try {
    value = (await watcher.backend.read()).trim();
  } catch (e) {
    broadcast("error", {
      message: "clipboard read failed: " + (e instanceof Error ? e.message : String(e)),
    });
    return;
  }
  if (value === watcher.lastSeen) return;
  watcher.lastSeen = value;
  const parsed = isPlausibleNameRealm(value);
  if (!parsed) return;
  broadcast("searching", { character: value });
  const result = await runLookupWithCache({
    character: value,
    level: watcher.opts.level,
    spec: watcher.opts.spec,
    metric: watcher.opts.metric,
    refresh: false,
  });
  if (result.ok) {
    broadcast("result", { key: result.key, fromCache: result.fromCache });
  } else {
    broadcast("error", { message: result.error, character: value });
  }
}

export type WatcherOpts = WatcherState["opts"];

export async function startWatcher(opts: WatcherOpts): Promise<void> {
  // Always update options — allows reconfiguring without a restart.
  watcher.opts = opts;
  if (watcher.active) {
    broadcast("status", { active: true, opts });
    return;
  }
  try {
    watcher.backend = await detectClipboardReader();
  } catch (e) {
    throw new Error(
      "Clipboard unavailable on this platform: " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  // Seed lastSeen so we don't instantly re-fire on whatever was in the clipboard.
  try {
    watcher.lastSeen = (await watcher.backend.read()).trim();
  } catch {
    watcher.lastSeen = "";
  }
  watcher.active = true;
  watcher.intervalId = setInterval(watcherTick, 750);
  broadcast("status", {
    active: true,
    opts,
    backend: watcher.backend.label,
  });
}

export function stopWatcher(): void {
  if (!watcher.active) return;
  if (watcher.intervalId) {
    clearInterval(watcher.intervalId);
    watcher.intervalId = null;
  }
  watcher.active = false;
  broadcast("status", { active: false });
}

export function watcherStatus(): { active: boolean; opts: WatcherOpts; backend: string | null } {
  return { active: watcher.active, opts: watcher.opts, backend: watcher.backend?.label ?? null };
}
