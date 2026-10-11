import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PaletteAction, PaletteSources } from "../../lib/palette.ts";
import { Palette } from "./Palette.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { SidebarProps } from "./Sidebar.tsx";

interface Props {
  sidebar: SidebarProps;
  palette: { sources: PaletteSources; yourKey: number | null; onRun: (a: PaletteAction) => void };
  children: ReactNode;
}

/** A text field other than the sidebar's search: Ctrl K there belongs to the field (or the browser), not to us. */
function typingElsewhere(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest(".side-search")) return false;
  return el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type));
}

/**
 * The frame around every in-app page (redesign spec decision 1): the sidebar, the page in `.shell-main`, and the
 * command palette. One `keydown` listener on `window` opens the palette on Ctrl K / Cmd K.
 */
export function Shell({ sidebar, palette, children }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      if (typingElsewhere(document.activeElement)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="shell">
      <Sidebar {...sidebar} onOpenPalette={() => setOpen(true)} />
      <main className="shell-main">
        <div className="shell-content">{children}</div>
      </main>
      {open && <Palette {...palette} onClose={() => setOpen(false)} />}
    </div>
  );
}
