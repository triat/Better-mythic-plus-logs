// The user-facing changelog, source language. Every pull request with a user-visible change adds its line under
// "next" here and in fr.ts (same versions, same number of lines). Newest first.
import type { ChangelogEntry } from "./types.ts";

export const CHANGELOG_EN: ChangelogEntry[] = [
  {
    version: "next",
    items: [
      "The privacy page now lists the visit statistics this instance counts: pages opened and a few actions, without cookies or anything about the characters you look at.",
    ],
  },
  {
    version: "0.10.14",
    date: "2026-10-28",
    items: [
      "Item level is now compared with what players at your key level actually wear, refreshed every week, instead of a fixed table that had fallen behind.",
      "Healers' dispels count less, and a tank's score depends less on a single run: both read steadier from one set of runs to the next, so some verdicts move.",
    ],
  },
  {
    version: "0.10.12",
    date: "2026-10-28",
    items: [
      "Strengths and weaknesses now show what each signal adds to or takes from the score compared with the average player, so an item level like most players' no longer shows as a big strength.",
    ],
  },
  {
    version: "0.10.11",
    date: "2026-10-28",
    items: [
      "The sidebar now stays in view while you scroll a long page, with the search at its top and your account at its foot; on a short window, the links and recent lookups between them scroll on their own.",
    ],
  },
  {
    version: "0.10.10",
    date: "2026-10-27",
    items: [
      "bmpl has a logo: its name over three dots, green, yellow and red like the verdicts, in the sidebar and the browser tab.",
      "Missing data no longer helps a player's score: a signal with no data, such as no run at your key level, now counts as an average player's, and analysing a run no longer changes the verdict.",
      "The verdict now says whether the player has already played your key's level and whether a single run decides it, with a reliability block on the summary and a mark in your recent lookups and in Live.",
    ],
  },
  {
    version: "0.10.9",
    date: "2026-10-27",
    items: [
      "You can now message the person who runs bmpl on Discord straight from the sidebar or the account menu.",
    ],
  },
  {
    version: "0.10.8",
    date: "2026-10-26",
    items: [
      "When your hourly quota runs out, bmpl now walks you through creating your own Warcraft Logs key, step by step, and runs your search again once it is saved.",
    ],
  },
  {
    version: "0.10.7",
    date: "2026-10-26",
    items: [
      "Scores are now measured against this season's players again: healers and tanks are rated more strictly than before, so some verdicts go down.",
    ],
  },
  {
    version: "0.10.6",
    date: "2026-10-15",
    items: [
      "When a page fails in your browser, the error is now sent to the operator so it can be fixed; the privacy page says so.",
    ],
  },
  {
    version: "0.10.5",
    date: "2026-10-15",
    items: [
      "The privacy page now lists the request log: what is recorded, and that it is kept 90 days.",
    ],
  },
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
