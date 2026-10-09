import { useT } from "../locale.tsx";
import { track } from "../usage.ts";

/** Small "?" affordance linking to /help#<anchor> (canvas HelpDetails, variant a). `stopPropagation` so it never
 * triggers the click handler of a surrounding clickable row (AxisRows' axis toggle). */
export function HelpLink({ anchor, title }: { anchor: string; title?: string }) {
  const { t } = useT();
  return (
    <a
      className="help-link"
      href={`/help#${anchor}`}
      title={title ?? t("verdict.howComputed")}
      onClick={(e) => { e.stopPropagation(); track("help_link"); }}
      aria-label={t("common.help")}
    >
      ?
    </a>
  );
}
