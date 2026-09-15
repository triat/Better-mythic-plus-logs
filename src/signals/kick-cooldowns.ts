// Baseline interrupt cooldowns (seconds) per class:spec, no talent
// reductions. `null` = the spec has no interrupt. Keyed by the class name
// and spec name exactly as WCL's Summary `composition` reports them.
const KICK_CD: Record<string, number | null> = {
  "DeathKnight:Blood": 15, "DeathKnight:Frost": 15, "DeathKnight:Unholy": 15,        // Mind Freeze
  "DemonHunter:Havoc": 15, "DemonHunter:Vengeance": 15, "DemonHunter:Devourer": 15,  // Disrupt
  "Druid:Balance": 60,                                                                   // Solar Beam
  "Druid:Feral": 15, "Druid:Guardian": 15,                                               // Skull Bash
  "Druid:Restoration": null,
  "Evoker:Devastation": 40, "Evoker:Preservation": 40, "Evoker:Augmentation": 40,        // Quell
  "Hunter:BeastMastery": 24, "Hunter:Marksmanship": 24,                                  // Counter Shot
  "Hunter:Survival": 15,                                                                 // Muzzle
  "Mage:Arcane": 24, "Mage:Fire": 24, "Mage:Frost": 24,                                  // Counterspell
  "Monk:Brewmaster": 15, "Monk:Windwalker": 15,                                          // Spear Hand Strike
  "Monk:Mistweaver": null,
  "Paladin:Protection": 15, "Paladin:Retribution": 15,                                   // Rebuke
  "Paladin:Holy": null,
  "Priest:Shadow": 45,                                                                   // Silence
  "Priest:Holy": null, "Priest:Discipline": null,
  "Rogue:Assassination": 15, "Rogue:Outlaw": 15, "Rogue:Subtlety": 15,                   // Kick
  "Shaman:Elemental": 12, "Shaman:Enhancement": 12, "Shaman:Restoration": 12,            // Wind Shear
  "Warlock:Affliction": 24, "Warlock:Demonology": 24, "Warlock:Destruction": 24,         // Spell Lock (pet)
  "Warrior:Arms": 15, "Warrior:Fury": 15, "Warrior:Protection": 15,                      // Pummel
};

// WCL's `composition[].type` reports multi-word classes with no space
// (e.g. "DeathKnight", "DemonHunter"); normalize both sides so lookups
// work regardless of spacing.
const normalizeClassName = (className: string): string => className.replace(/\s+/g, "");

export const kickCooldownFor = (className: string, spec: string): number | null =>
  KICK_CD[`${normalizeClassName(className)}:${spec}`] ?? null;
