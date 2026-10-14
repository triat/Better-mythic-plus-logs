# What's new: the running version and a user-facing changelog — design

Status: approved 2026-10-14 (decisions 1–5 and 7 in chat; display chosen on the canvas the same day, decision 6);
implemented 2026-10-14 (plan `docs/superpowers/plans/2026-10-14-whats-new.md`), checked live in local mode (1440 and 390 px).

## Goal

A member sees which version of bmpl is running, and learns that it changed since their last visit without being
interrupted: a small "What's new" mark, and on demand the list of changes since then, written for players, not
developers.

## Non-goals

- No modal, no toast on page load, no email.
- Not the technical history: the GitHub release notes (generated from commits) stay as they are, for developers.
- No per-member targeting (everyone sees the same entries).

## Decisions (user answers of 2026-10-14)

1. **Claude writes the entries** (user: "Tu rédiges toi"). Every pull request with a user-visible change adds its
   entry, in English and French, in the same change. The user reviews them with the pull request.
2. **The source is a file in the repo**, not the GitHub release body: `web/src/changelog/en.ts` and `fr.ts`, typed
   like the dictionaries (`fr` mirrors `en`: same versions, same number of items per version; a parity test like
   `i18n.test.ts`). Shape:

   ```ts
   export const CHANGELOG: ChangelogEntry[] = [
     { version: "next", items: ["Each death now says whether a health potion would have saved you, and why."] },
     { version: "0.10.2", date: "2026-10-14", items: ["…"] },
   ];
   ```

   Entries accumulate under `"next"`. Plain player language, one sentence each, no internal names (no "deep-dive",
   no "config version"), at most about five items per version.
3. **The release stamps them.** `release.yml`, in the bump commit, renames the `"next"` entry of both files to the new
   version with today's date. It refuses to run when `"next"` is missing or empty in either file ("nothing to tell
   the users"); a release with no user-visible change carries one line saying what improved under the hood.
4. **The running version** comes from the server (`GET /api/status` gains `version`, the `package.json` version the
   binary was built with, like `/api/health`). The front and the server ship in one binary, so they agree.
5. **"Last seen" per member.** Hosted: `user_settings.lastSeenVersion`, read and written through the existing
   `GET/PUT /api/settings`. Local: `localStorage` key `bmpl.lastSeenVersion`. A member who never had a value (a new
   sign-up, a first local run) gets the current version written silently: nothing is "new" on a first visit.
6. **Display: the version line of variant B opens the side panel of variant C** (user, 2026-10-14: "Panneau latéral
   avec l'emplacement de version de l'écran B"). Canvas https://claude.ai/artifact/2pSkoa1YtAww5AHhWepGw8, artboard
   "Retenu"; sources `docs/design/whats-new/` (`Retenu.dc.html`; A, B, C kept as the explored variants).
   - Under the sidebar's account block, one line, a real `<button>`: the version in mono and muted (`v0.10.2`), a
     separator, "What's new" ("Nouveautés"), and a dot (`--better`) while `lastSeenVersion` is older than the running
     version. Without anything new the line still shows the version and opens the panel.
   - The click opens a side panel on the right of the page (440 px, full height, over the content, close button,
     Escape and a click outside close it, focus moves into it and comes back to the button): the title, "since your
     last visit · you use X.Y.Z", the entries newer than `lastSeenVersion` grouped by version (version in mono, date),
     newest first, then "All changes", which shows every version in the same panel. Opening it writes
     `lastSeenVersion`.
   - Under 1000 px wide, where the sidebar stacks above the content, the panel takes the full width.
7. **Versions compare as semver** (`0.10.2` > `0.9.9`), never as strings.

## Data flow

```
release.yml  → bump commit: changelog "next" → "X.Y.Z" (+ date), package.json version → tag → deploy
GET /api/status → { version }                       (0 WCL pts)
front        → lastSeen = settings.lastSeenVersion | localStorage
             → whatsNew(CHANGELOG[locale], lastSeen, running) → entries to show, mark on/off   (pure, tested)
click        → show entries → PUT /api/settings { lastSeenVersion: running } | localStorage
```

## Error handling

- `/api/status` without `version` (an old binary behind a new front cannot happen, one binary): mark hidden.
- `lastSeenVersion` newer than the running version (a rollback): no mark, nothing shown, value left as is.
- A running version absent from the changelog (a hand-made release): the mark still lights; the list shows the
  entries between the two versions that exist.

## Tests

- `web/src/lib/whatsNew.ts` (pure): semver compare, entries between two versions, first visit, rollback, a version
  missing from the file, `"next"` never shown.
- Parity test `fr` vs `en` (versions and item counts).
- Release: a small script (`scripts/changelog-stamp.ts`, tested) does the rename; `release.yml` runs it and fails on an
  empty `"next"`.
- Server: `/api/status` carries `version`; settings accept and return `lastSeenVersion`.

## Out of scope

- Screenshots or links inside entries.
- Marking individual pages as new.
