import { classHex, className } from "@shared/wow/classes.ts";
import type { BnetCandidate } from "../../types.ts";
import { makeMainPick, pickCount, pickHeader, pickerRows, saveLabel, togglePick } from "../../lib/bnet.ts";
import { useT } from "../../locale.tsx";

/** Canvas BnetPickA: one list with ticks, highest level first; the first ticked is the main, "make main" moves a row first. */
export function BnetPicker({ battletag, candidates, picked, busy, onChange, onCancel, onSave }: {
  battletag: string | null; candidates: BnetCandidate[]; picked: string[]; busy: boolean;
  onChange: (picked: string[]) => void; onCancel: () => void; onSave: () => void;
}) {
  const { t } = useT();
  return (
    <section className="card bnet-picker">
      <div className="bnet-picker-head">
        <span className="section-title">{t("me.bnet.pickTitle")}</span>
        <span className="muted" style={{ fontSize: 12 }}>{pickHeader(t, battletag, candidates)}</span>
      </div>
      <div className="bnet-pick label-caps" style={{ padding: "2px 12px" }}>
        <span /><span>{t("me.bnet.col.character")}</span><span>{t("me.bnet.col.realm")}</span>
        <span>{t("me.bnet.col.region")}</span><span>{t("me.bnet.col.level")}</span><span />
      </div>
      {pickerRows(candidates, picked).map((r) => {
        const id = `bnet-pick-${r.key}`;
        return (
          <div key={r.key} className={"inset bnet-pick" + (r.disabled ? " bnet-pick-off" : "")}>
            <input
              id={id} type="checkbox" className="bnet-box" checked={r.checked} disabled={r.disabled || busy}
              onChange={() => { const next = togglePick(picked, r.key); if (next) onChange(next); }}
            />
            <label htmlFor={id}>
              <b style={{ color: r.classID !== null ? classHex(r.classID) : undefined }}>{r.name}</b>
              {r.classID !== null && <>{" "}<span className="muted" style={{ fontSize: 12 }}>{className(r.classID)}</span></>}
            </label>
            <span className="bnet-soft">{r.realm}</span>
            <span><span className="chip">{r.region}</span></span>
            <span className="mono">{r.level}</span>
            <span>
              {r.main
                ? <span className="me-main-badge">{t("me.main")}</span>
                : r.checked && (
                  <button type="button" className="link-btn bnet-make-main" disabled={busy} onClick={() => onChange(makeMainPick(picked, r.key))}>
                    {t("me.makeMain")}
                  </button>
                )}
            </span>
          </div>
        );
      })}
      <div className="bnet-picker-foot">
        <span className="muted" style={{ fontSize: 12 }}>{pickCount(t, picked)}</span>
        <div className="grow" />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>{t("me.bnet.cancel")}</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || picked.length === 0} onClick={onSave}>{saveLabel(t, picked.length)}</button>
      </div>
    </section>
  );
}
