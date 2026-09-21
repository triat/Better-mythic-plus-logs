import { Fragment } from "react";
import type { ReactNode } from "react";

interface Props {
  /** A raw dictionary message (`t(key)` called with no params, so every `{name}` survives — `formatMessage`
   * leaves unknown params in place). */
  message: string;
  /** Maps each `{name}` placeholder in `message` to the element that replaces it. Order in the message
   * decides render order, not the order of this object's keys. */
  params: Record<string, ReactNode>;
}

/** Splits `message` around its `{name}` placeholders and renders the matching element from `params` in
 * each spot — for prose with one or more essential embedded elements (a link, a styled code span, an
 * untranslated site-literal word) that plain param substitution would flatten to text. */
export function Around({ message, params }: Props) {
  const parts: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const name = m[1]!;
    if (!(name in params)) continue;
    parts.push(message.slice(last, m.index));
    parts.push(<Fragment key={m.index}>{params[name]}</Fragment>);
    last = m.index + m[0].length;
  }
  parts.push(message.slice(last));
  return <>{parts}</>;
}
