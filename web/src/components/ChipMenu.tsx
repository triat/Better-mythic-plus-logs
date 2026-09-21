import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "../lib/header.ts";

interface Props {
  label: string;
  /** "chip" or "chip chip-on" (the chip reads as a deliberate choice). */
  className: string;
  /** The `menu-head` line. */
  head: string;
  items: MenuItem[];
  onPick: (value: string) => void;
  title?: string;
  /** A rule above the last row (the spec menu's "Other…"). */
  separateLast?: boolean;
}

/** A chip inside the search field that opens a menu under itself; closes on pick, outside click or Escape. Design: canvas "RegionSpec", option B. */
export function ChipMenu({ label, className, head, items, onPick, title, separateLast }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <span className="chip-menu" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={title}>
        {label}
      </button>
      {open && (
        <div className="menu card" role="menu">
          <div className="menu-head">{head}</div>
          {items.map((i, k) => (
            <button
              key={i.value}
              type="button"
              className={"menu-item" + (i.on ? " on" : "") + (separateLast && k === items.length - 1 ? " sep" : "")}
              role="menuitemradio"
              aria-checked={i.on}
              onClick={() => { setOpen(false); onPick(i.value); }}
            >
              {i.label}{i.hint && <span className="n">{i.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
