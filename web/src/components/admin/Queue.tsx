import { Fragment, useState } from "react";
import type { AdminProposal } from "../../types.ts";
import { decidedLine, proposalCard } from "../../lib/admin.ts";
import { SpellLink, useWowheadRefresh } from "../SpellLink.tsx";

interface Props {
  pending: AdminProposal[];
  decided: AdminProposal[];
  onDecide: (id: number, decision: "approve" | "reject", note: string | null) => Promise<void>;
}

/** Members' defensives corrections: pending cards with a diff and a note to the author; decided lines (canvas "Proposal queue"). */
export function Queue({ pending, decided, onDecide }: Props) {
  const [view, setView] = useState<"pending" | "decided">("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  useWowheadRefresh(pending);
  const decide = async (id: number, decision: "approve" | "reject") => {
    setBusy(id);
    await onDecide(id, decision, (notes[id] ?? "").trim() || null);
    setBusy(null);
  };
  return (
    <section id="proposals" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>Proposal queue</span>
        <span className="muted">members' defensives corrections · approve applies to everyone, reject drops it for the author (note is shown to them)</span>
        <div className="grow" />
        <button type="button" className={"chip" + (view === "pending" ? " chip-on" : "")} onClick={() => setView("pending")}>Pending · {pending.length}</button>
        <button type="button" className={"chip" + (view === "decided" ? " chip-on" : "")} onClick={() => setView("decided")}>Decided · {decided.length}</button>
      </div>
      {view === "pending" && pending.length === 0 && <div className="faint" style={{ fontSize: 13 }}>Nothing to review. Members' corrections land here.</div>}
      {view === "pending" && pending.map((p) => {
        const c = proposalCard(p);
        const disabled = busy === c.id;
        return (
          <div key={c.id} className="inset proposal">
            <div>
              <div style={{ fontSize: 13 }}>
                <span className="dot dot-pending" /><SpellLink id={c.spellId} name={c.name} /> <span className="faint">· {c.key} · id {c.spellId}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>by <span className="text-soft">{c.author}</span> · {c.when}</div>
            </div>
            <div className="diff">
              {c.rows.map((r) => (
                <Fragment key={r.field}>
                  <span className="diff-field">{r.field}</span><span className="diff-from">{r.from}</span><span className="diff-to">{r.to}</span>
                </Fragment>
              ))}
            </div>
            <div className="proposal-actions">
              <input placeholder="Note to the author (optional)" maxLength={500} value={notes[c.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} disabled={disabled} />
              <button type="button" className="btn btn-sm btn-primary" disabled={disabled} onClick={() => void decide(c.id, "approve")}>Approve</button>
              <button type="button" className="btn btn-sm btn-danger" disabled={disabled} onClick={() => void decide(c.id, "reject")}>Reject</button>
            </div>
          </div>
        );
      })}
      {view === "decided" && decided.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No decision yet.</div>}
      {view === "decided" && decided.map((p) => {
        const l = decidedLine(p);
        return (
          <div key={l.id} className="admin-row admin-row-decided inset">
            <span title={l.what}><span className={"dot " + l.dot} />{l.what}</span>
            <span className="muted">{l.author}</span>
            <span><span className={"chip" + (l.status === "approved" ? " chip-ok" : "")}>{l.status}</span></span>
            <span className="muted">{l.when}</span>
            <span className="faint" title={l.note ?? undefined}>{l.note ? `"${l.note}"` : ""}</span>
          </div>
        );
      })}
    </section>
  );
}
