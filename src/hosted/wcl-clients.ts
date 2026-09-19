// A member's own WCL client (issue #11 Task 2): stores an encrypted secret, runs the verification
// PING through `runWithWclClient`, and keeps the last-seen rate-limit snapshot in memory (own-client
// requests never touch `PointsMeter`, so it is not visible anywhere else). Disabled instance-wide
// when `BMPL_ENCRYPTION_KEY` is not set.
import { PING_QUERY } from "../wcl/queries.ts";
import { forgetToken } from "../wcl/auth.ts";
import type { WclCredentials } from "../wcl/auth.ts";
import { WclError, gql, runWithWclClient } from "../wcl/client.ts";
import type { RateLimit } from "../wcl/client.ts";
import type { RateLimitData } from "../wcl/types.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { clip } from "./audit.ts";
import { abbreviate } from "./instance.ts";
import type { HostedDb } from "./db.ts";

export interface OwnClientView {
  clientId: string; // abbreviated
  verifiedAt: number | null;
  updatedAt: number;
  snapshot: OwnClientSnapshot | null;
}

export interface OwnClientSnapshot {
  pointsSpentThisHour: number;
  limitPerHour: number;
  pointsResetIn: number;
  observedAt: number;
}

export type VerifyOutcome = { ok: true; rateLimit: RateLimit } | { ok: false; error: string };
export type Verify = (creds: WclCredentials) => Promise<VerifyOutcome>;

/** Runs the 0-pt PING against `creds`'s own client; a `WclError` reports its `publicMessage`, anything else a clipped message. */
export const verifyWithPing: Verify = async (creds) => {
  try {
    const data = await runWithWclClient({ creds, onRateLimit: null }, () => gql<RateLimitData>(PING_QUERY));
    return { ok: true, rateLimit: data.rateLimitData };
  } catch (e) {
    if (e instanceof WclError) return { ok: false, error: e.publicMessage };
    return { ok: false, error: clip(e instanceof Error ? e.message : String(e), 200) };
  }
};

export class UserWclClients {
  private readonly snapshots = new Map<number, OwnClientSnapshot>();
  private readonly warned = new Set<number>();

  constructor(
    private readonly deps: { repo: HostedDb["wclClients"]; key: Uint8Array | null; verify: Verify; now?: () => number },
  ) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  get enabled(): boolean {
    return this.deps.key !== null;
  }

  view(userId: number): OwnClientView | null {
    if (!this.enabled) return null;
    const row = this.deps.repo.get(userId);
    if (!row) return null;
    return {
      clientId: abbreviate(row.clientId),
      verifiedAt: row.verifiedAt,
      updatedAt: row.updatedAt,
      snapshot: this.snapshots.get(userId) ?? null,
    };
  }

  async save(userId: number, creds: WclCredentials, now?: number): Promise<{ ok: true; client: OwnClientView } | { ok: false; status: 400 | 503; error: string }> {
    if (!this.enabled) return { ok: false, status: 503, error: "This instance does not store WCL clients (no BMPL_ENCRYPTION_KEY)" };
    const outcome = await this.deps.verify(creds);
    if (!outcome.ok) return { ok: false, status: 400, error: `WCL refused these credentials: ${outcome.error}` };
    const at = now ?? this.now();
    const secretEnc = await encrypt(this.deps.key!, creds.clientSecret);
    this.deps.repo.put({ userId, clientId: creds.clientId, secretEnc, verifiedAt: at, now: at });
    // A re-saved secret must not reuse a token minted with the old one — harmless, but explicit.
    forgetToken(creds.clientId);
    this.observe(userId, outcome.rateLimit);
    return { ok: true, client: this.view(userId)! };
  }

  async verify(userId: number, now?: number): Promise<{ ok: true; client: OwnClientView } | { ok: false; status: 400 | 404 | 503; error: string }> {
    if (!this.enabled) return { ok: false, status: 503, error: "This instance does not store WCL clients (no BMPL_ENCRYPTION_KEY)" };
    const row = this.deps.repo.get(userId);
    if (!row) return { ok: false, status: 404, error: "No WCL client saved" };
    const clientSecret = await decrypt(this.deps.key!, row.secretEnc);
    if (clientSecret === null) {
      this.warnUndecryptable(userId);
      return { ok: false, status: 400, error: "Stored secret cannot be decrypted — save the client again" };
    }
    const outcome = await this.deps.verify({ clientId: row.clientId, clientSecret });
    if (!outcome.ok) return { ok: false, status: 400, error: `WCL refused these credentials: ${outcome.error}` };
    const at = now ?? this.now();
    this.deps.repo.setVerified(userId, at);
    this.observe(userId, outcome.rateLimit);
    return { ok: true, client: this.view(userId)! };
  }

  remove(userId: number): boolean {
    this.snapshots.delete(userId);
    const row = this.deps.repo.get(userId);
    if (row) forgetToken(row.clientId);
    return this.deps.repo.remove(userId);
  }

  /** null when disabled, absent, or undecryptable (logs once per process per user). */
  async credentials(userId: number): Promise<WclCredentials | null> {
    if (!this.enabled) return null;
    const row = this.deps.repo.get(userId);
    if (!row) return null;
    const clientSecret = await decrypt(this.deps.key!, row.secretEnc);
    if (clientSecret === null) {
      this.warnUndecryptable(userId);
      return null;
    }
    return { clientId: row.clientId, clientSecret };
  }

  observe(userId: number, rl: RateLimit): void {
    this.snapshots.set(userId, { ...rl, observedAt: this.now() });
  }

  /** Drops the snapshot + forgetToken(client id) — for DELETE /api/me. */
  forget(userId: number): void {
    this.snapshots.delete(userId);
    const row = this.deps.repo.get(userId);
    if (row) forgetToken(row.clientId);
  }

  private warnUndecryptable(userId: number): void {
    if (this.warned.has(userId)) return;
    this.warned.add(userId);
    console.error(`wcl client of user ${userId} cannot be decrypted (key changed?)`);
  }
}
