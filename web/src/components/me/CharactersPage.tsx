import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { analyticsEvent } from "../../analytics.ts";
import type { BnetState } from "../../api.ts";
import type { HistoryItem, Region } from "../../types.ts";
import { bnetNotice, pickFailureNotice, picksBody, picksFromList, removedNotice, type BnetCode, type BnetNotice } from "../../lib/bnet.ts";
import { characterCards, charKey, filterCards, listShown, seasonsLoaded, type CharAction, type CharsFilter } from "../../lib/characters.ts";
import { regionChipLabel, regionMenu } from "../../lib/header.ts";
import { addCharacter, makeMain, moveUp, parseEntry, removeAt } from "../../lib/me.ts";
import { MAX_ME } from "../../lib/self.ts";
import { parseServerSettings } from "../../lib/settings.ts";
import { sourceTitleOf } from "../../lib/synthesis.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import { ChipMenu } from "../ChipMenu.tsx";
import type { SelfActions } from "../owner/types.ts";
import { Toast } from "../Toast.tsx";
import { BnetLinkCard, BnetLinked, BnetNote } from "./BnetCard.tsx";
import { BnetPicker } from "./BnetPicker.tsx";
import { CharacterCard, CharacterRow, SeasonProbe } from "./CharacterCard.tsx";

/**
 * /me — "Mes personnages" (redesign phase 3, spec decision 11, mockup F-Persos): the toolbar card, the filter chips, the
 * characters with a season as cards two per row, the others as a compact group. Hosted, the list comes from Battle.net
 * only (canvas "bnet": the link card or the linked line, the notices, the picker while an import is pending); local,
 * the add field. Each character's season is read once (`GET /api/season`, 0 pts); a sync starts only from its button.
 */
