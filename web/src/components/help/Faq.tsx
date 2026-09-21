import type { FaqEntry } from "../../types.ts";
import { useT } from "../../locale.tsx";

/** The FAQ card: `faqEntries` already dropped the hosted-only questions on a local instance. */
export function Faq({ entries }: { entries: FaqEntry[] }) {
  const { t } = useT();
  return (
    <section className="card help-card faq" id="faq">
      <h2>{t("help.toc.faq")}</h2>
      {entries.map((f) => (
        <div key={f.q}>
          <q>{f.q}</q>
          <p className="help-p">{f.a}</p>
        </div>
      ))}
    </section>
  );
}
