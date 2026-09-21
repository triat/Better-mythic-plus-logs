import { useT } from "../locale.tsx";

/** Small "?" affordance linking to /help#<anchor> (canvas HelpDetails, variant a). `stopPropagation` so it never
 * triggers the click handler of a surrounding clickable row (AxisRows' axis toggle). */
export function HelpLink({ anchor, title }: { anchor: string; title?: string }) {
  const { t } = useT();
  return (
    <a
      className="help-link"
      href={`/help#${anchor}`}
      title={title ?? t("verdict.howComputed")}
      onClick={(e) => e.stopPropagation()}
      aria-label={t("common.help")}
    >
      ?
    </a>
  );
}
