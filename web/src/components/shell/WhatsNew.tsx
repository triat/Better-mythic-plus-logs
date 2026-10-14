import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CHANGELOG_EN } from "../../changelog/en.ts";
import { CHANGELOG_FR } from "../../changelog/fr.ts";
import type { ChangelogEntry } from "../../changelog/types.ts";
import { trapFocus } from "../../lib/runSheet.ts";
import { whatsNew } from "../../lib/whatsNew.ts";
import { useT } from "../../locale.tsx";
import { useSettings } from "../../settings.tsx";

const FOCUSABLE = "button, a[href]";

/**
 * The version line under the account block and the changelog side panel (spec
 * docs/superpowers/specs/2026-10-14-whats-new-design.md, decision 6; canvas artboard "Retenu"). A first visit writes the
 * running version silently; opening the panel writes it too, the list keeping what was new when it opened.
 */
export function WhatsNew({ version }: { version: string }) {
  const { t, locale } = useT();
  const { settings, update } = useSettings();
  const entries = locale === "fr" ? CHANGELOG_FR : CHANGELOG_EN;
  const lastSeen = settings.lastSeenVersion;
  const w = whatsNew(entries, lastSeen, version);
  // What was new when the panel opened: writing lastSeenVersion must not empty the list under the reader's eyes.
  const [openedFrom, setOpenedFrom] = useState<string | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const lineRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (lastSeen === null) update({ lastSeenVersion: version });
  }, [lastSeen, version, update]);

  const open = () => {
    setOpenedFrom(lastSeen);
    setShowAll(false);
    if (w.mark) update({ lastSeenVersion: version });
  };
  const close = () => {
    setOpenedFrom(undefined);
    lineRef.current?.focus();
  };
  const isOpen = openedFrom !== undefined;
  const shown = useMemo(() => {
    if (!isOpen) return [];
    const v = whatsNew(entries, openedFrom ?? null, version);
    return showAll || v.since.length === 0 ? v.all : v.since;
  }, [isOpen, entries, openedFrom, version, showAll]);
  const sinceCount = isOpen ? whatsNew(entries, openedFrom ?? null, version).since.length : 0;

  return (
    <>
      <button type="button" ref={lineRef} className="wn-line" aria-expanded={isOpen} aria-controls="whats-new" onClick={isOpen ? close : open}>
        <span className="wn-version">v{version}</span>
        <span className="wn-sep" aria-hidden="true">·</span>
        <span className="wn-label">{t("whatsNew.label")}</span>
        {w.mark && <span className="wn-dot"><span className="sr-only">{t("whatsNew.unread")}</span></span>}
      </button>
      {isOpen && (
        <Panel version={version} entries={shown} sinceCount={sinceCount} showAll={showAll || sinceCount === 0}
          onAll={() => setShowAll(true)} onClose={close} locale={locale} />
      )}
    </>
  );
}

function Panel(p: {
  version: string; entries: ChangelogEntry[]; sinceCount: number; showAll: boolean; locale: string;
  onAll: () => void; onClose: () => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(p.locale, { day: "numeric", month: "short", year: "numeric" }), [p.locale]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); p.onClose(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const next = trapFocus(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (next !== null) { e.preventDefault(); items[next]!.focus(); }
  };
  return (
    <div className="wn">
      <div className="wn-scrim" onClick={p.onClose} aria-hidden="true" />
      <section id="whats-new" ref={ref} className="wn-panel" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" onKeyDown={onKeyDown}>
        <header className="wn-head">
          <div className="wn-titles">
            <h2 id="whats-new-title">{t("whatsNew.label")}</h2>
            <span className="wn-sub">
              {p.showAll ? t("whatsNew.youUse", { version: p.version }) : t("whatsNew.since", { version: p.version })}
            </span>
          </div>
          <button type="button" ref={closeRef} className="wn-close" aria-label={t("whatsNew.close")} onClick={p.onClose}>×</button>
        </header>
        {p.entries.length === 0 ? <p className="wn-empty">{t("whatsNew.empty")}</p> : p.entries.map((e) => (
          <article key={e.version} className="wn-entry">
            <h3><span className="wn-entry-version">{e.version}</span>{e.date && <span className="wn-entry-date">{dateFmt.format(new Date(`${e.date}T12:00:00Z`))}</span>}</h3>
            <ul>{e.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        ))}
        {!p.showAll && <button type="button" className="link-btn wn-all" onClick={p.onAll}>{t("whatsNew.all")}</button>}
      </section>
    </div>
  );
}
