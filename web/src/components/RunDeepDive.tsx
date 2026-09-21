import { useEffect, useState } from "react";
import type { DefensiveKind, EntryOrigin, OverrideEntry, ProposalSummary, RunDefensives } from "../types.ts";
import type { ProposalMode } from "../lib/hostedMode.ts";
import type { T } from "../i18n/t.ts";
import { api } from "../api.ts";
import { actionLabels, costText, originDot, originLabel, originSuffix, panelModel, proposalLines } from "../lib/deepdive.ts";
import { useT } from "../locale.tsx";
import { HelpLink } from "./HelpLink.tsx";
import { SpellLink, useWowheadRefresh } from "./SpellLink.tsx";

interface Props {
  d: RunDefensives;
  /** payload.deepdiveSummary.tableWarning: the override file was ignored. */
  tableWarning?: string | null;
  busy: boolean;
  canAfford: boolean;
  quotaTooltip: string;
  mode: ProposalMode;
  onReanalyze: () => void;
  onPatch: (patch: OverrideEntry) => Promise<void>;
}

const KINDS: DefensiveKind[] = ["major", "immunity", "minor"];

/** Dot (shared / pending) before the spell name, or the " · override" suffix after it (set `suffix={false}` when the caller renders it itself). */
function NameCell({ t, id, name, origin, suffix = true }: { t: T; id: number; name: string; origin: EntryOrigin; suffix?: boolean }) {
  const dot = originDot(origin);
  const suffixText = suffix ? originSuffix(t, origin) : null;
  return (
    <span>
      {dot && <span className={"dot " + dot} title={originLabel(t, origin) ?? undefined} />}
      <SpellLink id={id} name={name} />
      {suffixText && <span className="faint"> · {suffixText}</span>}
    </span>
  );
}

