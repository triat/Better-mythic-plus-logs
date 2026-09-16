import type { LookupPayload } from "../types.ts";
import { tiles } from "../lib/tiles.ts";

export function SignalTiles({ payload }: { payload: LookupPayload }) {
  return (
    <div className="tiles">
      {tiles(payload).map((t) => (
        <div key={t.label} className={"tile inset" + (t.empty ? " tile-empty" : "")}>
          <span className="label-caps">{t.label}</span>
          <span className={"tile-value mono " + t.cls}>{t.value}{t.sub && <span className="tile-sub">{t.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}
