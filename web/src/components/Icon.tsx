// Inline SVG icons (redesign spec: no icon package). Stroke icons on a 24×24 grid in `currentColor`; the paths of
// search, home, users, user, compare, live, help and bolt are the mockups' (docs/design/redesign/F-Palette.dc.html,
// F-Accueil.dc.html). The Discord mark is the one filled icon, on its own 127×96 grid.
import type { ReactNode } from "react";
import type { IconName as NavIconName } from "../lib/shell.ts";

export type IconName = NavIconName | "search" | "close" | "chevron" | "more" | "settings" | "logout" | "admin" | "bolt" | "arrow" | "clock" | "lock" | "info" | "discord";

const STROKE: Record<Exclude<IconName, "discord">, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.5-5 6.5-5s5.7 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.3 3.5 5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></>,
  compare: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></>,
  live: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
  settings: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  logout: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />,
  admin: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
};

const DISCORD = "M107.7 8.1A105.2 105.2 0 0 0 81.5 0c-1.1 2-2.4 4.7-3.3 6.8a97.7 97.7 0 0 0-29.1 0C48.2 4.7 46.9 2 45.7 0a105 105 0 0 0-26.2 8.1C2.9 33.2-1.6 57.6.6 81.7a106 106 0 0 0 32.2 16.2c2.6-3.5 4.9-7.3 6.9-11.2a68.6 68.6 0 0 1-10.9-5.2c.9-.7 1.8-1.4 2.7-2.1a75.6 75.6 0 0 0 64.6 0c.9.7 1.8 1.4 2.7 2.1-3.5 2.1-7.1 3.8-10.9 5.2 2 3.9 4.3 7.7 6.9 11.2a105.8 105.8 0 0 0 32.2-16.2c2.6-27.9-4.5-52.1-18.9-73.6zM42.5 66.9c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5.1 12.9-11.5 12.9zm42.5 0c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5 12.9-11.5 12.9z";

/** `size` is the height in px; the Discord mark keeps its 5:4 box (20 × 16 at size 16). */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === "discord") {
    return (
      <svg width={Math.round(size * 1.25)} height={size} viewBox="0 0 127 96" fill="currentColor" aria-hidden="true">
        <path d={DISCORD} />
      </svg>
    );
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {STROKE[name]}
    </svg>
  );
}
