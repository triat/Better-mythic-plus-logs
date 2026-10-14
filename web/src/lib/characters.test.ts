import { describe, expect, test } from "bun:test";
import type { HistoryItem, MyCharacter, OwnClientView, SeasonView, WorkOnRow } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { barBand, charKey, characterCards, filterCards, listShown, menuStep, seasonsLoaded, type CharactersInput } from "./characters.ts";
import { makeMain, moveUp, removeAt } from "./me.ts";

const tFr = makeT(fr, "fr");
const NOW = Date.UTC(2026, 9, 12, 12);
const H = 3600e3;
const titleOf = (s: string) => (s === "survival.wipeDeaths" ? "Wipe deaths" : s);

const c = (name: string, realm = "nerzhul", source: MyCharacter["source"] = "bnet"): MyCharacter =>
  ({ name, realm, region: "eu", source, ...(source === "bnet" ? { bnetId: 1, verifiedAt: NOW } : {}) });

const pillars = (v: [number | null, number | null, number | null, number | null, number | null]) =>
  (["damage", "survival", "avoidable", "interrupts", "control"] as const).map((key, i) => ({ key, score: v[i]!, evidence: [] }));

const wipes: WorkOnRow = {
  source: "survival.wipeDeaths", pillar: "survival", impact: -4, value: 2, reference: 0.1, label: "2.0 / run", past: null,
};

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "X", realm: "hyjal", region: "eu" }, zoneID: 55, targetLevel: 19, currentWeek: 10, checkedAt: NOW - 7 * H,
  state: { runs: 94, analysed: 94, pending: 0, controlOnly: 0, failed: 0, estimate: 0 },
  runs: [{} as SeasonView["runs"][number]], recent: { runs: 40, pillars: pillars([64, 66, 76, 68, 55]), overall: 66 }, season: null,
  trends: [], workOn: [wipes], dungeons: [], ...over,
});

const history: HistoryItem[] = [{
  key: "h1", label: "Biwaasham-Hyjal", charClass: 9, spec: "Elemental", targetLevel: 19, targetAutoDetected: true, verdict: "invite", score: 72,
  fetchedAt: NOW, request: { character: "Biwaasham-Hyjal", region: "eu" },
} as HistoryItem];

const list = [c("Biwaasham", "hyjal"), c("Biwaarlock"), c("Biwaapriest"), c("Biwaapal", "hyjal")];
const seasons: Record<string, SeasonView | null> = {
  Biwaasham: season(),
  Biwaarlock: season({
    state: { runs: 33, analysed: 8, pending: 25, controlOnly: 0, failed: 0, estimate: 335 },
    recent: null, season: { runs: 8, pillars: pillars([67, 78, 82, 49, null]), overall: null }, workOn: [],
  }),
  Biwaapriest: null,
  Biwaapal: season({ runs: [] }),
};
const usable: OwnClientView = { clientId: "abc…", verifiedAt: NOW, updatedAt: NOW, usable: true, snapshot: null };
const input = (over: Partial<CharactersInput> = {}): CharactersInput => ({
  list, seasonOf: (x) => seasons[x.name] ?? null, history, hosted: true, ownClient: usable, titleOf, now: NOW, ...over,
});

