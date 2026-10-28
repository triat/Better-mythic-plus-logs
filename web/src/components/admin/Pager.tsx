import { pageList } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";
import { Icon } from "../Icon.tsx";

/** Numbered pages with previous / next (canvas "bmpl · Admin listes", A); nothing when everything fits on one page. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useT();
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={t("admin.pager.label")}>
      <button type="button" className="pager-btn pager-prev" disabled={page <= 1} aria-label={t("admin.pager.prev")} onClick={() => onPage(page - 1)}>
        <Icon name="chevron" size={14} />
      </button>
      {pageList(page, pages).map((n, i) =>
        n === "gap" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity but its place
          <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">{t("admin.pager.gap")}</span>
        ) : (
          <button
            key={n} type="button" className={"pager-btn" + (n === page ? " on" : "")}
            aria-current={n === page ? "page" : undefined} aria-label={t("admin.pager.page", { n })} onClick={() => onPage(n)}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className="pager-btn pager-next" disabled={page >= pages} aria-label={t("admin.pager.next")} onClick={() => onPage(page + 1)}>
        <Icon name="chevron" size={14} />
      </button>
    </nav>
  );
}
