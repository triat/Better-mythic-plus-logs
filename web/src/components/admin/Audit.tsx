import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import type { AdminAudit, AuditKind, AuditRow } from "../../types.ts";
import { auditChips, auditRow, auditShowing } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";

interface Props {
  kind: AuditKind | "all";
  onKind: (kind: AuditKind | "all") => void;
}

const PAGE = 50;
const NO_COUNTS: AdminAudit["counts"] = { all: 0, login: 0, admin: 0, quota: 0, security: 0, error: 0 };

/** The audit log (canvas A): kind chips with totals, one kind at a time, newest first, keyset-paged "Load 50 more". Owns its data (0 WCL pts). */
export function Audit({ kind, onKind }: Props) {
  const { t } = useT();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [counts, setCounts] = useState<AdminAudit["counts"]>(NO_COUNTS);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The kind on screen: a "Load more" reply for an older selection is dropped. */
  const kindRef = useRef(kind);
  kindRef.current = kind;
  useEffect(() => {
    let live = true;
    setBusy(true);
    void api.admin.audit({ kind, before: null, limit: PAGE }).then((r) => {
      if (!live) return;
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setRows(r.rows);
      setCounts(r.counts);
      setNextBefore(r.nextBefore);
    });
    return () => { live = false; };
  }, [kind]);
  const loadMore = async () => {
    if (nextBefore === null || busy) return;
    setBusy(true);
    const r = await api.admin.audit({ kind, before: nextBefore, limit: PAGE });
    if (kindRef.current !== kind) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows((prev) => [...prev, ...r.rows]);
    setCounts(r.counts);
    setNextBefore(r.nextBefore);
  };
  return (
    <section id="audit" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>{t("admin.audit.title")}</span>
        <span className="muted">{t("admin.audit.sub")}</span>
        <div className="grow" />
        {auditChips(t).map((c) => (
          <button
            key={c.kind} type="button" className={"chip" + (kind === c.kind ? " chip-on" : "")}
            style={c.kind === "error" && counts.error > 0 ? { color: "var(--red)" } : undefined}
            onClick={() => onKind(c.kind)}
          >
            {c.label} · {counts[c.kind]}
          </button>
        ))}
      </div>
      <div className="admin-row admin-row-head admin-row-audit label-caps">
        <span>{t("admin.audit.head.time")}</span><span>{t("admin.audit.head.who")}</span><span>{t("admin.audit.head.action")}</span><span>{t("admin.audit.head.target")}</span><span>{t("admin.audit.head.detail")}</span>
      </div>
      {rows.length === 0 && !busy && !error && <div className="faint" style={{ fontSize: 13 }}>{t("admin.audit.empty")}</div>}
      {rows.map((row) => {
        const r = auditRow(t, row);
        return (
          <div key={r.id} className="inset admin-row admin-row-audit">
            <span className="mono faint">{r.time}</span>
            <span className={r.whoFaint ? "faint" : undefined}>{r.who}</span>
            <span><span className={`dot ${r.dot}`} /><span className="mono" style={{ fontSize: 12 }}>{r.action}</span></span>
            <span className="text-soft" title={r.target}>{r.target}</span>
            <span className="faint">{r.detail}</span>
          </div>
        );
      })}
      {error && <div className="faint" style={{ fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
        {nextBefore !== null && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void loadMore()}>{t("admin.audit.loadMore", { n: PAGE })}</button>}
        <span className="faint" style={{ fontSize: 12 }}>{auditShowing(t, rows.length, counts[kind])}</span>
      </div>
    </section>
  );
}