describe("characterCards", () => {
  test("grouping, counts, the main card first, list order kept", () => {
    const v = characterCards(tEn, "en", input());
    expect(v.withSeason.map((x) => [x.name, x.index, x.main])).toEqual([["Biwaasham", 0, true], ["Biwaarlock", 1, false]]);
    expect(v.without.map((x) => [x.name, x.index, x.realm])).toEqual([["Biwaapriest", 2, "Nerzhul EU"], ["Biwaapal", 3, "Hyjal EU"]]);
    expect(v.counts).toEqual({ all: 4, season: 2, none: 2 });
    expect(v.filters.map((f) => [f.label, f.n])).toEqual([["All", 4], ["With a season", 2], ["Without a season", 2]]);
    expect(v.tracked).toBe("4 / 20 characters tracked");
    const f = characterCards(tFr, "fr", input());
    expect([f.seasonTitle, f.noneTitle, f.tracked]).toEqual(["Avec une saison · 2", "Pas encore de saison · 2", "4 / 20 persos suivis"]);
    expect(f.filters.map((x) => x.label)).toEqual(["Tous", "Avec saison", "Sans saison"]);
    // A main without a season stays first in the compact group.
    const m = characterCards(tEn, "en", input({ list: [list[2]!, list[0]!] }));
    expect(m.without.map((x) => [x.name, x.main])).toEqual([["Biwaapriest", true]]);
    expect(m.withSeason.map((x) => [x.name, x.main])).toEqual([["Biwaasham", false]]);
  });

  test("a card: class from history, global, bars, line, note", () => {
    const [main, other] = characterCards(tFr, "fr", input()).withSeason;
    expect([main!.sub, main!.initials, main!.classColor !== null, main!.global]).toEqual(["Elemental Shaman · Hyjal EU", "Sh", true, "66"]);
    expect(main!.bars.map((b) => [b.label, b.text, b.band])).toEqual([
      ["Dégâts", "64", "neutral"], ["Survie", "66", "neutral"], ["Dégâts évitables", "76", "better"], ["Interruptions", "68", "neutral"], ["Contrôle", "55", "neutral"],
    ]);
    expect(main!.line).toBe("94 runs cette saison · à jour");
    expect(main!.note.tone).toBe("worse");
    expect(main!.note.text).toStartWith("À travailler : Wipe deaths (");
    expect(main!.note.text).toEndWith(", −4 pts)");
    expect(main!.note.hint).toBe("Ses morts quand au moins 3 joueurs meurent en 15 s ; ça compte peu.");
    expect([other!.sub, other!.initials, other!.classColor, other!.global]).toEqual(["Nerzhul EU", "Bi", null, "—"]);
    expect(other!.bars.map((b) => b.band)).toEqual(["neutral", "better", "better", "worse", "na"]);
    expect(other!.line).toBe("33 runs · 25 non analysés · vérifié il y a 7 h");
    expect(other!.note).toEqual({ text: "Piliers calculés sur 8 runs analysés", tone: "neutral", hint: null });
    const few = characterCards(tEn, "en", input({ seasonOf: () => season({ recent: null, season: null, workOn: [] }) })).withSeason[0]!;
    expect(few.note).toEqual({ text: "The pillars need 3 analysed runs: sync the season", tone: "neutral", hint: null });
    expect(characterCards(tEn, "en", input()).withSeason[1]!.line).toBe("33 runs · 25 not analysed · checked 7h ago");
  });

  test("note: never the raw source key while the docs are not loaded (or the source is unknown)", () => {
    const main = (titleOf: CharactersInput["titleOf"]) => characterCards(tEn, "en", input({ titleOf })).withSeason[0]!.note;
    for (const n of [main(null), main((s) => s)]) {
      expect(n.tone).toBe("worse");
      expect(n.text).not.toContain("survival.wipeDeaths");
      expect(n.text).toBe("Work on: 2.0 deaths in wipes/run (−4 pts)");
    }
    expect(main(titleOf).text).toStartWith("Work on: Wipe deaths (");
    expect(characterCards(tFr, "fr", input({ titleOf: null })).withSeason[0]!.note.text).toStartWith("À travailler : 2,0 ");
  });

  test("open: the history entry at 0 pts, else the lookup link; Raider.IO", () => {
    const v = characterCards(tEn, "en", input());
    expect(v.withSeason[0]!.open).toEqual({ href: "/candidate?open=h1", label: "Open", hint: "from history · 0 pts" });
    expect(v.withSeason[1]!.open.label).toBe("Look up");
    expect(v.withSeason[1]!.open.href).toBe(`/?q=${encodeURIComponent("https://raider.io/characters/eu/nerzhul/Biwaarlock")}`);
    expect(v.withSeason[1]!.rio).toBe("https://raider.io/characters/eu/nerzhul/Biwaarlock");
    expect(v.without[0]!.search.label).toBe("Look up");
  });

  test("sync: the cost on the button, absent when nothing is pending or without a usable own client (hosted)", () => {
    const v = characterCards(tFr, "fr", input());
    expect(v.withSeason[0]!.sync).toBeNull();
    expect(v.withSeason[1]!.sync).toBe("Synchroniser 25 runs · ~335 pts");
    expect(v.withSeason[1]!.noClient).toBe(false);
    const none = characterCards(tEn, "en", input({ ownClient: null }));
    expect(none.withSeason.map((x) => [x.sync, x.noClient])).toEqual([[null, true], [null, true]]);
    const broken = characterCards(tEn, "en", input({ ownClient: { ...usable, usable: false } }));
    expect(broken.withSeason[1]!.sync).toBeNull();
    const local = characterCards(tEn, "en", input({ hosted: false, ownClient: null }));
    expect(local.withSeason.map((x) => [x.sync, x.noClient])).toEqual([[null, false], ["Sync 25 runs · ~335 pts", false]]);
  });

  test("menus: hosted and local alike (remove allowed, no add when hosted)", () => {
    const hosted = characterCards(tEn, "en", input());
    const local = characterCards(tEn, "en", input({ hosted: false }));
    const actions = (v: typeof hosted) => [...v.withSeason, ...v.without].map((x) => x.menu.map((m) => m.action));
    // The main (index 0) offers no action at all: it is never removed, another character is made main first.
    expect(actions(hosted)).toEqual([[], ["main", "remove"], ["main", "up", "remove"], ["main", "up", "remove"]]);
    expect(actions(local)).toEqual(actions(hosted));
    expect(characterCards(tFr, "fr", input()).without[0]!.menu.map((m) => [m.label, m.danger])).toEqual([
      ["En faire le principal", false], ["Monter dans la liste", false], ["Retirer du suivi", true],
    ]);
    expect([hosted.canAdd, local.canAdd]).toEqual([false, true]);
    const full = Array.from({ length: 20 }, (_, i) => c(`Name${String.fromCharCode(97 + i)}`, "hyjal", "manual"));
    expect(characterCards(tEn, "en", input({ hosted: false, list: full })).canAdd).toBe(false);
  });

  test("a season still loading or that failed is not shown as \"no season yet\"", () => {
    const load = { Biwaasham: "failed", Biwaarlock: "ok", Biwaapriest: "failed", Biwaapal: "loading" } as const;
    const v = characterCards(tEn, "en", input({ loadOf: (x) => load[x.name as keyof typeof load] }));
    // A failed reload keeps the season it had, with the line; a character with nothing loaded says why on its row.
    expect(v.withSeason.map((x) => [x.name, x.status])).toEqual([
      ["Biwaasham", "Could not load the season: reload the page to try again."], ["Biwaarlock", null],
    ]);
    expect(v.without.map((x) => [x.name, x.status])).toEqual([
      ["Biwaapriest", "Could not load the season: reload the page to try again."], ["Biwaapal", null],
    ]);
    const loading = characterCards(tFr, "fr", input({ loadOf: (x) => (x.name === "Biwaapriest" ? "loading" : "ok") }));
    expect(loading.without[0]!.status).toBe("Chargement de sa saison…");
    expect(loading.counts).toEqual({ all: 4, season: 2, none: 1 });
    expect(characterCards(tEn, "en", input()).without.map((x) => x.status)).toEqual([null, null]);
  });

  test("filterCards", () => {
    const v = characterCards(tEn, "en", input());
    expect(filterCards(v, "all")).toEqual({ withSeason: v.withSeason, without: v.without });
    expect(filterCards(v, "season")).toEqual({ withSeason: v.withSeason, without: [] });
    expect(filterCards(v, "none")).toEqual({ withSeason: [], without: v.without });
  });

  test("keys and bands", () => {
    expect(charKey(c("Biwaasham", "Hyjal"))).toBe("eu|hyjal|biwaasham");
    expect([70, 69, 50, 49, null].map(barBand)).toEqual(["better", "neutral", "neutral", "worse", "na"]);
  });
});