export function RunDeepDive({ d, tableWarning, busy, canAfford, quotaTooltip, mode, onReanalyze, onPatch }: Props) {
  const { t } = useT();
  const m = panelModel(t, d, Date.now(), tableWarning);
  useWowheadRefresh(d);
  const [tableOpen, setTableOpen] = useState(false);
  const labels = actionLabels(t, mode);
  // The member's own proposals for this spec (hosted only; 0 WCL pts — SQLite). Re-read whenever the analysis object changes
  // (App.reloadActive after a patch hands a fresh `d`).
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  useEffect(() => {
    if (mode !== "propose") return;
    let alive = true;
    void api.defensives(d.className, d.spec).then((r) => { if (alive && r.ok) setProposals(r.proposals ?? []); });
    return () => { alive = false; };
  }, [mode, d]);
  const lines = mode === "propose" && proposals ? proposalLines(t, proposals, d.defensives) : [];
  // Inline "add" form: which unlisted id, as which kind.
  const [adding, setAdding] = useState<{ id: number; name: string; kind: DefensiveKind } | null>(null);
  const [cd, setCd] = useState("60");
  const [dur, setDur] = useState("8");
  // Inline "edit cooldown" form for a table row.
  const [editing, setEditing] = useState<{ id: number; cd: string } | null>(null);

  const submitAdd = async () => {
    if (!adding) return;
    const cooldownS = Number(cd); const durationS = Number(dur);
    if (!Number.isFinite(cooldownS) || cooldownS <= 0 || !Number.isFinite(durationS) || durationS < 0) return;
    await onPatch({ id: adding.id, name: adding.name, kind: adding.kind, cooldownS, durationS });
    setAdding(null);
  };
  const submitEdit = async () => {
    if (!editing) return;
    const cooldownS = Number(editing.cd);
    if (!Number.isFinite(cooldownS) || cooldownS <= 0) return;
    await onPatch({ id: editing.id, cooldownS });
    setEditing(null);
  };

  return (
    <div className="dd inset">
      <div className="dd-head">
        <span className="dd-title">{m.title}</span>
        <HelpLink anchor="deep-dive" />
        <span className="muted">{m.meta}</span>
        <div className="grow" />
        <button
          type="button" className="btn btn-sm" disabled={busy || !canAfford}
          title={canAfford ? undefined : quotaTooltip}
          onClick={onReanalyze}
        >
          {t("runs.reanalyze", { cost: costText(t, 1) })}
        </button>
      </div>
      {m.notice && <div className="dd-notice tone-warn">{m.notice}</div>}

      {m.usage.length > 0 && (
        <>
          <div className="label-caps dd-section">{t("deepdive.usage")}</div>
          <div className="dd-usage">
            {m.usage.map((u) => (
              <div key={u.id} className="dd-row">
                <NameCell t={t} id={u.id} name={u.name} origin={u.origin} />
                <span className="faint">{u.kind}</span>
                <span className="mono">{u.counts}</span>
                <span className={"mono " + u.cls}>{u.pctText}</span>
                <span className="dd-bar" aria-hidden="true"><span style={{ width: `${u.countsUsage ? u.pct : 0}%` }} /></span>
                <span className="faint">{u.cd}{u.mismatch && <span className="chip chip-warn" title={t("deepdive.talentTitle")}>{t("deepdive.talent")}</span>}</span>
              </div>
            ))}
          </div>
          {m.majorsText && <div className="muted dd-foot">{m.majorsText}</div>}
        </>
      )}

      <div className="label-caps dd-section">{t("deepdive.deaths")}<span className="muted">{m.deathsHeadline}</span></div>
      {m.deaths.map((x, i) => (
        <div key={i} className={"dd-death" + (x.wipe ? " dd-wipe" : "")}>
          <span className="mono">{x.time}</span>
          <span className={x.cls}>{x.verdict}{x.wipe && <span className="chip">{t("deepdive.wipe")}</span>}</span>
          <span className="faint">{x.hits.length === 0 ? "—" : x.hits.map((h, j) => <span key={j}>{j > 0 && " · "}<SpellLink id={h.id} name={h.name} /> {h.text}</span>)}{x.blow && <span> · {x.blow}</span>}</span>
          <span className="dd-states">{x.states.map((s, j) => <span key={j} className={s.cls}>{j > 0 && <span className="faint"> · </span>}<SpellLink id={s.id} name={s.name} /> {s.text}</span>)}</span>
        </div>
      ))}

      <div className="label-caps dd-section">{t("deepdive.audit")}</div>
      {m.unlisted.length === 0 && <div className="faint dd-foot">{t("deepdive.auditEmpty")}</div>}
      {m.unlisted.map((u) => (
        <div key={u.id} className="dd-audit">
          <span><SpellLink id={u.id} name={u.name} />{u.text}</span>
          {adding?.id === u.id ? (
            <span className="dd-form">
              <label>{t("deepdive.cd")}<input className="mono" value={cd} onChange={(e) => setCd(e.target.value)} size={4} />{t("deepdive.s")}</label>
              <label>{t("deepdive.duration")}<input className="mono" value={dur} onChange={(e) => setDur(e.target.value)} size={4} />{t("deepdive.s")}</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitAdd()}>{labels.addSubmit(adding.kind)}</button>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>{t("common.cancel")}</button>
            </span>
          ) : (
            <span className="dd-actions">
              {KINDS.map((k) => <button key={k} type="button" className="chip" disabled={busy} onClick={() => setAdding({ id: u.id, name: u.name, kind: k })}>{labels.add(k)}</button>)}
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, name: u.name, ignore: true })}>{labels.ignore}</button>
            </span>
          )}
        </div>
      ))}
      <button type="button" className="section-head dd-table-head" onClick={() => setTableOpen((o) => !o)} aria-expanded={tableOpen}>
        <span className={"chev" + (tableOpen ? " open" : "")}>›</span>
        <span className="muted">{m.tableParts.map((p, i) => <span key={i}>{i > 0 && " · "}{p.dot && <span className={"dot " + p.dot} />}{p.text}</span>)}</span>
      </button>
      {tableOpen && d.defensives.map((u) => (
        <div key={u.id} className="dd-audit">
          <span><NameCell t={t} id={u.id} name={u.name} origin={u.origin} suffix={false} /> <span className="faint">{u.kind} · {t("deepdive.cdOf", { cd: String(u.cooldownS) })} · {t("deepdive.proposals.duration", { s: String(u.durationS) })}{originSuffix(t, u.origin) ? ` · ${originSuffix(t, u.origin)}` : ""}</span></span>
          {editing?.id === u.id ? (
            <span className="dd-form">
              <label>{t("deepdive.cd")}<input className="mono" value={editing.cd} onChange={(e) => setEditing({ id: u.id, cd: e.target.value })} size={4} />{t("deepdive.s")}</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitEdit()}>{labels.save}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            </span>
          ) : (
            <span className="dd-actions">
              <button type="button" className="chip" disabled={busy} onClick={() => setEditing({ id: u.id, cd: String(u.cooldownS) })}>{labels.editCd}</button>
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, name: u.name, ignore: true })}>{labels.remove}</button>
            </span>
          )}
        </div>
      ))}
      {lines.length > 0 && (
        <>
          <div className="label-caps dd-section">{t("deepdive.proposals.title", { spec: m.specClass })}</div>
          {lines.map((l) => (
            <div key={l.id} className="dd-audit" style={{ fontSize: 12 }}>
              <span><span className={"dot " + l.dot} />{l.what}</span>
              <span className="faint">{l.when}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
