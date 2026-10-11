import type { UiControls } from "../../lib/hostedMode.ts";
import { localeMenu } from "../../lib/header.ts";
import { LOCALE_LABELS, detectLocale } from "../../lib/locale.ts";
import type { Locale } from "../../lib/locale.ts";
import { useT } from "../../locale.tsx";
import { ChipMenu } from "../ChipMenu.tsx";

export interface LocalAccountProps {
  /** "Local mode" (`accountView`); not shown when `compact`. */
  title: string;
  controls: UiControls;
  watch: { active: boolean; label: string | null };
  onWatchToggle: (wanted: boolean) => void;
  onSetup: () => void;
  onQuit: () => void;
  /** The home page's top bar: one row, no title; the watcher's line sits in the row. */
  compact?: boolean;
}

/** Local mode's account controls: the EN / FR chip, the clipboard watch, Re-configure and Quit — the sidebar's block,
 *  or (compact) the home page's top bar. */
export function LocalAccount(p: LocalAccountProps) {
  const { t, locale, setLocale } = useT();
  const chip = p.controls.watch && (
    <ChipMenu
      label={LOCALE_LABELS[locale]}
      className={"chip" + (locale !== detectLocale(navigator.language) ? " chip-on" : "")}
      head={t("common.locale.remembered")}
      items={localeMenu(locale)}
      onPick={(v) => setLocale(v as Locale)}
      title={t("common.locale.title")}
    />
  );
  const watch = p.controls.watch && (
    <label className={"watch" + (p.watch.active ? " on" : "")} title={t("header.watch.title")}>
      <input type="checkbox" checked={p.watch.active} onChange={(e) => p.onWatchToggle(e.target.checked)} />
      <span className="switch" />
      <span>{t("header.watch.label")} <b>{p.watch.active ? t("header.watch.on") : t("header.watch.off")}</b></span>
    </label>
  );
  const actions = (p.controls.setup || p.controls.quit) && (
    <div className="account-actions">
      {p.controls.setup && <button type="button" className="btn btn-sm" onClick={p.onSetup}>{t("header.reconfigure")}</button>}
      {p.controls.quit && <button type="button" className="btn btn-sm" onClick={p.onQuit}>{t("header.quit")}</button>}
    </div>
  );
  const note = p.controls.watch && p.watch.label;
  if (p.compact) return <div className="account-local-compact">{chip}{watch}{note && <span className="muted account-watch-note">{note}</span>}{actions}</div>;
  return (
    <div className="account-local">
      <div className="account-local-head">
        <span className="account-name">{p.title}</span>
        {chip}
      </div>
      {watch}
      {note && <span className="side-note muted">{note}</span>}
      {actions}
    </div>
  );
}