export function CharactersPage({ self, history, region, instanceRegion, onRegionChange, bnetCode }: {
  self: SelfActions; history: HistoryItem[]; region: Region; instanceRegion: Region; onRegionChange: (r: Region) => void;
  bnetCode: BnetCode | null;
}) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [filter, setFilter] = useState<CharsFilter>("all");
  // After "Keep", "make main" or "move up", focus goes back to that character's "⋯" button once the list re-renders.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [shownOnce, setShownOnce] = useState(false);
  const [seasons, setSeasons] = useState<ReadonlyMap<string, SeasonState>>(new Map());
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
  const onSeason = useCallback((key: string, s: SeasonState | null) => setSeasons((m) => {
    const next = new Map(m);
    if (s) next.set(key, s); else next.delete(key);
    return next;
  }), []);
  useEffect(() => {
    if (!self.hosted) return;
    // Back from Battle.net with the account linked: the pick is pending.
    if (bnetCode === "pick") analyticsEvent("bnet_link");
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
  const add = () => {
    const c = parseEntry(entry, region);
    if (!c) { setError(t("me.invalid")); return; }
    const r = addCharacter(list, c);
    if (!r.ok) { setError(r.error === "full" ? t("me.full", { max: MAX_ME }) : t("me.duplicate")); return; }
    self.setCharacters(r.list);
    setEntry("");
    setError(null);
  };
  const act = (index: number, key: string) => (a: CharAction) => {
    if (a === "remove") { setRemoving(key); return; }
    setRemoving(null);
    self.setCharacters(a === "main" ? makeMain(list, index) : moveUp(list, index));
    setFocusKey(key);
  };
  const keep = (key: string) => () => { setRemoving(null); setFocusKey(key); };
  useEffect(() => {
    if (focusKey === null) return;
    // The main has no "⋯" (nothing to do on it): its card's Open link takes the focus instead.
    const card = document.querySelector<HTMLElement>(`[data-char="${CSS.escape(focusKey)}"]`);
    const more = document.querySelector<HTMLElement>(`[data-char-more="${CSS.escape(focusKey)}"]`);
    (more ?? card?.querySelector<HTMLElement>("a.btn") ?? null)?.focus();
    setFocusKey(null);
  }, [focusKey, list]);
  const remove = (index: number) => () => { self.setCharacters(removeAt(list, index)); setRemoving(null); };
  const titleOf = sourceTitleOf(t, docs);

  const codeNote = self.hosted && bnetCode ? bnetNotice(t, bnetCode) : null;
  const removed = bnet ? removedNotice(t, bnet.removed) : null;
  const pending = self.hosted && picking ? bnet?.import ?? null : null;
  const showPicker = pending !== null;
  const view = characterCards(t, locale, {
    list, history, hosted: self.hosted, ownClient: self.ownClient, titleOf,
    seasonOf: (c) => seasons.get(charKey(c))?.view ?? null,
    loadOf: (c) => {
      const s = seasons.get(charKey(c));
      return !s || s.loading ? "loading" : s.failed ? "failed" : "ok";
    },
  });
  const loaded = seasonsLoaded(list, (k) => seasons.get(k)?.loading === false);
  useEffect(() => { if (loaded) setShownOnce(true); }, [loaded]);
  const ready = listShown(shownOnce, loaded);
  const shown = filterCards(view, filter);
  const full = list.length >= MAX_ME;
  const tracked = (
    <div className="chars-tracked">
      <span className="muted">{view.tracked}</span>
      <span className="chars-tracked-bar" aria-hidden="true"><span style={{ width: `${(list.length / MAX_ME) * 100}%` }} /></span>
    </div>
  );
  return (
    <div className="chars-page">
      <h1 className="chars-title">{t("chars.title")}</h1>
      {list.map((c) => <SeasonProbe key={charKey(c)} c={c} self={self} onState={onSeason} />)}
      {codeNote && <BnetNote notice={codeNote} />}
      {pickNote && <BnetNote notice={pickNote} />}
      {removed && !showPicker && <BnetNote notice={removed} importAgain={bnet?.link != null} />}
      {pending && (
        <BnetPicker
          battletag={bnet?.link?.battletag ?? null} candidates={pending.candidates} picked={picked} busy={busy}
          onChange={setPicked} onCancel={() => setPicking(false)} onSave={() => void save()}
        />
      )}
      {self.hosted && !showPicker && bnet && !bnet.link && <BnetLinkCard />}
      {self.hosted && !showPicker && bnet?.link && (
        <section className="card chars-toolbar">
          <BnetLinked
            link={bnet.link} bnetCount={list.filter((c) => c.source === "bnet").length} confirming={unlinking} busy={busy}
            onUnlink={() => setUnlinking(true)} onConfirm={() => void unlink()} onKeep={() => setUnlinking(false)}
          >
            {tracked}
          </BnetLinked>
        </section>
      )}
      {!self.hosted && (
        <section className="card chars-toolbar">
          <div className="chars-add">
            <div className="me-add">
              <input id="me-add" className="me-field" value={entry} disabled={full} placeholder={t("me.addPlaceholder")} autoComplete="off" spellCheck={false}
                aria-label={t("me.addPlaceholder")}
                onChange={(e) => { setEntry(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
              {!full && (
                <ChipMenu
                  label={regionChipLabel(region)} className={"chip" + (region !== instanceRegion ? " chip-on" : "")}
                  head={t("header.region.remembered")} items={regionMenu(t, region)} onPick={(v) => onRegionChange(v as Region)} title={t("header.region.title")}
                />
              )}
              <button type="button" className={"btn" + (full ? "" : " btn-primary")} disabled={full || entry.trim() === ""} onClick={add}>{t("me.add")}</button>
            </div>
            {full
              ? <span className="chip chip-warn">{t("me.full", { max: MAX_ME })}</span>
              : <span className={"chars-small " + (error ? "tone-bad" : "faint")}>{error ?? t("me.addHint")}</span>}
          </div>
          {tracked}
        </section>
      )}
      {!self.hosted && list.length === 0 && <p className="pillar-text" style={{ margin: 0 }}>{t("me.empty")}</p>}
      {!showPicker && list.length > 0 && !ready && <p className="muted chars-small" role="status">{t("chars.loading")}</p>}
      {!showPicker && list.length > 0 && ready && (
        <>
          <div className="chars-filters" role="group" aria-label={t("chars.filterGroup")}>
            {view.filters.map((f) => (
              <button key={f.id} type="button" className={"chars-seg" + (filter === f.id ? " on" : "")} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span className="mono">{f.n}</span>
              </button>
            ))}
          </div>
          {shown.withSeason.length > 0 && (
            <section className="chars-group">
              <span className="label-caps">{view.seasonTitle}</span>
              <div className="chars-grid">
                {shown.withSeason.map((card) => (
                  <CharacterCard
                    key={card.key} card={card} season={seasons.get(card.key)} removing={removing === card.key}
                    onAction={act(card.index, card.key)} onRemove={remove(card.index)} onKeep={keep(card.key)}
                  />
                ))}
              </div>
            </section>
          )}
          {shown.without.length > 0 && (
            <section className="chars-group">
              <div className="chars-group-head">
                <span className="label-caps">{view.noneTitle}</span>
                <span className="faint chars-small">{view.noneHint}</span>
              </div>
              <div className="chars-compact">
                {shown.without.map((row) => (
                  <CharacterRow
                    key={row.key} row={row} removing={removing === row.key}
                    onAction={act(row.index, row.key)} onRemove={remove(row.index)} onKeep={keep(row.key)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {!self.hosted && <p className="faint chars-small" style={{ margin: 0 }}>{t("me.localNote")}</p>}
      {self.hosted && <Toast message={toast} onClose={closeToast} />}
    </div>
  );
}
