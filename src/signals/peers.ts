import type { GroupRole, PeerComparison } from "./types.ts";

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
};

/**
 * Median of `value` across every player that is not the target, whose role
 * is in `peerRoles`, and whose value is not null. Players missing from
 * `roleByName` are "unknown" and never count.
 */
export function peerComparison(
  values: Array<{ name: string; value: number | null }>,
  target: string,
  roleByName: Map<string, GroupRole>,
  peerRoles: ReadonlySet<GroupRole>,
): PeerComparison | null {
  const peers: number[] = [];
  for (const v of values) {
    if (v.name === target || v.value === null) continue;
    const role = roleByName.get(v.name) ?? "unknown";
    if (!peerRoles.has(role)) continue;
    peers.push(v.value);
  }
  const m = median(peers);
  return m === null ? null : { median: m, count: peers.length };
}
