import { useEffect } from "react";

/** Wowhead's tooltip script (loaded in index.html) exposes this global once ready. */
declare global {
  interface Window { $WowheadPower?: { refreshLinks?: () => void } }
}

/**
 * A spell name linking to Wowhead; the tooltip script attaches the spell's description on hover.
 * Without an id (WCL gave no guid) the name renders as plain text.
 */
export function SpellLink({ id, name, className }: { id: number | null; name: string; className?: string }) {
  if (id === null) return <span className={className}>{name}</span>;
  return (
    <a href={`https://www.wowhead.com/spell=${id}`} data-wowhead={`spell=${id}`} className={"spell" + (className ? " " + className : "")} target="_blank" rel="noopener">
      {name}
    </a>
  );
}

/** Ask Wowhead's script to (re)scan links after React rendered new ones — tooltips need it for dynamic content. */
export function useWowheadRefresh(dep: unknown): void {
  useEffect(() => { window.$WowheadPower?.refreshLinks?.(); }, [dep]);
}
