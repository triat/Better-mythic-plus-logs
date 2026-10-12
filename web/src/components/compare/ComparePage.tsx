// The Compare page (redesign phase 4, plan docs/superpowers/plans/2026-10-12-ui-redesign-phase-4.md task 3): the picker,
// then the duel for two profiles or the ranking for three to five. It only reads history (`GET /api/history/:key`, 0 pts).
// A pick that fails to load is named with a Retry; the comparison still shows when two or more loaded.
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** One entry into the cache, or the server's error (no toast, no history reload: `onLoadFailed` does both once). */
  loadEntry: (key: string) => Promise<{ payload: LookupPayload } | { error: string }>;
  onLoadFailed: (error: string) => void;
  cache: Map<string, LookupPayload>;
  /** The boot's `GET /api/history` failed: an error with Retry instead of the page. */
  historyFailed: boolean;
  onRetryHistory: () => void;
}

export function ComparePage({ tabs, selected, onSelect, loadEntry, onLoadFailed, cache, historyFailed, onRetryHistory }: Props) {
  const { t, locale } = useT();
  const { docs, failed: docsFailed, retry: retryDocs } = useDocs();
  const [, bump] = useState(0);
  // Keys being fetched (never asked twice at once) and the keys whose last fetch failed (asked again only by Retry).
  const inFlight = useRef(new Set<string>());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const alive = useRef(true);
  // Set on every mount: StrictMode (dev) mounts, cleans up and mounts again, and a ref left false would drop every result.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const open = selected.length >= 2;
  // Counted once per opening of a comparison.
  useEffect(() => { if (open) track("compare_open"); }, [open]);

  /** Fetches the keys neither cached nor in flight, as one batch: at most one history reload and one toast. */
  const load = useCallback((keys: readonly string[]) => {
    const batch = keys.filter((k) => !cache.has(k) && !inFlight.current.has(k));
    if (batch.length === 0) return;
    for (const k of batch) inFlight.current.add(k);
    setFailed((f) => new Set([...f].filter((k) => !batch.includes(k))));
    const one = (k: string) => loadEntry(k).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    Promise.all(batch.map(async (k) => ({ k, r: await one(k) }))).then((results) => {
      for (const k of batch) inFlight.current.delete(k);
      if (!alive.current) return;
      const errors = results.flatMap(({ k, r }) => ("error" in r ? [{ k, error: r.error }] : []));
      if (errors.length > 0) {
        setFailed((f) => new Set([...f, ...errors.map((e) => e.k)]));
        onLoadFailed(errors[0]!.error);
      }
      bump((n) => n + 1);
    });
  }, [cache, loadEntry, onLoadFailed]);

  useEffect(() => {
    if (selected.length >= 2) load(selected.filter((k) => !failed.has(k)));
  }, [selected.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="page-head">
      <h1>{t("shell.compare.title")}</h1>
    </div>
  );
  if (historyFailed) {
    return (
      <div className="content">
        {head}
        <Failure text={t("compare.failed.history")} onRetry={onRetryHistory} />
      </div>
    );
  }
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
  const failedKeys = selected.filter((k) => failed.has(k) && !cache.has(k));
  const pending = selected.some((k) => !cache.has(k) && !failed.has(k));
  const retryFailed = () => load(failedKeys);
  const labelOf = (k: string) => tabs.find((i) => i.key === k)?.label ?? k;
  let body;
  if (!open) body = <p className="muted cmp-none">{selected.length === 0 ? t("shell.compare.sub") : t("compare.pick.none")}</p>;
  else if (pending) body = <div className="muted"><span className="spinner" /> {t("compare.building")}</div>;
  else if (entries.length < 2) body = <Failure text={t("compare.failed.all")} onRetry={retryFailed} />;
  else if (docs === null && docsFailed) body = <Failure text={t("compare.failed.docs")} onRetry={retryDocs} />;
  else if (docs === null) body = <div className="muted"><span className="spinner" /> {t("compare.building")}</div>;
  else {
    const view = entries.length >= 3
      ? <CompareRanking view={rankingView(t, locale, entries, synthesisDocs(docs))} />
      : <CompareDuel view={duelView(t, locale, entries, synthesisDocs(docs))} />;
    const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(failedKeys.map(labelOf));
    body = (
      <>
        {failedKeys.length > 0 && <Failure text={t("compare.failed.some", { names })} onRetry={retryFailed} />}
        {view}
      </>
    );
  }

  return (
    <div className={"content cmp" + (open ? " content-result" : "")}>
      <ComparePicker tabs={tabs} selected={selected} ranking={selected.length >= 3} onSelect={onSelect} />
      {body}
    </div>
  );
}

function Failure({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <p className="cmp-warning cmp-failure" role="alert">
      {text}
      <button type="button" className="btn" onClick={onRetry}>{t("compare.failed.retry")}</button>
    </p>
  );
}
