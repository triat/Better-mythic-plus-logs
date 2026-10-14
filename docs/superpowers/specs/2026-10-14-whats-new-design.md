# What's new: the running version and a user-facing changelog — design

Status: draft 2026-10-14, awaiting the user's review. The visible parts go through the Claude Design canvas before any
code (decision 6).

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
6. **Display, to mock on the canvas first** (2–3 variants, the user picks; canvas https://claude.ai/artifact/2pSkoa1YtAww5AHhWepGw8, sources `docs/design/whats-new/`: A nav line + popover, B clickable version + page, C "updated" card + side panel):
   - the version, small and muted, at the bottom of the sidebar's account block (`v0.10.2`);
   - a "What's new" mark when `lastSeenVersion` is older than the running version (a dot on a sidebar line, or on the
     version itself);
   - a click opens the entries newer than `lastSeenVersion` (a popover or a `/whats-new` page, per the variant
     chosen), newest first, with "See all changes" for the full list; opening it writes `lastSeenVersion`.
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
