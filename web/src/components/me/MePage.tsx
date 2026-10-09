import { useState } from "react";
import type { HistoryItem, MyCharacter, Region } from "../../types.ts";
import { regionChipLabel, regionMenu } from "../../lib/header.ts";
import { addCharacter, historyKeyFor, makeMain, parseEntry, removeAt } from "../../lib/me.ts";
import { MAX_ME, PILLAR_ORDER } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";
import { ChipMenu } from "../ChipMenu.tsx";
import type { SelfActions } from "../self/ResultHead.tsx";
import { MainCard } from "./MainCard.tsx";
import { OtherRow } from "./OtherRow.tsx";

/** /me — canvas MeMainFirst (variant C) and MeDetails (empty, full, remove confirmation, local mode). */
export function MePage({ self, history, region, instanceRegion, onRegionChange }: {
  self: SelfActions; history: HistoryItem[]; region: Region; instanceRegion: Region; onRegionChange: (r: Region) => void;
}) {
  const { t } = useT();
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const list = self.characters;
  // The class colour and spec come from the most recent history tab of that character, when there is one.
  const known = (c: MyCharacter): HistoryItem | null => {
    const key = historyKeyFor(history, c);
    return key ? history.find((h) => h.key === key) ?? null : null;
  };
  const add = () => {
    const c = parseEntry(entry, region);
    if (!c) { setError(t("me.invalid")); return; }
    const r = addCharacter(list, c);
    if (!r.ok) { setError(r.error === "full" ? t("me.full", { max: MAX_ME }) : t("me.duplicate")); return; }
    self.setCharacters(r.list);
    setEntry("");
    setError(null);
  };
  const full = list.length >= MAX_ME;
  return (
    <div className="me-page">
      <div className="result-head">
        <h2>{t("me.title")}</h2>
        <span className="muted">{t("me.sub", { max: MAX_ME })}</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{t("me.count", { n: list.length, max: MAX_ME })}</span>
      </div>
      {list.length === 0 && <p className="pillar-text" style={{ margin: 0 }}>{t("me.empty")}</p>}
      {list[0] && <MainCard c={list[0]} classID={known(list[0])?.charClass ?? null} spec={known(list[0])?.spec ?? null} history={history} self={self} />}
      {list.length > 1 && (
        <section className="card me-others">
          <div className="me-row label-caps" style={{ padding: "2px 12px" }}>
            <span>{t("me.others")}</span><span>{t("me.season")}</span>
            <div className="me-cells me-cells-head">{PILLAR_ORDER.map((k) => <span key={k} title={t(`self.pillars.${k}`)}>{t(`me.cells.${k}`)}</span>)}</div><span />
          </div>
          {list.slice(1).map((c, j) => (
            removing === j + 1 ? (
              <div key={`${c.region}|${c.realm}|${c.name}`} className="confirm me-confirm">
                <span><Around message={t("me.removeConfirm")} params={{ name: <b>{c.name}</b> }} /></span>
                <div className="grow" />
                <button type="button" className="btn btn-sm btn-danger" onClick={() => { self.setCharacters(removeAt(list, j + 1)); setRemoving(null); }}>{t("me.remove")}</button>
                <button type="button" className="btn btn-sm" onClick={() => setRemoving(null)}>{t("me.keep")}</button>
              </div>
            ) : (
              <OtherRow
                key={`${c.region}|${c.realm}|${c.name}`} c={c} classID={known(c)?.charClass ?? null} spec={known(c)?.spec ?? null} history={history} self={self}
                onMakeMain={() => { setRemoving(null); self.setCharacters(makeMain(list, j + 1)); }} onRemove={() => setRemoving(j + 1)}
              />
            )
          ))}
        </section>
      )}
      <div className="me-add">
        <input id="me-add" className="me-field" value={entry} disabled={full} placeholder={t("me.addPlaceholder")} autoComplete="off" spellCheck={false}
          onChange={(e) => { setEntry(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        {!full && (
          <ChipMenu
            label={regionChipLabel(region)} className={"chip" + (region !== instanceRegion ? " chip-on" : "")}
            head={t("header.region.remembered")} items={regionMenu(t, region)} onPick={(v) => onRegionChange(v as Region)} title={t("header.region.title")}
          />
        )}
        <button type="button" className={"btn btn-sm" + (full ? "" : " btn-primary")} disabled={full || entry.trim() === ""} onClick={add}>{t("me.add")}</button>
        {full
          ? <span className="chip chip-warn">{t("me.full", { max: MAX_ME })}</span>
          : <span className={error ? "tone-bad" : "faint"} style={{ fontSize: 12 }}>{error ?? t("me.addHint")}</span>}
      </div>
      {!self.hosted && <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("me.localNote")}</p>}
      {self.hosted && <div className="me-bnet"><span className="chip">{t("me.bnetChip")}</span><span>{t("me.bnet")}</span></div>}
    </div>
  );
}
