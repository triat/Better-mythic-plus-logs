// Feature-usage tracking in the browser (spec 2026-10-09-feature-usage-dashboard-design.md, decision 5):
// interface events are counted in memory and sent in batches. Pure: the timers, the visibility listener
// and the network call are injected by `web/src/usage.ts`.
import type { UiEvent } from "../types.ts";

/** A batch is sent once it holds this many events (or a name reaches the server's per-name cap). */
export const FLUSH_AT = 20;
/** …and in any case every this many ms while something is queued. */
export const FLUSH_EVERY_MS = 15_000;
/** The server's `USAGE_BATCH_MAX_COUNT`: one name never carries more in a batch. */
export const MAX_PER_NAME = 50;

export type UsageBatch = Partial<Record<UiEvent, number>>;
export type Send = (events: UsageBatch, keepalive: boolean) => void;

export interface Tracker {
  /** Counts one use; a no-op while disabled. Sends right away when the batch is full. */
  track(event: UiEvent): void;
  /** Sends what is queued (nothing when empty). `keepalive` for a page that is being hidden. */
  flush(keepalive: boolean): void;
  /** Off (local mode, signed out): drops the queue and ignores `track`. */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  readonly queued: number;
}

export function createTracker(send: Send): Tracker {
  let on = false;
  let counts = new Map<UiEvent, number>();
  let total = 0;
  const flush = (keepalive: boolean): void => {
    if (total === 0) return;
    const batch: UsageBatch = Object.fromEntries(counts);
    counts = new Map();
    total = 0;
    send(batch, keepalive);
  };
  return {
    track(event) {
      if (!on) return;
      const n = (counts.get(event) ?? 0) + 1;
      counts.set(event, n);
      total++;
      if (total >= FLUSH_AT || n >= MAX_PER_NAME) flush(false);
    },
    flush,
    setEnabled(value) {
      on = value;
      if (!value) { counts = new Map(); total = 0; }
    },
    get enabled() { return on; },
    get queued() { return total; },
  };
}
