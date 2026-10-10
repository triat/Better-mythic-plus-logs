#!/usr/bin/env bun
// Usage: bun scripts/capture-control.ts <Name> <reportCode> <fightID> <out.json>
// The run's summary must already be cached (a lookup or a sync first). Costs ~3 WCL pts.
import { fetchRunControl } from "../src/signals/enrich.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { gql } from "../src/wcl/client.ts";

const [character, code, fightStr, out] = process.argv.slice(2);
if (!character || !code || !fightStr || !out) { console.error("usage: capture-control <Name> <code> <fight> <out.json>"); process.exit(2); }
const fightID = Number.parseInt(fightStr, 10);
const store = await getStore();
const report = store.getWclRun(code, fightID);
if (!report) { console.error("run not in cache"); process.exit(1); }
const control = await fetchRunControl({ reportCode: code, fightID }, gql);
if (!control) { console.error("WCL returned no report"); process.exit(1); }
// Only what controlOf reads: the fights and the summary's composition (actor ids, specs) and length.
const trimmed = { code: report.code, fights: report.fights, summary: { data: { totalTime: report.summary?.data?.totalTime, composition: report.summary?.data?.composition } } };
await Bun.write(out, JSON.stringify({ character, report: trimmed, control }, null, 1));
console.log(`wrote ${out}: ${control.events.length} events, ${control.pets.length} pets`);
closeStore();
