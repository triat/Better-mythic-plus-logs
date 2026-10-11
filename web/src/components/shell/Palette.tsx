import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { classHex } from "@shared/wow/classes.ts";
import { moveIndex, paletteSections, rowAt } from "../../lib/palette.ts";
import type { PaletteAction, PaletteRow, PaletteSources } from "../../lib/palette.ts";
import { regionLabel } from "../../lib/regions.ts";
import { useT } from "../../locale.tsx";
import { Icon } from "../Icon.tsx";

interface Props {
  sources: PaletteSources;
  /** "Your key" for the chip beside the input (display only), null = auto. */
  yourKey: number | null;
  onRun: (a: PaletteAction) => void;
  onClose: () => void;
}

const LIST_ID = "palette-list";

/**
 * The Ctrl K command palette (redesign spec decision 1, mockup F-Palette): a modal dialog, focus kept in its input,
 * ↑ / ↓ over every row of every section, Enter runs the highlighted row, Escape or a click outside closes it and focus
 * returns where it was. Rendered only while open (`Shell` owns that state).
 */
export function Palette({ sources, yourKey, onRun, onClose }: Props) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const sections = useMemo(() => paletteSections(t, q, sources), [t, q, sources]);
  const current = rowAt(sections, index);

  // Focus in on open; back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => { before?.focus(); };
  }, []);

  const run = (r: PaletteRow) => { onClose(); onRun(r.action); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => moveIndex(sections, i, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) run(current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      // The input is the dialog's only tab stop: focus stays trapped in it.
      e.preventDefault();
    }
  };

  let flat = -1;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
        <label className="palette-input">
          <Icon name="search" size={20} />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.input")}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={sections.length > 0}
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={current ? `${LIST_ID}-${index}` : undefined}
          />
          <span className="chip">{regionLabel(sources.region)}</span>
          <span className="chip mono">{yourKey === null ? t("header.key.auto") : `+${yourKey}`}</span>
        </label>
        <div className="palette-list" id={LIST_ID} role="listbox" aria-label={t("palette.label")}>
          {sections.length === 0 && <div className="palette-empty muted">{t("palette.empty")}</div>}
          {sections.map((s) => (
            <div key={s.title} role="group" aria-label={s.title}>
              <div className="palette-title" aria-hidden="true">{s.title}</div>
              {s.rows.map((r) => {
                flat += 1;
                const i = flat;
                const on = i === index;
                return (
                  <div
                    key={r.id}
                    id={`${LIST_ID}-${i}`}
                    role="option"
                    aria-selected={on}
                    className={"palette-row" + (on ? " on" : "")}
                    // mousedown, not click: the input keeps its focus.
                    onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); run(r); }}
                    onMouseEnter={() => setIndex(i)}
                  >
                    <span className="palette-badge" aria-hidden="true">
                      {r.action.kind === "go"
                        ? <Icon name="arrow" size={14} />
                        : <span className="palette-dot" style={r.classId !== null ? { background: classHex(r.classId) } : undefined} />}
                    </span>
                    <span className="palette-main">
                      <span className="palette-label" style={r.classId !== null ? { color: classHex(r.classId) } : undefined}>{r.label}</span>
                      {r.detail && <span className="palette-detail">{r.detail}</span>}
                    </span>
                    {r.hint && <span className={"palette-hint mono " + (r.verdict ?? "")}>{r.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-keys">
          <span><span className="kbd">{t("palette.keys.arrows")}</span> {t("palette.keys.move")}</span>
          <span><span className="kbd">{t("header.suggest.keyEnter")}</span> {t("palette.keys.open")}</span>
          <span><span className="kbd">{t("header.suggest.keyEsc")}</span> {t("palette.keys.close")}</span>
        </div>
      </div>
    </div>
  );
}
