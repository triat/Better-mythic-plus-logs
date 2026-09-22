import type { LiveAddonDoc } from "../../types.ts";
import { useT } from "../../locale.tsx";
import { Prose } from "./WclClientGuide.tsx";

const Steps = ({ items, start = 1 }: { items: string[]; start?: number }) => (
  <ol className="help-ol" start={start}>{items.map((t) => <li key={t}><Prose text={t} /></li>)}</ol>
);

/** /help#live-addon (not hosted-gated: the Live panel works the same way locally and hosted), same
 * layout as WclClientGuide: why, the install steps, the connect steps, then a closing line. */
export function LiveAddonGuide({ doc }: { doc: LiveAddonDoc }) {
  const { t } = useT();
  return (
    <section className="card help-card" id="live-addon">
      <h2>{doc.title}</h2>
      <p className="help-p">{doc.why}</p>
      <h3 className="help-h3">{t("help.guide.install")}</h3>
      <Steps items={doc.install} />
      <h3 className="help-h3">{t("help.guide.connect")}</h3>
      <Steps items={doc.connect} start={doc.install.length + 1} />
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>{doc.sends}</p>
    </section>
  );
}
