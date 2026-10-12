// Small pieces both compare layouts share: the different-target warning, the dungeon tile, the ✓ / ✗ mark.
import { useT } from "../../locale.tsx";
import { Icon } from "../Icon.tsx";

export function CompareWarning({ text }: { text: string }) {
  return <p className="cmp-warning"><Icon name="info" size={16} />{text}</p>;
}

export function DungeonTile({ abbr, name }: { abbr: string; name: string }) {
  return (
    <span className="cmp-dname">
      <span className="cmp-dtile" aria-hidden="true">{abbr}</span>
      <span className="cmp-dname-text">{name}</span>
    </span>
  );
}

/** ✓ timed (`--invite`), ✗ depleted (`--pass`), nothing when unknown. */
export function TimedMark({ timed }: { timed: boolean | null }) {
  const { t } = useT();
  if (timed === null) return null;
  return (
    <span className={timed ? "cmp-timed" : "cmp-depleted"} role="img" aria-label={t(timed ? "compare.dungeon.timed" : "compare.dungeon.depleted")}>
      {timed ? "✓" : "✗"}
    </span>
  );
}
