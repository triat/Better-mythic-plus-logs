import { useEffect, useState } from "react";
import type { TocEntry } from "../../lib/help.ts";

/** Sticky table of contents; the entry whose section is in view (first in TOC order among the visible ones) is highlighted. */
export function HelpToc({ entries }: { entries: TocEntry[] }) {
  const [current, setCurrent] = useState<string>(entries[0]?.anchor ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const io = new IntersectionObserver((records) => {
      for (const r of records) {
        const id = (r.target as HTMLElement).id;
        if (r.isIntersecting) visible.add(id); else visible.delete(id);
      }
      const first = entries.find((e) => visible.has(e.anchor));
      if (first) setCurrent(first.anchor);
    }, { rootMargin: "-10% 0px -60% 0px" });
    for (const e of entries) {
      const el = document.getElementById(e.anchor);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [entries]);
  return (
    <nav className="help-toc">
      {entries.map((e) => (
        <a key={e.anchor} href={`#${e.anchor}`} className={(e.sub ? "sub" : "") + (e.anchor === current ? " on" : "")}>{e.label}</a>
      ))}
    </nav>
  );
}
