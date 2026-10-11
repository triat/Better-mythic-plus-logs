// The signed-out landing page of a hosted instance (redesign spec decision 2, mockup F-Landing): what bmpl does, three
// steps, a static product preview, the Discord sign-in and the WCL / privacy facts. Pure: no React, no fetch.
import type { T } from "../i18n/t.ts";
import type { AxisKey } from "../types.ts";
import { deniedNotice, loginFailed, signInNote } from "./hostedMode.ts";
import type { DeniedNotice, StatusInfo } from "./hostedMode.ts";

export interface LandingView {
  /** The sign-in callback's refusal (`?denied=`), exactly as the old sign-in screen showed it. */
  notice: DeniedNotice;
  /** `?login=failed`. */
  loginFailed: boolean;
  /** Who may sign in on this instance and what sign-in reads (`signInNote`). */
  note: string;
  steps: { n: number; title: string; text: string }[];
  facts: { key: "points" | "data"; title: string; text: string }[];
}

export function landingView(t: T, status: StatusInfo, search: string): LandingView {
  const note = signInNote(t, status);
  return {
    notice: deniedNotice(t, search),
    loginFailed: loginFailed(search),
    note,
    steps: (["search", "verdict", "runs"] as const).map((k, i) => ({ n: i + 1, title: t(`landing.steps.${k}.title`), text: t(`landing.steps.${k}.text`) })),
    facts: [
      { key: "points", title: t("landing.facts.points.title"), text: t("landing.facts.points.text") },
      { key: "data", title: t("landing.facts.data.title"), text: note },
    ],
  };
}

/** The static preview's axes (illustrative numbers, no data fetch): label and score. Consistency weighs 0 for every
 *  role by default (redesign spec decision 5), so the preview marks it informational. */
export const PREVIEW_AXES: readonly { key: AxisKey; score: number; informational?: true }[] = [
  { key: "survival", score: 90 }, { key: "preparation", score: 80 }, { key: "utility", score: 74 },
  { key: "throughput", score: 68 }, { key: "consistency", score: 58, informational: true },
];
export const PREVIEW_SCORE = 77;
