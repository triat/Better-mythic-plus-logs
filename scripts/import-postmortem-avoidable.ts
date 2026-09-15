// Imports postmortem's avoidable-damage spell list (Blizzard's in-game
// classification captured by their addon) and re-keys it by WCL encounter
// ID. Re-run whenever upstream updates: `just import-avoidable`.
//
// Attribution: https://github.com/Sharpened-Banana/postmortem (lonezebra).

const UPSTREAM =
  "https://raw.githubusercontent.com/Sharpened-Banana/postmortem/main/src/postmortem/data/avoidable_spells.json";
const OUT = new URL("../src/signals/avoidable/season-mn-2.json", import.meta.url);

// postmortem keys dungeons by MDT index (see their dungeon_data.json).
// WCL encounter IDs come from `worldData.zone(id: 55).encounters`.
const MDT_TO_WCL: Record<string, { wcl: number; name: string }> = {
  "17": { wcl: 61762, name: "Kings' Rest" },
  "20": { wcl: 61877, name: "Temple of Sethraliss" },
  "42": { wcl: 112521, name: "Ruby Life Pools" },
  "160": { wcl: 12813, name: "Murder Row" },
  "161": { wcl: 12825, name: "Den of Nalorakk" },
  "162": { wcl: 12859, name: "The Blinding Vale" },
  "163": { wcl: 12923, name: "Voidscar Arena" },
  "164": { wcl: 12993, name: "Altar of Fangs" },
};

interface Upstream {
  spells: Array<{ id: number; name: string }>;
  dungeons: Record<string, number[]>;
}

const res = await fetch(UPSTREAM);
if (!res.ok) throw new Error(`upstream ${res.status}`);
const up = (await res.json()) as Upstream;

const spells: Record<string, string> = {};
for (const s of up.spells) spells[String(s.id)] = s.name;

const dungeons: Record<string, number[]> = {};
for (const [mdt, ids] of Object.entries(up.dungeons)) {
  const m = MDT_TO_WCL[mdt];
  if (!m) {
    console.warn(`skip unknown MDT dungeon index ${mdt} (${ids.length} spells)`);
    continue;
  }
  dungeons[String(m.wcl)] = [...ids].sort((a, b) => a - b);
}

const out = {
  season: "season-mn-2",
  source:
    "https://github.com/Sharpened-Banana/postmortem (addon by lonezebra) — Blizzard's in-game avoidable-damage classification, captured via C_DamageMeter",
  importedAt: new Date().toISOString(),
  spells,
  dungeons,
};
await Bun.write(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(
  `wrote ${OUT.pathname}: ${Object.keys(spells).length} spells, ${Object.keys(dungeons).length} dungeons`,
);
