import { describe, expect, test } from "bun:test";
import { EVIDENCE_SOURCES } from "../../src/evaluation/axes/index.ts";
import { EVALUATION_DOCS } from "../../src/evaluation/docs.ts";
import { AXIS_KEYS } from "../../src/evaluation/types.ts";
import { en } from "../../web/src/i18n/en.ts";
import { fr } from "../../web/src/i18n/fr.ts";
import { makeT, tEn } from "../../web/src/i18n/t.ts";
import { signalHint, signalName } from "../../web/src/lib/signals.ts";

// The web front names every sub-signal from the dictionaries (web/src/lib/signals.ts), never from the registry's
// English titles. This file crosses both trees on purpose — tests under test/ may — so a sub-signal added to
// src/evaluation/docs.ts without a plain-language name and hint fails here.
const tFr = makeT(fr, "fr");
const registrySources = AXIS_KEYS.flatMap((axis) => Object.keys(EVALUATION_DOCS.axes[axis].subSignals).map((id) => `${axis}.${id}`));

describe("sub-signal names and hints", () => {
  test("every registry sub-signal has a name and a hint in both languages", () => {
    expect(registrySources.length).toBeGreaterThan(0);
    for (const source of registrySources) {
      for (const t of [tEn, tFr]) {
        expect(signalName(t, source), source).not.toBe(source);
        expect(signalHint(t, source)?.trim().length ?? 0, source).toBeGreaterThan(0);
      }
    }
  });
  test("the dictionaries name exactly the registry's sub-signals, and every evidence source", () => {
    const keys = (d: typeof en) => Object.entries(d.signals).flatMap(([axis, ids]) => Object.keys(ids).map((id) => `${axis}.${id}`)).sort();
    expect(keys(en)).toEqual([...registrySources].sort());
    expect(keys(fr as typeof en)).toEqual([...registrySources].sort());
    expect([...EVIDENCE_SOURCES].map(String).sort()).toEqual([...registrySources].sort());
  });
  test("French reads in plain words", () => {
    expect(signalName(tFr, "throughput.parseAtTarget")).toBe("Parse sur les clés visées");
    expect(signalName(tFr, "preparation.ilvlVsLevel")).toBe("Équipement pour la clé visée");
    expect(signalHint(tEn, "preparation.ilvlVsLevel")).toBe("Item level compared with what the season expects at the target key: +3 = 3 above.");
  });
});
