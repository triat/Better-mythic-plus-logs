// Strip diacritics from Latin letters only. Cyrillic letters like "\u0439"
// (\u0438 + combining breve) and "\u0451" (\u0435 + combining diaeresis) decompose into
// the same combining-mark range as Latin accents, so a blanket NFKD-strip
// would mangle them. We per-char decompose and only drop marks whose base
// is ASCII alphanumeric.
const stripLatinDiacritics = (s: string): string =>
  [...s]
    .map((ch) => {
      const dec = ch.normalize("NFKD");
      return /^[a-z0-9]/.test(dec) ? dec.replace(/[\u0300-\u036f]/g, "") : ch;
    })
    .join("");

export const realmToSlug = (realm: string): string =>
  stripLatinDiacritics(
    realm
      .trim()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase(),
  )
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

export const parseNameRealm = (
  arg: string,
): { name: string; realm: string } | null => {
  const trimmed = arg.trim();
  const idx = trimmed.lastIndexOf("-");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  const name = trimmed.slice(0, idx).trim();
  const realm = trimmed.slice(idx + 1).trim();
  if (!name || !realm) return null;
  return { name, realm };
};

// Matches Raider.IO character URLs like
// https://raider.io/characters/eu/hyjal/Genkii?utm_source=addon
// (protocol/www optional; trailing path segments / query / fragment ignored).
const RAIDER_IO_RE =
  /raider\.io\/characters\/([a-z]{2})\/([^/?#]+)\/([^/?#]+)/i;

export const parseRaiderIOUrl = (
  text: string,
): { region: string; realm: string; name: string } | null => {
  const m = text.match(RAIDER_IO_RE);
  if (!m) return null;
  try {
    return {
      region: m[1]!.toLowerCase(),
      realm: decodeURIComponent(m[2]!),
      name: decodeURIComponent(m[3]!),
    };
  } catch {
    // Malformed URL-encoding — fall back to raw segments.
    return {
      region: m[1]!.toLowerCase(),
      realm: m[2]!,
      name: m[3]!,
    };
  }
};

export const formatDps = (dps: number): string => {
  if (dps >= 1_000_000) return `${(dps / 1_000_000).toFixed(2)}m`;
  if (dps >= 1_000) return `${(dps / 1_000).toFixed(1)}k`;
  return dps.toFixed(0);
};

export const formatInt = (n: number): string =>
  n.toLocaleString("en-US");

export const wclReportUrl = (code: string, fightID: number): string =>
  `https://www.warcraftlogs.com/reports/${code}#fight=${fightID}`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ageInDays = (startTime: number, now = Date.now()): number =>
  Math.max(0, (now - startTime) / DAY_MS);

export const formatAge = (startTime: number, now = Date.now()): string => {
  const delta = now - startTime;
  if (delta < HOUR_MS) return "just now";
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`;
  const days = Math.floor(delta / DAY_MS);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};
