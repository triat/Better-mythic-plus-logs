// The Compare page's chip row (mockups F-Comparer-Duel / F-Comparer-Multi): one chip per selected profile, then
// "+ Add a candidate" — a menu over the history, disabled at MAX_COMPARE.
import type { HistoryItem } from "../../types.ts";
import { MAX_COMPARE, addPick, pickMenu } from "../../lib/history.ts";
import { useT } from "../../locale.tsx";
import { ChipMenu } from "../ChipMenu.tsx";

interface Props {
  tabs: HistoryItem[];
  selected: string[];
  /** Three or more: the chips carry the column's series square instead of the verdict dot. */
  ranking: boolean;
  onSelect: (keys: string[]) => void;
}

export function ComparePicker({ tabs, selected, ranking, onSelect }: Props) {
  const { t } = useT();
  const items = pickMenu(t, tabs, selected);
  const full = selected.length >= MAX_COMPARE;
  return (
    <section className="cmp-picker">
      <h1>{t("shell.compare.title")}</h1>
      {selected.map((key, i) => {
        const item = tabs.find((x) => x.key === key);
        if (!item) return null;
        return (
          <span key={key} className="cmp-pick">
            {ranking
              ? <span className={`cmp-series series-${i + 1}`} aria-hidden="true" />
              : <span className={"recent-dot " + (item.verdict ?? "none")} aria-hidden="true" />}
            <span className="cmp-pick-name">{item.label}</span>
            <span className="mono cmp-pick-key">{t("compare.pick.itemLevel", { level: item.targetLevel })}</span>
            <button
              type="button" className="cmp-pick-x" aria-label={t("compare.pick.remove", { name: item.label })}
              onClick={() => onSelect(selected.filter((k) => k !== key))}
            >
              ×
            </button>
          </span>
        );
      })}
      {full || items.length === 0
        ? <button type="button" className="btn cmp-add" disabled>{full ? t("compare.pick.addFull", { max: MAX_COMPARE }) : t("compare.pick.add")}</button>
        : (
          <ChipMenu
            label={t("compare.pick.add")} className="btn cmp-add" head={t("compare.pick.head")} items={items}
            onPick={(key) => onSelect(addPick(selected, key))}
          />
        )}
      {selected.length === 2 && <span className="cmp-hint">{t("compare.pick.hint")}</span>}
    </section>
  );
}
