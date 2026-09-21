import type { ReactNode } from "react";

interface Props {
  /** A raw dictionary message (`t(key)` called with no params, so `{param}` survives — `formatMessage` leaves
   * unknown params in place). */
  message: string;
  /** The placeholder name to split on, e.g. "site" for "{site}". */
  param: string;
  children: ReactNode;
}

/** Splits `message` around `{param}` and renders `children` in its place — for prose with one essential
 * embedded element (a link, a styled code span) that plain param substitution would flatten to text. */
export function Around({ message, param, children }: Props) {
  const marker = `{${param}}`;
  const i = message.indexOf(marker);
  if (i === -1) return <>{message}</>;
  return <>{message.slice(0, i)}{children}{message.slice(i + marker.length)}</>;
}
