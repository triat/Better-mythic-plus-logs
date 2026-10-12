import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

const MEASURE = { position: "fixed", top: 0, visibility: "hidden" } as const;

/** A chip inside the search field that opens a menu under itself; closes on pick, outside click or Escape. Design: canvas "RegionSpec", option B. */
export function ChipMenu({ label, className, head, items, onPick, title, separateLast }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The menu opens under its chip; near a viewport edge (a phone, a chip on the right) it slides back inside, 16 px off.
  // It is first laid out hidden and fixed (it cannot widen the page then), measured, then placed: a menu that overflows
  // even for one layout makes a phone browser zoom the page out.
  const [shift, setShift] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) { setShift(null); return; }
    if (shift !== null || !menu.current || !ref.current) return;
    const vw = document.documentElement.clientWidth;
    const m = menu.current.getBoundingClientRect();
    const chip = ref.current.getBoundingClientRect();
    // Fixed, a menu the stylesheet anchors left sits at the viewport's left edge, one anchored right at its right edge.
    const natural = m.left > 1 ? chip.right - m.width : chip.left;
    setShift(Math.round(Math.max(16, Math.min(vw - 16 - m.width, natural)) - natural));
  }, [open, shift]);
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
        <div className="menu card" role="menu" ref={menu} style={shift === null ? MEASURE : shift !== 0 ? { transform: `translateX(${shift}px)` } : undefined}>
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
