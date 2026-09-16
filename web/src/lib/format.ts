export const STALE_DAYS = 14;
export type Tone = "good" | "warn" | "bad" | "neutral";
export type ParseTier = "legendary" | "magenta" | "blue" | "green" | "gray";

export const fmtAmount = (n: number): string => {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Math.round(n).toString();
};

export const fmtAge = (ms: number, now = Date.now()): string => {
  const d = now - ms;
  const H = 3600e3, D = 24 * H;
  if (d < H) return "just now";
  if (d < D) return Math.floor(d / H) + "h ago";
  const days = Math.floor(d / D);
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  if (days < 365) return Math.floor(days / 30) + "mo ago";
  return Math.floor(days / 365) + "y ago";
};

export const ageDays = (ms: number, now = Date.now()): number => Math.max(0, (now - ms) / 86400000);

export const fmtDuration = (ms: number): string => {
  const t = Math.round(ms / 1000);
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
};

/** "+12" / "−7" (U+2212), optional decimals and unit. */
export const signed = (n: number, digits = 0, unit = ""): string => {
  const v = n.toFixed(digits);
  return (n < 0 ? "−" + v.slice(1) : "+" + v) + unit;
};

export const parseTier = (p: number): ParseTier =>
  p >= 95 ? "legendary" : p >= 75 ? "magenta" : p >= 50 ? "blue" : p >= 25 ? "green" : "gray";

export const deathsTone = (n: number): Tone => (n === 0 ? "good" : n <= 2 ? "warn" : "bad");
/** Lower is better (DTPS, avoidable damage): percent delta vs peers. */
export const lowerTone = (pct: number): Tone => (pct <= -10 ? "good" : pct <= 10 ? "neutral" : pct <= 30 ? "warn" : "bad");
/** Higher is better (kick usage): points delta vs peers. */
export const higherTone = (pts: number): Tone => (pts >= 0 ? "good" : pts < -25 ? "bad" : "neutral");
export const toneClass = (t: Tone): string => (t === "neutral" ? "" : `tone-${t}`);

export const wclUrl = (code: string, fightID: number): string =>
  "https://www.warcraftlogs.com/reports/" + encodeURIComponent(code) + "#fight=" + fightID;

/** Raider.IO URLs come from a third-party API: only link when they really point at raider.io. */
export const rioHref = (url: unknown): string | null =>
  typeof url === "string" && url.startsWith("https://raider.io/") ? url : null;
