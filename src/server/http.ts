import { parseNameRealm, parseRaiderIOUrl } from "../util.ts";
import { type Region, parseRegion } from "../wow/regions.ts";

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** `region` is known only from a Raider.IO URL (its region segment, when it is one of ours); null otherwise. */
export function parseCharacterInput(
  raw: string,
): { name: string; realm: string; region: Region | null } | null {
  const s = raw.trim();
  if (!s) return null;
  const rio = parseRaiderIOUrl(s);
  if (rio) return { name: rio.name, realm: rio.realm, region: parseRegion(rio.region) };
  const fromDash = parseNameRealm(s);
  if (fromDash) return { ...fromDash, region: null };
  const bits = s.split(/\s+/);
  return bits.length >= 2
    ? { name: bits[0]!, realm: bits.slice(1).join(" "), region: null }
    : null;
}
