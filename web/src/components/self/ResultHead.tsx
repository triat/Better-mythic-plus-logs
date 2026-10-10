import { className as classNameOf } from "@shared/wow/classes.ts";
import type { LookupPayload, MyCharacter, OwnClientView } from "../../types.ts";
import { realmName } from "../../lib/format.ts";
import { headLine } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import { MeChip } from "./MeChip.tsx";

/** What the self-review needs from App: the mode, the member's own client and their characters (Settings). */
export interface SelfActions {
  hosted: boolean;
  ownClient: OwnClientView | null;
  setOwnClient: (v: OwnClientView | null) => void;
  characters: MyCharacter[];
  setCharacters: (v: MyCharacter[]) => void;
}

/** Canvas SelfTabs header row: name, realm, "This is me", the season count and the sync button. */
export function ResultHead({ payload, season, self }: { payload: LookupPayload; season: SeasonState; self: SelfActions }) {
  const { t } = useT();
  const c = payload.character;
  return (
    <div className="result-head">
      <h2>{c.name}</h2>
      <span className="muted">{realmName(c.realmSlug)} · {c.region.toUpperCase()} · {classNameOf(c.classID)}</span>
      <MeChip payload={payload} self={self} />
      <div className="grow" />
      {season.view && <span className="muted" style={{ fontSize: 12 }}>{headLine(t, season.view)}</span>}
      <button type="button" className="btn btn-sm" disabled={season.running} onClick={season.syncOpen ? season.closeSync : season.openSync}>
        {t("self.head.sync")}
      </button>
    </div>
  );
}
