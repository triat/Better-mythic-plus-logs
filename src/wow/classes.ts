// Pure table shared by the CLI and the web front: no Bun/Node imports here.

export const CLASS_NAMES: Record<number, string> = {
  1: "Death Knight",
  2: "Druid",
  3: "Hunter",
  4: "Mage",
  5: "Monk",
  6: "Paladin",
  7: "Priest",
  8: "Rogue",
  9: "Shaman",
  10: "Warlock",
  11: "Warrior",
  12: "Demon Hunter",
  13: "Evoker",
};

/** Blizzard's class colors (uppercase hex). */
export const CLASS_COLORS: Record<number, string> = {
  1: "#C41E3A",
  2: "#FF7C0A",
  3: "#AAD372",
  4: "#3FC7EB",
  5: "#00FF98",
  6: "#F48CBA",
  7: "#FFFFFF",
  8: "#FFF468",
  9: "#0070DD",
  10: "#8788EE",
  11: "#C69B6D",
  12: "#A330C9",
  13: "#33937F",
};

export const className = (id: number): string => CLASS_NAMES[id] ?? `class #${id}`;
export const classHex = (id: number): string => CLASS_COLORS[id] ?? "#8b949e";
