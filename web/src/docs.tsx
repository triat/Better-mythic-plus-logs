import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AxisKey, DocsResponse } from "./types.ts";
import { api } from "./api.ts";
import { axisInfo } from "./lib/axes.ts";
import type { AxisInfo } from "./lib/axes.ts";

export type Docs = Omit<DocsResponse, "ok">;
export interface DocsContext { docs: Docs | null; axes: Record<AxisKey, AxisInfo> | null }

const Ctx = createContext<DocsContext>({ docs: null, axes: null });

/** GET /api/docs once per page load (public, 0 WCL pts): the registry and the effective config that the callouts and the radar tooltips print. */
export function DocsProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DocsContext>({ docs: null, axes: null });
  useEffect(() => {
    let alive = true;
    api.docs().then((r) => { if (alive && r.ok) setValue({ docs: r, axes: axisInfo(r) }); });
    return () => { alive = false; };
  }, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDocs = (): DocsContext => useContext(Ctx);
