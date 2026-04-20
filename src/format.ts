import pc from "picocolors";

export const classNames: Record<number, string> = {
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

export const classColor = (classID: number, text: string): string => {
  switch (classID) {
    case 1: return pc.red(text);                // DK
    case 2: return pc.yellow(text);             // Druid
    case 3: return pc.green(text);              // Hunter
    case 4: return pc.cyan(text);               // Mage
    case 5: return pc.green(text);              // Monk
    case 6: return pc.magenta(text);            // Paladin
    case 7: return pc.white(text);              // Priest
    case 8: return pc.yellow(text);             // Rogue
    case 9: return pc.blue(text);               // Shaman
    case 10: return pc.magenta(text);           // Warlock
    case 11: return pc.yellow(text);            // Warrior
    case 12: return pc.magenta(text);           // DH
    case 13: return pc.green(text);             // Evoker
    default: return text;
  }
};

export const percentileColor = (p: number): string => {
  const s = p.toFixed(1);
  if (p >= 99) return pc.magenta(s);
  if (p >= 95) return pc.red(s);
  if (p >= 75) return pc.magenta(s);
  if (p >= 50) return pc.blue(s);
  if (p >= 25) return pc.green(s);
  return pc.gray(s);
};

export const heading = (text: string): string => pc.bold(pc.cyan(text));
export const dim = (text: string): string => pc.dim(text);
export const err = (text: string): string => pc.red(pc.bold(text));
export const ok = (text: string): string => pc.green(text);
