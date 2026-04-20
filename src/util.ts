export const realmToSlug = (realm: string): string =>
  realm
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
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
