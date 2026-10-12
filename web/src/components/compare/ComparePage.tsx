// The Compare page (redesign phase 4, plan docs/superpowers/plans/2026-10-12-ui-redesign-phase-4.md task 3): the picker,
// then the duel for two profiles or the ranking for three to five. It only reads history (`GET /api/history/:key`, 0 pts).
import { useEffect, useState } from "react";
import type { HistoryItem, LookupPayload } from "../../types.ts";
import { duelView, rankingView } from "../../lib/compare.ts";
import type { CompareEntry } from "../../lib/compare.ts";
import { synthesisDocs } from "../../lib/synthesis.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import { CompareDuel } from "./CompareDuel.tsx";
import { ComparePicker } from "./ComparePicker.tsx";
import { CompareRanking } from "./CompareRanking.tsx";

interface Props {
  tabs: HistoryItem[];
  selected: string[];
  onSelect: (keys: string[]) => void;
  fetchPayload: (key: string) => Promise<{ payload: LookupPayload | null; items: HistoryItem[] | null }>;
  cache: Map<string, LookupPayload>;
}

export function ComparePage({ tabs, selected, onSelect, fetchPayload, cache }: Props) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const [, bump] = useState(0);
  const open = selected.length >= 2;
  // Counted once per opening of a comparison.
  useEffect(() => { if (open) track("compare_open"); }, [open]);
  useEffect(() => {
    if (selected.length < 2) return;
    let alive = true;
    Promise.all(selected.map((k) => fetchPayload(k))).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [selected.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tabs.length === 0) {
    return (
      <div className="content">
        <div className="page-head">
          <h1>{t("shell.compare.title")}</h1>
          <span className="muted">{t("shell.compare.empty")}</span>
        </div>
      </div>
    );
  }

  const entries: CompareEntry[] = selected.flatMap((key) => {
    const payload = cache.get(key);
    return payload ? [{ key, payload }] : [];
  });
  const ready = open && docs !== null && entries.length === selected.length;
  const ranking = selected.length >= 3;
  let body;
  if (!open) body = <p className="muted cmp-none">{selected.length === 0 ? t("shell.compare.sub") : t("compare.pick.none")}</p>;
  else if (!ready) body = <div className="muted"><span className="spinner" /> {t("compare.building")}</div>;
  else if (ranking) body = <CompareRanking view={rankingView(t, locale, entries, synthesisDocs(docs))} />;
  else body = <CompareDuel view={duelView(t, locale, entries, synthesisDocs(docs))} />;

  return (
    <div className={"content cmp" + (open ? " content-result" : "")}>
      <ComparePicker tabs={tabs} selected={selected} ranking={ranking} onSelect={onSelect} />
      {body}
    </div>
  );
}
