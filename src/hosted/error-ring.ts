// The last uncaught server errors of this process, with their stack: what `/api/ops/logs` reads. The
// audit log keeps a clipped message per `server_error`; to fix a bug the stack is what matters.
// In memory only (empty after a restart): the journal stays the durable record.
import { clip } from "./audit.ts";

export interface ErrorEntry { at: number; target: string | null; message: string; stack: string | null }

export const ERROR_RING_SIZE = 500;
const MAX_STACK = 4000;

export class ErrorRing {
  private readonly entries: ErrorEntry[] = [];

  constructor(private readonly size = ERROR_RING_SIZE) {}

  push(e: unknown, target: string | null, at = Date.now()): void {
    const err = e instanceof Error ? e : null;
    this.entries.push({
      at,
      target: target === null ? null : clip(target, 300),
      message: clip(err ? err.message : String(e), 1000),
      stack: err?.stack ? clip(err.stack, MAX_STACK) : null,
    });
    if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
  }

  /** Newest first, `at >= since` when given, at most `limit`. */
  list(o: { since: number | null; limit: number }): ErrorEntry[] {
    const out: ErrorEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < o.limit; i--) {
      const e = this.entries[i]!;
      if (o.since !== null && e.at < o.since) break;
      out.push(e);
    }
    return out;
  }
}
