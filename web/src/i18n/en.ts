// Every string the web front shows, in English — the source of truth. fr.ts mirrors it key for key
// (Mirror<typeof en> makes a missing or extra key a tsc error). Placeholders: {name}; plurals:
// {count, plural, one {# run} other {# runs}}. Numbers in params are formatted per locale by t.
export const en = {
  common: {
    loading: "loading…",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    back: "← back",
    backToLookups: "← back to lookups",
    help: "Help",
    settings: "Settings",
    privacy: "Privacy",
    admin: "Admin",
    signOut: "Sign out",
    dismiss: "Dismiss",
    locale: {
      title: "Language",
      remembered: "Language · remembered",
      hint: "Remembered on this account",
    },
    age: {
      justNow: "just now",
      hours: "{n}h ago",
      days: "{n}d ago",
      weeks: "{n}w ago",
      months: "{n}mo ago",
      years: "{n}y ago",
    },
  },
} as const;
