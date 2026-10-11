import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { classHex } from "@shared/wow/classes.ts";
import { useT } from "../locale.tsx";
import { regionLabel } from "../lib/regions.ts";
import { classLine, ghostOf, matchSuggestions, typedNameLength } from "../lib/suggest.ts";
import type { Suggestion } from "../lib/suggest.ts";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Every character the field may suggest (`suggestionsOf`); filtered here as the member types. */
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
}

const LIST_ID = "search-suggest";

/**
 * The search field with its suggestions (canvas "suggest", SuggestChosen: A + C): the highlighted row completes the
 * field in grey (Tab), one list below best first, Enter opens the highlighted row. Rendered inside `.search-box`.
 */
export function SearchInput(p: Props) {
  const { t } = useT();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hl, setHl] = useState(0);
  // The row Tab completed: Enter on that exact text opens it (its region and history tab), like choosing the row.
  const [accepted, setAccepted] = useState<Suggestion | null>(null);
  const rows = useMemo(() => matchSuggestions(p.suggestions, p.value), [p.suggestions, p.value]);
  const open = focused && !dismissed && rows.length > 0;
  const cur = open ? rows[Math.min(hl, rows.length - 1)] : undefined;
  const ghost = open ? ghostOf(p.value, cur) : null;
  const bold = typedNameLength(p.value);

  const change = (v: string) => { setHl(0); setDismissed(false); p.onChange(v); };
  const pick = (s: Suggestion) => { setAccepted(null); setDismissed(true); p.onPick(s); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHl((i) => (Math.min(i, rows.length - 1) + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
    } else if (open && e.key === "Enter" && cur) {
      e.preventDefault();
      pick(cur);
    } else if (open && e.key === "Tab" && !e.shiftKey && cur && ghost !== null) {
      e.preventDefault();
      setAccepted(cur);
      change(cur.fill);
    } else if (open && e.key === "Escape") {
      setDismissed(true);
    } else if (e.key === "Enter" && accepted && p.value === accepted.fill) {
      e.preventDefault();
      pick(accepted);
    }
  };

  return (
    <>
      <span className="search-field">
        <input
          value={p.value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={p.placeholder}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={LIST_ID}
          aria-autocomplete="both"
          aria-activedescendant={cur ? `${LIST_ID}-${rows.indexOf(cur)}` : undefined}
        />
        {ghost !== null && (
          <span className="search-ghost" aria-hidden="true">
            <span className="search-ghost-typed">{p.value}</span>{ghost}<span className="kbd">{t("header.suggest.keyTab")}</span>
          </span>
        )}
      </span>
      {open && (
        <div className="suggest" id={LIST_ID} role="listbox" aria-label={t("header.suggest.label")}>
          {rows.map((s, i) => (
            <div
              key={s.id}
              id={`${LIST_ID}-${i}`}
              role="option"
              aria-selected={s === cur}
              className={"suggest-row" + (s === cur ? " on" : "")}
              // mousedown, not click: the input keeps its focus, so the list does not close before the pick.
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setHl(i)}
            >
              <span className="suggest-name">
                <span style={s.charClass !== null ? { color: classHex(s.charClass) } : undefined}>
                  <b>{s.name.slice(0, bold)}</b>{s.name.slice(bold)}
                </span>{" "}
                <span className="suggest-realm">{s.realm}</span>
              </span>
              <span className="suggest-region mono">{regionLabel(s.region)}</span>
              <span className="suggest-class">{classLine(s)}</span>
            </div>
          ))}
          <div className="suggest-keys">
            <span><span className="kbd">↑</span> <span className="kbd">↓</span> {t("header.suggest.move")}</span>
            <span><span className="kbd">{t("header.suggest.keyTab")}</span> {t("header.suggest.complete")}</span>
            <span><span className="kbd">{t("header.suggest.keyEnter")}</span> {t("header.suggest.open")}</span>
            <span><span className="kbd">{t("header.suggest.keyEsc")}</span> {t("header.suggest.close")}</span>
          </div>
        </div>
      )}
    </>
  );
}
