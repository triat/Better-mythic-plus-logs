# bmpl — the in-game addon

A small World of Warcraft addon that draws a 24×10 grid of grey pixels in the corner of the screen,
top-left, only while the Group Finder is in play — and leaves it **motionless** as soon as your roster
stops changing. bmpl's web UI reads that strip through a screen share (`getDisplayMedia`) and turns it
into a live view of your Group Finder applicants and party — class, role, current score — with no
addon-side network code at all.

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
- It carries your current roster: yourself, your party, and the Group Finder's pending applicants
  (oldest first). An application that is withdrawn, declined or timed out leaves the strip
  immediately — only live applications are drawn.
- **It only moves when your roster changes.** A change is transmitted over 3 quick passes (20 frames a
  second, so a fraction of a second), then the strip goes completely still until the next change; it
  wakes for one pass every 5 seconds so a browser that connects mid-queue still fills up. That wake-up
  costs one frame per chunk out of every 100, so the strip is still ~96 % of the time with a party of
  two, ~91 % with five applicants, and ~66 % with a full 20-applicant queue — the bigger the roster,
  the more there is to send.
- **It is drawn in two greys, not black and white** (`/bmpl contrast full` switches back). The browser
  measures the strip's own levels instead of assuming any, so a faint patch reads exactly as well as a
  stark one — as long as the two greys survive the capture 45 luma apart.
- The strip is **72 × 30 pixels** (24 × 10 cells of 3 px). `/bmpl cell <3-10>` resizes it for the
  session (it resets on `/reload`) — the browser derives the cell size from the strip itself, so
  nothing needs reconfiguring on that side; below 3 px the capture stops resolving the cells reliably.
  If the web UI says "Increase your UI scale or the window size", `/bmpl cell 4` is the quicker cure:
  3 px leaves no headroom if your capture is being rescaled anywhere along the way.
- `/bmpl show` forces the strip on regardless of the Group Finder state, for lining things up or
  troubleshooting. `/bmpl hide` releases that override back to the automatic rule above.
- `/bmpl contrast full` paints black and white instead of the two greys, for the session — the thing
  to try first if the browser sees no strip at all. `/bmpl contrast dim` goes back.
- `/bmpl dump` prints what the Group Finder API actually returns for each pending application, and
  the exact roster text the strip carries — the first thing to run when someone is missing from the
  panel or will not go away.
- `/bmpl selftest` re-encodes three known rosters and checks, byte for byte, both the frames and the
  24x10 cell matrix against the same golden vectors the bmpl repo's own test suite checks (`bun test`
  verifies both that the copy built into the addon matches `addon/bmpl/tests/vectors.txt` and, where
  `luajit` is installed, that `encode.lua` itself still encodes them) — prints `OK`, or the first
  mismatch.

## Connecting the browser

In bmpl's web UI, use the **Live** chip in the header to share this game window (Chrome, Edge or
Firefox on desktop — any browser that can share a single window). The browser never uploads the image
itself, only the player names it reads off the strip, to check against evaluations bmpl already has.
Full guide, including what "windowed fullscreen" means and why it's needed: `/help#live-addon` on your
bmpl instance.

## Known limits

- Classes are read from a locale-independent game API and sent as Warcraft Logs' own class index
  (not WoW's), so they always match regardless of your client's language. Spec is not carried at all:
  the panel never showed it, and Blizzard's Group Finder does not expose an applicant's exact talent
  spec before you invite them anyway.
