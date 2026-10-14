// The user-facing changelog, source language. Every pull request with a user-visible change adds its line under
// "next" here and in fr.ts (same versions, same number of lines). Newest first.
import type { ChangelogEntry } from "./types.ts";

export const CHANGELOG_EN: ChangelogEntry[] = [
  {
    version: "0.10.4",
    date: "2026-10-14",
    items: [
      "Scores now stay measured against this season's players: they are re-checked every week.",
    ],
  },
  {
    version: "0.10.3",
    date: "2026-10-14",
    items: [
      "The version of bmpl you use now shows at the bottom of the sidebar, under your account.",
      "A blue dot tells you bmpl changed since your last visit: click it to read what's new.",
    ],
  },
  {
    version: "0.10.2",
    date: "2026-10-14",
    items: [
      "Each death now says whether a health potion or a healthstone would have saved you, and why.",
      "One-shots no longer count as avoidable deaths.",
      "The number of potions drunk per run no longer counts in the score.",
    ],
  },
  {
    version: "0.10.1",
    date: "2026-10-12",
    items: [
      "The score's signals have plain names, each with a short explanation.",
    ],
  },
];
