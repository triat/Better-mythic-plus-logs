import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AxisKey, DocsResponse } from "./types.ts";
import { api } from "./api.ts";
import { axisInfo } from "./lib/axes.ts";
import type { AxisInfo } from "./lib/axes.ts";
import { useT } from "./locale.tsx";

export type Docs = Omit<DocsResponse, "ok">;
export interface DocsContext {
  docs: Docs | null;
  axes: Record<AxisKey, AxisInfo> | null;
  /** The last fetch failed and no docs are up: a page that needs them shows an error with `retry`. */
  failed: boolean;
  retry: () => void;
}

const Ctx = createContext<DocsContext>({ docs: null, axes: null, failed: false, retry: () => {} });

/**
 * GET /api/docs?lang= once per page load and again when the UI language changes (public, 0 WCL pts): the registry and
 * the effective config that the callouts, the synthesis and the method tab print. The previous language's docs stay up while the
 * next ones load, so a switch never blanks the callouts.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useT();
  const [docs, setDocs] = useState<Docs | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.docs(locale).then((r) => {
      if (!alive) return;
      if (r.ok) setDocs(r);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, [locale, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // The weight line is prose: it follows the UI language, the registry text follows the response.
  const value = useMemo<DocsContext>(
    () => ({ docs, axes: docs ? axisInfo(t, docs) : null, failed: failed && docs === null, retry }),
    [docs, t, failed, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDocs = (): DocsContext => useContext(Ctx);
