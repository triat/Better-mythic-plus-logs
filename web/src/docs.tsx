import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AxisKey, DocsResponse } from "./types.ts";
import { api } from "./api.ts";
import { axisInfo } from "./lib/axes.ts";
import type { AxisInfo } from "./lib/axes.ts";
import { useT } from "./locale.tsx";

export type Docs = Omit<DocsResponse, "ok">;
export interface DocsContext { docs: Docs | null; axes: Record<AxisKey, AxisInfo> | null }

const Ctx = createContext<DocsContext>({ docs: null, axes: null });

/** GET /api/docs once per page load (public, 0 WCL pts): the registry and the effective config that the callouts and the radar tooltips print. */
export function DocsProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [docs, setDocs] = useState<Docs | null>(null);
  useEffect(() => {
    let alive = true;
    api.docs().then((r) => { if (alive && r.ok) setDocs(r); });
    return () => { alive = false; };
  }, []);
  // The weight line is prose: it follows the UI language, the registry text follows the response.
  const value = useMemo<DocsContext>(() => ({ docs, axes: docs ? axisInfo(t, docs) : null }), [docs, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDocs = (): DocsContext => useContext(Ctx);
