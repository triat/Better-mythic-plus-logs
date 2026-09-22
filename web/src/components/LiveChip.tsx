import { useEffect, useRef, useState } from "react";
import { useT } from "../locale.tsx";
import type { LiveState } from "../lib/live/useWowCapture.ts";
import { Around } from "./Around.tsx";

/** True once, at mount, and never re-derived: a browser either has `getDisplayMedia` or it doesn't. */
const SUPPORTS_CAPTURE = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

/**
 * The Live chip (header, right of the search / before the locale chip locally, before the user menu
 * hosted): a screen-capture status dot plus the connect dialog and the two in-game error cards.
 * Design: canvas "Live", variant A ("Shared — the Live chip's states" / "the connect dialog").
 *
 * `state`/`connect` come from `Main`'s single `useWowCapture()` (Task 7): the Live panel needs the same
 * roster, and two independent hook instances would each open their own `getDisplayMedia()` capture (a
 * second permission prompt, two scan loops) — so this chip no longer owns the hook itself.
 */
export function LiveChip({ state, connect }: { state: LiveState; connect: () => Promise<void> }) {
  const { t } = useT();
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

  // Only "off", "reconnect" (pick the window again) and "error" (show the fix) need a click; "waiting"
  // and "live" are a plain status dot — nothing in the dialog would help once capture is already running.
  const interactive = state.kind === "off" || state.kind === "reconnect" || state.kind === "error";
  const label =
    state.kind === "live" ? t("live.chip.on", { count: state.players }) :
    state.kind === "reconnect" ? t("live.chip.reconnect") :
    state.kind === "off" ? t("live.chip.off") :
    t("live.chip.waiting"); // "waiting" and "error" share the neutral label; the error's fix shows in the dialog.
  const dotClass = state.kind === "live" ? "live-dot" : state.kind === "reconnect" || state.kind === "error" ? "live-dot warn" : "live-dot grey";
  const chipClass = "live-chip" + (state.kind === "live" ? " on" : state.kind === "reconnect" ? " err" : "");

  const go = async () => {
    setOpen(false);
    try {
      await connect();
    } catch {
      // The browser's own picker was cancelled — state stays "off", nothing else to do.
    }
  };

  return (
    <span className="live-chip-wrap" ref={ref}>
      {interactive ? (
        <button type="button" className={chipClass} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
          <span className={dotClass} />{label}
        </button>
      ) : (
        <span className={chipClass}>
          <span className={dotClass} />{label}
        </span>
      )}
      {open && state.kind === "error" && (
        <div className="card live-dialog live-dialog-error" role="dialog">
          <div className="section-title">{t(`live.error.${state.code}`)}</div>
          <p>{t(`live.error.${state.code}Sub`)}</p>
          <div className="live-dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t("common.close")}</button>
          </div>
        </div>
      )}
      {open && state.kind !== "error" && !SUPPORTS_CAPTURE && (
        <div className="card live-dialog" role="dialog">
          <div className="section-title">{t("live.connect.title")}</div>
          <p>{t("live.error.unsupported")}</p>
          <div className="live-dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t("common.close")}</button>
          </div>
        </div>
      )}
      {open && state.kind !== "error" && SUPPORTS_CAPTURE && (
        <div className="card live-dialog" role="dialog">
          <div className="section-title">{t("live.connect.title")}</div>
          <p><Around message={t("live.connect.pick")} params={{ game: <b className="text-soft">{t("live.connect.game")}</b> }} /></p>
          <p><Around message={t("live.connect.privacy")} params={{ neverLeaves: <b className="text-soft">{t("live.connect.neverLeaves")}</b> }} /></p>
          <p><Around message={t("live.connect.needs")} params={{ fullscreen: <b className="text-soft">{t("live.connect.fullscreen")}</b> }} /></p>
          <div className="live-dialog-actions">
            <button type="button" className="btn btn-primary" onClick={go}>{t("live.connect.go")}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t("live.connect.cancel")}</button>
            <a className="live-addon-link" href="/help#live-addon">{t("live.connect.addon")}</a>
          </div>
        </div>
      )}
    </span>
  );
}