describe("moveUp", () => {
  test("one place up; the first and out-of-range indexes change nothing", () => {
    const names = (l: MyCharacter[]) => l.map((x) => x.name);
    expect(names(moveUp(list, 2))).toEqual(["Biwaasham", "Biwaapriest", "Biwaarlock", "Biwaapal"]);
    expect(names(moveUp(list, 1))).toEqual(names(makeMain(list, 1)));
    expect(moveUp(list, 0)).toBe(list);
    expect(moveUp(list, 9)).toBe(list);
    expect(names(removeAt(moveUp(list, 3), 0))).toEqual(["Biwaarlock", "Biwaapal", "Biwaapriest"]);
  });
});

describe("seasonsLoaded and menuStep", () => {
  test("every character's answer must be in; an empty list is loaded", () => {
    const keys = new Set(list.slice(0, 3).map(charKey));
    expect(seasonsLoaded(list, (k) => keys.has(k))).toBe(false);
    keys.add(charKey(list[3]!));
    expect(seasonsLoaded(list, (k) => keys.has(k))).toBe(true);
    expect(seasonsLoaded([], () => false)).toBe(true);
  });

  test("only the first load hides the list", () => {
    expect([listShown(false, false), listShown(false, true), listShown(true, false), listShown(true, true)]).toEqual([false, true, true, true]);
  });

  test("arrows wrap, Home / End jump, other keys do nothing", () => {
    expect([menuStep("ArrowDown", 2, 3), menuStep("ArrowUp", 0, 3), menuStep("Home", 2, 3), menuStep("End", 0, 3)]).toEqual([0, 2, 0, 2]);
    expect([menuStep("Enter", 1, 3), menuStep("ArrowDown", 0, 0)]).toEqual([null, null]);
  });
});
