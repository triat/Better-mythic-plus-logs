import { describe, expect, test } from "bun:test";
import { MAX_PENDING_STATES, OAUTH_STATE_TTL_MS, OAuthStates, newNonce } from "../../src/hosted/oauth-state.ts";

describe("OAuthStates", () => {
  test("issue/consume is single-use and bound to the nonce", () => {
    const s = new OAuthStates();
    const state = s.issue("nonce-a", 1000);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.consume(state, "nonce-b", 1001)).toBe(false); // wrong nonce does not consume
    expect(s.consume(state, "nonce-a", 1001)).toBe(true);
    expect(s.consume(state, "nonce-a", 1002)).toBe(false); // consumed
    expect(s.consume("unknown", "nonce-a", 1002)).toBe(false);
  });
  test("expires after the TTL and prunes on issue", () => {
    const s = new OAuthStates();
    const state = s.issue("n", 0);
    expect(s.consume(state, "n", OAUTH_STATE_TTL_MS)).toBe(false);
    s.issue("m", OAUTH_STATE_TTL_MS + 1);
    expect(s.size()).toBe(1);
  });
  test("nonces are random base64url", () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newNonce()).not.toBe(newNonce());
  });
  test("caps pending states and evicts oldest entries under load", () => {
    const s = new OAuthStates();
    const states: string[] = [];
    for (let i = 0; i < MAX_PENDING_STATES + 5; i++) {
      states.push(s.issue(`nonce-${i}`, 1000));
    }
    expect(s.size()).toBe(MAX_PENDING_STATES);
    expect(s.consume(states[0], "nonce-0", 1001)).toBe(false); // first state evicted
    expect(s.consume(states[MAX_PENDING_STATES + 4], `nonce-${MAX_PENDING_STATES + 4}`, 1001)).toBe(true); // last state consumed
  });
});
