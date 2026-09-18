// Single-use OAuth `state` tokens, bound to a nonce that lives in the bmpl_oauth cookie:
// the callback must present both, so a link replayed from another browser is refused.
// In-memory on purpose — one bmpl process, ten-minute lifetime.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_STATES = 10_000;

export const newNonce = (): string => randomBytes(32).toString("base64url");

export class OAuthStates {
  private readonly pending = new Map<string, { nonce: string; expiresAt: number }>();

  issue(nonce: string, now: number): string {
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    while (this.pending.size >= MAX_PENDING_STATES) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (oldest) this.pending.delete(oldest);
    }
    const state = randomBytes(32).toString("base64url");
    this.pending.set(state, { nonce, expiresAt: now + OAUTH_STATE_TTL_MS });
    return state;
  }

  consume(state: string, nonce: string, now: number): boolean {
    const entry = this.pending.get(state);
    if (!entry) return false;
    if (entry.expiresAt <= now) { this.pending.delete(state); return false; }
    if (Buffer.byteLength(entry.nonce) !== Buffer.byteLength(nonce) || !timingSafeEqual(Buffer.from(entry.nonce), Buffer.from(nonce))) return false;
    this.pending.delete(state);
    return true;
  }

  size(): number { return this.pending.size; }
}
