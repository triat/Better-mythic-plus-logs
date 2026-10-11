import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { BnetState } from "../../api.ts";
import type { HistoryItem, MyCharacter, Region } from "../../types.ts";
import { bnetNotice, pickFailureNotice, picksBody, picksFromList, removedNotice, type BnetCode, type BnetNotice } from "../../lib/bnet.ts";
import { regionChipLabel, regionMenu } from "../../lib/header.ts";
import { addCharacter, historyKeyFor, makeMain, parseEntry, removeAt } from "../../lib/me.ts";
import { MAX_ME, PILLAR_ORDER } from "../../lib/self.ts";
import { parseServerSettings } from "../../lib/settings.ts";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";
import { ChipMenu } from "../ChipMenu.tsx";
import type { SelfActions } from "../self/ResultHead.tsx";
import { Toast } from "../Toast.tsx";
import { BnetLinkCard, BnetLinked, BnetNote } from "./BnetCard.tsx";
import { BnetPicker } from "./BnetPicker.tsx";
import { MainCard } from "./MainCard.tsx";
import { OtherRow } from "./OtherRow.tsx";

/**
 * /me — canvas MeMainFirst (variant C) and MeDetails (empty, full, remove confirmation, local mode). Hosted, the list
 * comes from Battle.net only (canvas "bnet": BnetPickA and BnetDetails): the link card or the linked line, the notices,
 * the picker while an import is pending, then the list; no add field. Local: the add field, unchanged.
 */
export function MePage({ self, history, region, instanceRegion, onRegionChange, bnetCode }: {
  self: SelfActions; history: HistoryItem[]; region: Region; instanceRegion: Region; onRegionChange: (r: Region) => void;
  bnetCode: BnetCode | null;
}) {
  const { t } = useT();
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const list = self.characters;
  // Hosted only: GET /api/bnet (0 pts), the picker's ticks, the pick's refusal, the unlink confirmation, API errors.
  const [bnet, setBnet] = useState<BnetState | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickNote, setPickNote] = useState<BnetNotice | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!self.hosted) return;
    let alive = true;
    void api.bnet.get().then((r) => {
      if (!alive) return;
      if (!r.ok) { setToast(r.error); return; }
      setBnet({ link: r.link, removed: r.removed, import: r.import });
      // "Import again" re-opens the picker with the list's Battle.net characters still ticked, in list order.
      if (r.import) { setPicked(picksFromList(r.import.candidates, self.characters)); setPicking(true); }
      else if (bnetCode === "pick") setPickNote(bnetNotice(t, "expired"));
    });
    return () => { alive = false; };
    // once on mount: the import and the code belong to this page load
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!bnet?.import) return;
    setBusy(true);
    const r = await api.bnet.pick(picksBody(bnet.import.candidates, picked));
    setBusy(false);
    if (!r.ok) {
      setPickNote(pickFailureNotice(t, r));
      if (r.code === "bnet_import_expired") { setPicking(false); setBnet({ ...bnet, import: null }); }
      return;
    }
    // The answer is what the server stored: take it as is, without the PUT /api/settings that setCharacters sends.
    self.adoptCharacters(parseServerSettings(r.settings).characters);
    setBnet({ ...bnet, removed: [], import: null });
    setPicking(false);
    setPickNote(null);
    setRemoving(null);
  };
  const unlink = async () => {
    setBusy(true);
    const r = await api.bnet.unlink();
    setBusy(false);
    if (!r.ok) { setToast(r.error); return; }
    self.adoptCharacters(list.filter((c) => c.source !== "bnet"));
    setBnet({ link: null, removed: [], import: null });
    setUnlinking(false);
    setRemoving(null);
  };
  const codeNote = self.hosted && bnetCode ? bnetNotice(t, bnetCode) : null;
  const removed = bnet ? removedNotice(t, bnet.removed) : null;
  const pending = self.hosted && picking ? bnet?.import ?? null : null;
  const showPicker = pending !== null;
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
        <span className="muted">{t(self.hosted ? "me.subHosted" : "me.subLocal", { max: MAX_ME })}</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{t("me.count", { n: list.length, max: MAX_ME })}</span>
      </div>
      {codeNote && <BnetNote notice={codeNote} />}
      {pickNote && <BnetNote notice={pickNote} />}
      {removed && !showPicker && <BnetNote notice={removed} importAgain={bnet?.link != null} />}
      {pending && (
        <BnetPicker
          battletag={bnet?.link?.battletag ?? null} candidates={pending.candidates} picked={picked} busy={busy}
          onChange={setPicked} onCancel={() => setPicking(false)} onSave={() => void save()}
        />
      )}
      {self.hosted && !showPicker && bnet && (bnet.link
        ? (
          <BnetLinked
            link={bnet.link} bnetCount={list.filter((c) => c.source === "bnet").length} confirming={unlinking} busy={busy}
            onUnlink={() => setUnlinking(true)} onConfirm={() => void unlink()} onKeep={() => setUnlinking(false)}
          />
        )
        : <BnetLinkCard />)}
      {!self.hosted && list.length === 0 && <p className="pillar-text" style={{ margin: 0 }}>{t("me.empty")}</p>}
      {!showPicker && list[0] && <MainCard c={list[0]} classID={known(list[0])?.charClass ?? null} spec={known(list[0])?.spec ?? null} history={history} self={self} />}
      {!showPicker && list.length > 1 && (
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
      {!self.hosted && <div className="me-add">
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
      </div>}
      {!self.hosted && <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("me.localNote")}</p>}
      {self.hosted && <Toast message={toast} onClose={closeToast} />}
    </div>
  );
}
