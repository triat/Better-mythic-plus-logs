import type { LookupPayload } from "../types.ts";
import { tiles } from "../lib/tiles.ts";
import { useT } from "../locale.tsx";

export function SignalTiles({ payload }: { payload: LookupPayload }) {
  const { t } = useT();
  return (
    <div className="tiles">
      {tiles(t, payload).map((tile) => (
        <div key={tile.label} className={"tile inset" + (tile.empty ? " tile-empty" : "")}>
          <span className="label-caps">{tile.label}</span>
          <span className={"tile-value mono " + tile.cls}>{tile.value}{tile.sub && <span className="tile-sub">{tile.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}
