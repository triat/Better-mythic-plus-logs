import { stepKey } from "../lib/keyLevel.ts";

interface Props {
  value: number | null;          // null = auto
  /** Where the first step from "auto" lands: the active tab's evaluated level. */
  fallback: number | null;
  onChange: (v: number | null) => void;
}

/** "Your key": the key level every lookup is evaluated for. */
export function KeyStepper({ value, fallback, onChange }: Props) {
  const auto = value === null;
  return (
    <div className="stepper" role="group" aria-label="Your key" title="The key you are filling — every lookup is evaluated for this level">
      <span className="stepper-label">Your key</span>
      <button type="button" className="stepper-btn" aria-label="Lower key level" onClick={() => onChange(stepKey(value, -1, fallback))}>−</button>
      <span className={"stepper-value mono" + (auto ? " is-auto" : "")}>{auto ? "auto" : `+${value}`}</span>
      <button type="button" className="stepper-btn" aria-label="Raise key level" onClick={() => onChange(stepKey(value, +1, fallback))}>+</button>
      <button type="button" className={"stepper-auto" + (auto ? " on" : "")} onClick={() => onChange(null)} title="Auto-detect the level each character actually plays at">auto</button>
    </div>
  );
}
