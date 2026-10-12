import type { MyCharacter, OwnClientView } from "../../types.ts";

/** What the self-review needs from App: the mode, the member's own client and their characters (Settings). */
export interface SelfActions {
  hosted: boolean;
  ownClient: OwnClientView | null;
  setOwnClient: (v: OwnClientView | null) => void;
  characters: MyCharacter[];
  setCharacters: (v: MyCharacter[]) => void;
  /** Replaces the list with what the server already stored (Battle.net pick, unlink): no PUT. */
  adoptCharacters: (v: MyCharacter[]) => void;
}
