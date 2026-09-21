import type { DocsResponse, TextSegment, WclClientDoc } from "../../types.ts";
import { budgetPill, linkSegments } from "../../lib/help.ts";
import { useT } from "../../locale.tsx";

/** Registry prose with its `[label](href)` links rendered; external links open in a new tab. */
export function Prose({ text }: { text: string }) {
  return (
    <>
      {linkSegments(text).map((s: TextSegment, i) =>
        s.code
          ? <code key={i} className="mono">{s.text}</code>
          : s.href === undefined
            ? <span key={i}>{s.text}</span>
            : <a key={i} href={s.href} {...(s.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{s.text}</a>)}
    </>
  );
}

const Steps = ({ items, start = 1 }: { items: string[]; start?: number }) => (
  <ol className="help-ol" start={start}>{items.map((t) => <li key={t}><Prose text={t} /></li>)}</ol>
);

/** /help#wcl-client (hosted only), layout A of the canvas "WclGuide": why, the two budget pills, the steps on warcraftlogs.com then in bmpl. */
export function WclClientGuide({ doc, quota }: { doc: WclClientDoc; quota: DocsResponse["quota"] }) {
  const { t } = useT();
  const shared = budgetPill(t, quota.pointsPerUserHour);
  const own = budgetPill(t, quota.wclPointsPerHour);
  return (
    <section className="card help-card" id="wcl-client">
      <h2>{doc.title}</h2>
      <p className="help-p">{doc.why}</p>
      <div className="budget-pills">
        {shared && <div className="budget-pill shared"><span className="mono big">{shared.pts}</span><span className="faint">{doc.sharedHint} · {shared.lookups}</span></div>}
        {own && <div className="budget-pill own"><span className="mono big">{own.pts}</span><span className="faint">{doc.ownHint} · {own.lookups}</span></div>}
      </div>
      <h3 className="help-h3">{t("help.guide.onWcl")}</h3>
      <Steps items={doc.onWcl} />
      <h3 className="help-h3">{t("help.guide.inBmpl")}</h3>
      <Steps items={doc.inBmpl} start={doc.onWcl.length + 1} />
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>{doc.safety}</p>
    </section>
  );
}
