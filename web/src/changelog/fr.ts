// The user-facing changelog in French: the same versions and the same number of lines as en.ts, in the same order.
import type { ChangelogEntry } from "./types.ts";

export const CHANGELOG_FR: ChangelogEntry[] = [
  {
    version: "next",
    items: [
      "La page Confidentialité détaille maintenant les statistiques de visite que compte cette instance : pages ouvertes et quelques actions, sans cookie ni rien sur les personnages consultés.",
    ],
  },
  {
    version: "0.10.14",
    date: "2026-10-28",
    items: [
      "L'item level est maintenant comparé à ce que portent vraiment les joueurs de ton niveau de clé, recalculé chaque semaine, au lieu d'une table fixe qui avait pris du retard.",
      "Les dispels comptent moins pour les healers, et le score d'un tank dépend moins d'un seul run : les deux sont plus stables d'un lot de runs à l'autre, donc certains verdicts bougent.",
    ],
  },
  {
    version: "0.10.12",
    date: "2026-10-28",
    items: [
      "Les forces et faiblesses montrent maintenant ce que chaque signal ajoute ou retire au score face au joueur moyen : un item level comme celui de la plupart des joueurs n'apparaît plus comme une grosse force.",
    ],
  },
  {
    version: "0.10.11",
    date: "2026-10-28",
    items: [
      "La barre latérale reste maintenant visible quand tu fais défiler une longue page, avec la recherche en haut et ton compte en bas ; sur une fenêtre basse, les liens et les recherches récentes entre les deux défilent seuls.",
    ],
  },
  {
    version: "0.10.10",
    date: "2026-10-27",
    items: [
      "bmpl a un logo : son nom au-dessus de trois points, vert, jaune et rouge comme les verdicts, dans la barre latérale et l'onglet du navigateur.",
      "Une donnée manquante n'avantage plus un joueur : un signal sans donnée, par exemple aucun run à ton niveau de clé, compte désormais comme celui d'un joueur moyen, et analyser un run ne change plus le verdict.",
      "Le verdict dit maintenant si le joueur a déjà joué le niveau de ta clé et si un seul run le décide, avec un bloc fiabilité sur la synthèse et une marque dans tes recherches récentes et dans Live.",
    ],
  },
  {
    version: "0.10.9",
    date: "2026-10-27",
    items: [
      "Tu peux maintenant écrire sur Discord à la personne qui fait tourner bmpl, depuis la barre latérale ou le menu du compte.",
    ],
  },
  {
    version: "0.10.8",
    date: "2026-10-26",
    items: [
      "Quand ton quota de l'heure est épuisé, bmpl te guide pas à pas pour créer ta propre clé Warcraft Logs, puis relance ta recherche une fois la clé enregistrée.",
    ],
  },
  {
    version: "0.10.7",
    date: "2026-10-26",
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
