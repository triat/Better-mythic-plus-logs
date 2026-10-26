// The user-facing changelog in French: the same versions and the same number of lines as en.ts, in the same order.
import type { ChangelogEntry } from "./types.ts";

export const CHANGELOG_FR: ChangelogEntry[] = [
  {
    version: "next",
    items: [
      "Les scores sont de nouveau mesurés par rapport aux joueurs de cette saison : les healers et les tanks sont notés plus sévèrement qu'avant, certains verdicts baissent.",
    ],
  },
  {
    version: "0.10.6",
    date: "2026-10-15",
    items: [
      "Quand une page plante dans ton navigateur, l'erreur est maintenant envoyée à l'opérateur pour être corrigée ; la page de confidentialité le dit.",
    ],
  },
  {
    version: "0.10.5",
    date: "2026-10-15",
    items: [
      "La page de confidentialité décrit maintenant le journal des requêtes : ce qui est enregistré, et qu'il est gardé 90 jours.",
    ],
  },
  {
    version: "0.10.4",
    date: "2026-10-14",
    items: [
      "Les scores restent mesurés par rapport aux joueurs de la saison en cours : ils sont revérifiés chaque semaine.",
    ],
  },
  {
    version: "0.10.3",
    date: "2026-10-14",
    items: [
      "La version de bmpl que tu utilises s'affiche en bas de la barre latérale, sous ton compte.",
      "Un point bleu t'indique que bmpl a changé depuis ta dernière visite : clique dessus pour lire les nouveautés.",
    ],
  },
  {
    version: "0.10.2",
    date: "2026-10-14",
    items: [
      "Chaque mort indique si une potion de soin ou une pierre de soins t'aurait sauvé, et pourquoi.",
      "Les one-shots ne comptent plus comme des morts évitables.",
      "Le nombre de potions bues par run ne compte plus dans le score.",
    ],
  },
  {
    version: "0.10.1",
    date: "2026-10-12",
    items: [
      "Les signaux du score portent des noms simples, avec une explication courte.",
    ],
  },
];
