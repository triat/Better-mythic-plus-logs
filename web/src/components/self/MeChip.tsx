import type { LookupPayload } from "../../types.ts";
import { meChip, toggleMe } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SelfActions } from "./ResultHead.tsx";

/** "This is me": adds the payload's character to My characters, or removes it (canvas SelfDetails, ControlVettingA). */
export function MeChip({ payload, self }: { payload: LookupPayload; self: SelfActions }) {
  const { t } = useT();
  const chip = meChip(t, self.characters, payload);
  return (
    <button
      type="button" className={"chip" + (chip.on ? " chip-me" : "")} disabled={chip.disabled} title={chip.title}
      onClick={() => { const next = toggleMe(self.characters, payload); if (next) self.setCharacters(next); }}
    >
      {chip.label}
    </button>
  );
}
