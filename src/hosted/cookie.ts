// Cookie helpers for hosted mode. The session cookie carries "<id>.<hmac>" so a forged id is
// rejected by the signature before any database read.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bmpl_session";
export const OAUTH_COOKIE = "bmpl_oauth";
export const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
export const OAUTH_COOKIE_MAX_AGE_S = 600;

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    out.set(name, part.slice(i + 1).trim());
  }
  return out;
}

const hmac = (id: string, secret: string): string => createHmac("sha256", secret).update(id).digest("base64url");

export const signSessionId = (id: string, secret: string): string => `${id}.${hmac(id, secret)}`;

export function verifySessionCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(hmac(id, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export function serializeCookie(name: string, value: string, opts: { maxAgeS: number; path: string; secure: boolean }): string {
  const parts = [`${name}=${value}`, `Max-Age=${opts.maxAgeS}`, `Path=${opts.path}`, "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearCookie = (name: string, opts: { path: string; secure: boolean }): string =>
  serializeCookie(name, "", { maxAgeS: 0, path: opts.path, secure: opts.secure });
