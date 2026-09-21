#!/usr/bin/env bun
// Usage: bun scripts/capture-deepdive.ts <Name-Realm> <reportCode> <fightID> <out.json>
// The run must already be in the local cache (do a `bmpl lookup` first). Costs ~3 WCL pts.
import { SHIPPED, loadDefensives, specDefensives } from "../src/deepdive/table.ts";
import { playerOf } from "../src/deepdive/player.ts";
import { fetchRawDeepDive } from "../src/deepdive/wcl.ts";
import { config } from "../src/config.ts";
import { fetchMplusData } from "../src/mplus.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { parseNameRealm } from "../src/util.ts";
import { gql } from "../src/wcl/client.ts";

const [who, code, fightStr, out] = process.argv.slice(2);
if (!who || !code || !fightStr || !out) { console.error("usage: capture-deepdive <Name-Realm> <code> <fight> <out.json>"); process.exit(2); }
const target = parseNameRealm(who)!;
const fightID = Number.parseInt(fightStr, 10);
const store = await getStore();
const report = store.getWclRun(code, fightID);
if (!report) { console.error("run not in cache — run `bmpl lookup` for this character first"); process.exit(1); }
const data = await fetchMplusData(target.name, target.realm, { region: config.region });
const run = data.runs.find((r) => r.reportCode === code && r.fightID === fightID);
if (!run) { console.error("run not in this character's rankings"); process.exit(1); }
const player = playerOf(report, data.character.name)!;
const { override } = await loadDefensives();
const table = specDefensives(SHIPPED, override, player.className, player.spec);
const deepdive = await fetchRawDeepDive(gql, { code, fightID, character: data.character.name, actorID: player.actorID, ids: table.entries.map((e) => e.id) });
await Bun.write(out, JSON.stringify({ character: data.character.name, run: { ...run, signals: undefined }, report, deepdive }, null, 1));
console.log(`wrote ${out}: ${deepdive.castEvents.length} cast events, ${table.entries.length} table ids, ${deepdive.pointsSpent ?? "?"} pts`);
closeStore();
