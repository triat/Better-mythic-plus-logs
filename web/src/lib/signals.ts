// A sub-signal's plain-language name and one-line hint in the UI language (`signals.<axis>.<id>` in the dictionaries).
// Every place that names a sub-signal goes through here, so French readers never see the registry's English titles.
import type { AxisKey, DocsResponse } from "../types.ts";
import type { MessageKey, T } from "../i18n/t.ts";

/** "survival.individualDeaths" → "Deaths outside wipes"; the registry's title, then the source, when no message exists. */
export function signalName(t: T, source: string, docs?: Pick<DocsResponse, "docs"> | null): string {
  const key = `signals.${source}.name` as MessageKey;
  const name = t(key);
  if (name !== key) return name;
  const [axis, id] = source.split(".") as [AxisKey, string];
  return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
}

/** The one-line explanation shown under or over the name; null for an unknown source. */
export function signalHint(t: T, source: string): string | null {
  const key = `signals.${source}.hint` as MessageKey;
  const hint = t(key);
  return hint === key ? null : hint;
}
