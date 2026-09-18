import type { Metric } from "../roles.ts";
import { parseNameRealm, parseRaiderIOUrl } from "../util.ts";

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const parseMetric = (raw: string | null | undefined): Metric | undefined => {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return v === "dps" || v === "hps" ? v : undefined;
};

export function parseCharacterInput(
  raw: string,
): { name: string; realm: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const rio = parseRaiderIOUrl(s);
  if (rio) return { name: rio.name, realm: rio.realm };
  const fromDash = parseNameRealm(s);
  if (fromDash) return fromDash;
  const bits = s.split(/\s+/);
  return bits.length >= 2
    ? { name: bits[0]!, realm: bits.slice(1).join(" ") }
    : null;
}
