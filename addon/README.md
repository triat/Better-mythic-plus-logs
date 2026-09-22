# bmpl — the in-game addon

A small World of Warcraft addon that draws a 40×16 grid of black-and-white pixels in the corner of
the screen, top-left, only while the Group Finder is in play. bmpl's web UI reads that strip through a
screen share (`getDisplayMedia`) and turns it into a live view of your Group Finder applicants and
party — class, role, current score — with no addon-side network code at all.

**The addon sends nothing, receives nothing, and stores nothing.** It draws pixels; that's the whole
addon. No SavedVariables, no `/dump`-able state, no outbound requests of any kind — everything bmpl
knows about your roster comes from reading the pixels your own browser can already see on your own
screen.

## Install

1. Build `bmpl-addon.zip` from this repo with `just addon-zip` (it lands in `dist/`) and unzip it —
   no release carries the zip yet. Copying `addon/bmpl/` out of a checkout works just as well.
2. Copy the `bmpl` folder into your WoW installation's `Interface/AddOns/` directory, e.g.
   `World of Warcraft/_retail_/Interface/AddOns/bmpl`.
3. `/reload` or restart the game, and make sure **bmpl** is ticked on the AddOns list at the character
   select screen.
4. `bmpl.toc`'s `## Interface` line is `120100`. If a later patch marks the addon out of date, either
   set that line to what `/dump select(4, GetBuildInfo())` prints in your client, or tick "Load out of
   date AddOns" in AddOns → Options — the addon draws pixels and reads a handful of long-stable roster
   APIs, so it does not break across a version bump.

## What it does

- Open the Group Finder (or have an active Group Finder posting) — the strip appears, top-left, at
  `FULLSCREEN_DIALOG` strata (above most UI, so a full-screen panel doesn't hide it).
- Close the Group Finder with no active posting — the strip disappears. It **never** draws during a
  run.
- It redraws 10 times a second with your current roster: yourself, your party, and the Group Finder's
  pending applicants (oldest first). An application that is withdrawn, declined or timed out leaves
  the strip immediately — only live applications are drawn.
- The strip is **160 × 64 pixels** (40 × 16 cells of 4 px). `/bmpl cell <3-10>` resizes it for the
  session — the browser derives the cell size from the strip itself, so nothing needs reconfiguring
  on that side; below 3 px the capture stops resolving the cells reliably.
- `/bmpl show` forces the strip on regardless of the Group Finder state, for lining things up or
  troubleshooting. `/bmpl hide` releases that override back to the automatic rule above.
- `/bmpl dump` prints what the Group Finder API actually returns for each pending application, and
  the exact roster text the strip carries — the first thing to run when someone is missing from the
  panel or will not go away.
- `/bmpl selftest` re-encodes three known rosters and checks, byte for byte, both the frames and the
  40x16 cell matrix against the same golden vectors the bmpl repo's own test suite checks (`bun test`
  also verifies that the copy built into the addon still matches `addon/bmpl/tests/vectors.txt`) —
  prints `OK`, or the first mismatch.

## Connecting the browser

In bmpl's web UI, use the **Live** chip in the header to share this game window (Chrome, Edge or
Firefox on desktop — any browser that can share a single window). The browser never uploads the image
itself, only the player names it reads off the strip, to check against evaluations bmpl already has.
Full guide, including what "windowed fullscreen" means and why it's needed: `/help#live-addon` on your
bmpl instance.

## Known limits

- Class names are read from a locale-independent game API and always match Warcraft Logs' naming.
  Spec names are read from the game's own (English) display strings — a non-English client will not
  match.
- Blizzard's Group Finder applicant API does not expose an applicant's exact talent spec before you
  invite them (only their class and role). Where the exact spec isn't available — an applicant, or a
  party member before their inspect completes — the addon shows a reasonable default for that class
  and role rather than leaving the row blank; your party's real specs appear a moment after you group
  up, once the client's own inspect finishes.
