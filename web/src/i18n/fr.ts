import type { Mirror } from "./t.ts";
import type { en } from "./en.ts";

// French mirror of en.ts: same keys, player's franglais, "tu". WoW terms stay English (kick, key, timed,
// parse, wipe, DPS/HPS, run, reset, ilvl, spec, cooldown…); see the plan's glossary.
export const fr: Mirror<typeof en> = {
  common: {
    loading: "chargement…",
    close: "Fermer",
    cancel: "Annuler",
    save: "Enregistrer",
    back: "← retour",
    backToLookups: "← retour aux recherches",
    help: "Aide",
    settings: "Paramètres",
    privacy: "Confidentialité",
    admin: "Admin",
    signOut: "Se déconnecter",
    dismiss: "Fermer",
    locale: {
      title: "Langue",
      remembered: "Langue · mémorisée",
      hint: "Mémorisée sur ce compte",
    },
    age: {
      justNow: "à l'instant",
      hours: "il y a {n} h",
      days: "il y a {n} j",
      weeks: "il y a {n} sem.",
      months: "il y a {n} mois",
      years: "il y a {n} an(s)",
    },
  },
};
