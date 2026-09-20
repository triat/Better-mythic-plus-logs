/** Small "?" affordance linking to /help#<anchor> (canvas HelpDetails, variant a). `stopPropagation` so it never
 * triggers the click handler of a surrounding clickable row (AxisRows' axis toggle). */
export function HelpLink({ anchor, title }: { anchor: string; title?: string }) {
  return (
    <a
      className="help-link"
      href={`/help#${anchor}`}
      title={title ?? "How is this computed?"}
      onClick={(e) => e.stopPropagation()}
      aria-label="Help"
    >
      ?
    </a>
  );
}
