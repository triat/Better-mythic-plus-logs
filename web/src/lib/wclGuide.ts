// The guided own-client sheet (canvas "bmpl · Clé WCL guidée", variant A): shown where a lookup was refused for the
// member's hourly quota, it walks them through creating their own Warcraft Logs API client. Pure; tested.
import type { QuotaInfo } from "../api.ts";
import type { T } from "../i18n/t.ts";
import type { OwnClientView } from "../types.ts";
import { fmtPts } from "./format.ts";

/** Where a WCL account creates its API clients. */
export const WCL_CLIENTS_URL = "https://www.warcraftlogs.com/api/clients";
/** Each WCL API client's hourly budget (the instance client's limit, measured 2026-10-26). */
export const WCL_CLIENT_POINTS_PER_HOUR = 3600;
/** The name suggested for the member's client on warcraftlogs.com. */
export const SUGGESTED_CLIENT_NAME = "bmpl";

export interface WclGuideView {
  title: string;
  pitch: string;
  /** The values to type on WCL's "Create Client" form, each with a Copy button. */
  values: Array<{ key: "name" | "redirect"; label: string; value: string }>;
  wait: string;
}

const minutes = (s: number): number => Math.max(1, Math.ceil(s / 60));

/** Whether a refused lookup gets the sheet rather than a toast: hosted, own clients stored by the instance, a quota
 *  refusal (not the instance's budget), no usable own client already. */
export const showsWclGuide = (o: { hosted: boolean; wclClients: boolean; ownClient: OwnClientView | null; quota: QuotaInfo | undefined }): boolean =>
  o.hosted && o.wclClients && o.quota !== undefined && !(o.ownClient?.usable ?? false);

export function wclGuideView(t: T, q: QuotaInfo, origin: string): WclGuideView {
  const limit = Math.round(q.limit ?? 0);
  const pts = fmtPts(WCL_CLIENT_POINTS_PER_HOUR);
  const times = limit > 0 ? Math.round(WCL_CLIENT_POINTS_PER_HOUR / limit) : 0;
  return {
    title: t("wclGuide.title", { used: Math.round(q.used), limit, min: minutes(q.resetInS) }),
    pitch: times > 1 ? t("wclGuide.pitch", { pts, times }) : t("wclGuide.pitchPlain", { pts }),
    values: [
      { key: "name", label: "Name", value: SUGGESTED_CLIENT_NAME },
      { key: "redirect", label: "Redirect URL", value: origin },
    ],
    wait: t("wclGuide.wait", { min: minutes(q.resetInS) }),
  };
}

/** The sidebar's link under "quota reached" (canvas variant C's line): to the Settings card. */
export const keyLinkLabel = (t: T): string => t("header.quota.keyLink", { pts: fmtPts(WCL_CLIENT_POINTS_PER_HOUR) });
