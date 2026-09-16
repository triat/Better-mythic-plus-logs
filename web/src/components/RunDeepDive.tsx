import { useState } from "react";
import type { DefensiveKind, OverrideEntry, RunDefensives } from "../types.ts";
import { costText, panelModel } from "../lib/deepdive.ts";

interface Props {
  d: RunDefensives;
  /** payload.deepdiveSummary.tableWarning: the override file was ignored. */
  tableWarning?: string | null;
  busy: boolean;
  onReanalyze: () => void;
  onPatch: (patch: OverrideEntry) => Promise<void>;
}

const KINDS: DefensiveKind[] = ["major", "immunity", "minor"];

export function RunDeepDive({ d, tableWarning, busy, onReanalyze, onPatch }: Props) {
  const m = panelModel(d, Date.now(), tableWarning);
  const [tableOpen, setTableOpen] = useState(false);
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
        <span className="muted">{m.meta}</span>
        <div className="grow" />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onReanalyze}>Re-analyze · {costText(1)}</button>
      </div>
      {m.notice && <div className="dd-notice tone-warn">{m.notice}</div>}

      {m.usage.length > 0 && (
        <>
          <div className="label-caps dd-section">Usage</div>
          <div className="dd-usage">
            {m.usage.map((u) => (
              <div key={u.id} className="dd-row">
                <span>{u.name}{u.origin === "override" && <span className="faint"> · override</span>}</span>
                <span className="faint">{u.kind}</span>
                <span className="mono">{u.counts}</span>
                <span className={"mono " + u.cls}>{u.pctText}</span>
                <span className="dd-bar" aria-hidden="true"><span style={{ width: `${u.countsUsage ? u.pct : 0}%` }} /></span>
                <span className="faint">{u.cd}{u.mismatch && <span className="chip chip-warn" title="Casts seen closer than the table cooldown — a talent, or the table is wrong">talent?</span>}</span>
              </div>
            ))}
          </div>
          {m.majorsText && <div className="muted dd-foot">{m.majorsText}</div>}
        </>
      )}

      <div className="label-caps dd-section">Deaths · <span className="muted">{m.deathsHeadline}</span></div>
      {m.deaths.map((x, i) => (
        <div key={i} className={"dd-death" + (x.wipe ? " dd-wipe" : "")}>
          <span className="mono">{x.time}</span>
          <span className={x.cls}>{x.verdict}{x.wipe && <span className="chip"> wipe</span>}</span>
          <span className="faint">{x.hits || "—"}{x.blow && <span> · {x.blow}</span>}</span>
          <span className="dd-states">{x.states.map((s, j) => <span key={j} className={s.cls}>{j > 0 && <span className="faint"> · </span>}{s.text}</span>)}</span>
        </div>
      ))}

      <div className="label-caps dd-section">Audit</div>
      {m.unlisted.length === 0 && <div className="faint dd-foot">Every self-cast buff is in the table.</div>}
      {m.unlisted.map((u) => (
        <div key={u.id} className="dd-audit">
          <span>{u.text}</span>
          {adding?.id === u.id ? (
            <span className="dd-form">
              <label>cd <input className="mono" value={cd} onChange={(e) => setCd(e.target.value)} size={4} /> s</label>
              <label>duration <input className="mono" value={dur} onChange={(e) => setDur(e.target.value)} size={4} /> s</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitAdd()}>Add as {adding.kind}</button>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>Cancel</button>
            </span>
          ) : (
            <span className="dd-actions">
              {KINDS.map((k) => <button key={k} type="button" className="chip" disabled={busy} onClick={() => setAdding({ id: u.id, name: u.name, kind: k })}>+ {k}</button>)}
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, ignore: true })}>Ignore</button>
            </span>
          )}
        </div>
      ))}
      <button type="button" className="section-head dd-table-head" onClick={() => setTableOpen((o) => !o)} aria-expanded={tableOpen}>
        <span className={"chev" + (tableOpen ? " open" : "")}>›</span>
        <span className="muted">{m.tableUsed}</span>
      </button>
      {tableOpen && d.defensives.map((u) => (
        <div key={u.id} className="dd-audit">
          <span>{u.name} <span className="faint">{u.kind} · cd {u.cooldownS} s · {u.durationS} s{u.origin === "override" ? " · override" : ""}</span></span>
          {editing?.id === u.id ? (
            <span className="dd-form">
              <label>cd <input className="mono" value={editing.cd} onChange={(e) => setEditing({ id: u.id, cd: e.target.value })} size={4} /> s</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitEdit()}>Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </span>
          ) : (
            <span className="dd-actions">
              <button type="button" className="chip" disabled={busy} onClick={() => setEditing({ id: u.id, cd: String(u.cooldownS) })}>Edit cd</button>
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, ignore: true })}>Remove for this spec</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
