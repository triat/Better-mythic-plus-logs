// Which classes can dispel or purge anything at all (friendly dispel, enemy
// purge/spellsteal/soothe, or a pet ability). WCL's Dispels table counts all
// of those, so a class with none of them must read as "n/a", not "0 per run".
// Keyed by class name as WCL's Summary `composition[].type` reports it
// (multi-word classes without spaces); spec is accepted for symmetry with the
// kick table but every spec of a class shares the answer today.
const NO_DISPEL = new Set(["Rogue", "Warrior", "DeathKnight"]);

const normalizeClassName = (className: string): string => className.replace(/\s+/g, "");

/** Unknown classes are assumed to have a dispel: never penalize on a guess. */
export const hasDispel = (className: string, _spec: string): boolean => !NO_DISPEL.has(normalizeClassName(className));
