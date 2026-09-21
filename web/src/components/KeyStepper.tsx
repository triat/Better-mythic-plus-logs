import { stepKey } from "../lib/keyLevel.ts";
import { useT } from "../locale.tsx";

interface Props {
  value: number | null;          // null = auto
  /** Where the first step from "auto" lands: the active tab's evaluated level. */
  fallback: number | null;
  onChange: (v: number | null) => void;
}

/** "Your key": the key level every lookup is evaluated for. */
export function KeyStepper({ value, fallback, onChange }: Props) {
  const { t } = useT();
  const auto = value === null;
  return (
    <div className="stepper" role="group" aria-label={t("header.key.label")} title={t("header.key.title")}>
      <span className="stepper-label">{t("header.key.label")}</span>
      <button type="button" className="stepper-btn" aria-label={t("header.key.lower")} onClick={() => onChange(stepKey(value, -1, fallback))}>−</button>
      <span className={"stepper-value mono" + (auto ? " is-auto" : "")}>{auto ? t("header.key.auto") : `+${value}`}</span>
      <button type="button" className="stepper-btn" aria-label={t("header.key.raise")} onClick={() => onChange(stepKey(value, +1, fallback))}>+</button>
      <button type="button" className={"stepper-auto" + (auto ? " on" : "")} onClick={() => onChange(null)} title={t("header.key.autoTitle")}>{t("header.key.auto")}</button>
    </div>
  );
}
