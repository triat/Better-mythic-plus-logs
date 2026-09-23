# Game ↔ site integration — design

Status: approved design, 2026-09-22 (brainstorm in chat). Not implemented yet.

## Why

Vetting an applicant today means copying their name in-game and letting the local clipboard
watcher fire (`bmpl watch`, `src/clipboard.ts` + `src/server/watcher.ts`). That flow is local-mode
only, needs a copy per applicant, and polls the whole system clipboard — everything the user copies
is read by bmpl. Members of bmpl.riat.dev have nothing at all: they type names by hand while the
Group Finder queue fills up.

The goal: a leader recruiting in the Group Finder sees, without typing or copying anything, who is
applying and what bmpl already knows about them — and can vet any of them in one click.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Who is it for | Hosted members first, but nothing in it is hosted-specific: the feature ships in **both modes**. Local mode keeps `bmpl watch` for now; removing the clipboard watcher is a separate, later decision by the user. |
| How data leaves the game | A **pixel strip** drawn by a bmpl addon and read from the browser's screen capture of the WoW window. An addon cannot do network I/O, cannot write a file on demand (SavedVariables are flushed on `/reload` or logout only) and cannot write the clipboard; the screen is the only real-time output channel. This is the technique Archon-style overlays use. |
| Who captures | **The browser**, via `getDisplayMedia` on the WoW window. No desktop client to build, sign, distribute or update. The strip format is the interface, so a native client could replace the capture later without touching the addon or the site. |
| What the addon exposes | Group Finder applicants **and the current party** — name-realm, class, spec, role, declared Raider.IO score. Nothing else (no target, no mouseover). |
| When the strip is drawn | **Only while the Group Finder is in play**: the Group Finder window is open, or the player has an active listing (`C_LFGList.GetActiveEntryInfo()`). Hidden the rest of the time, so the checkerboard never sits on screen during a run. |
| What the site does with it | A **Live panel** listing the roster with the bmpl verdict when it is already cached (0 WCL points), and a **Check** button per row that runs the normal lookup. Plus an opt-in **auto-lookup** switch. Canvas variant **A** (full-width band with columns), chosen 2026-09-22. |
| Sorting and filtering | A recruiting queue can hold 15+ applicants, so the band's head row carries **role toggles** (Tank / Heal / DPS), a **sort menu** (arrival · verdict · Raider.IO score · role · class) and a **class filter**. They apply to applicants only, never to the party, and the count reads "showing 3 of 14". The choices are remembered per user like the region. |
| Who may auto-lookup | Members with their own WCL client (hosted) and local mode. Everyone else sees the switch disabled with a link to the own-client guide. No quota carve-out, no per-hour cap to maintain. |

## Non-goals

Sending anything *into* the game (bmpl never talks to WoW). Reading combat data live. Replacing
`bmpl watch` in this iteration. Auto-inviting or auto-declining applicants. A desktop client.
Publishing the addon on CurseForge/Wago (a later, purely distributive step).

## Architecture

```
WoW (addon "bmpl")                 browser tab (bmpl site)                     server
──────────────────                 ───────────────────────                     ──────
C_LFGList applicants ┐             getDisplayMedia(WoW window)                 POST /api/live/cached
party1..4            ┴→ encode → pixel strip ──capture @20 Hz─→ decode → roster ──→ cached verdicts (0 pts)
                        (Lua)                                    (pure TS)      ←──
                                                                 Live panel ──click──→ POST /api/lookup (existing)
```

Three units, one shared contract (the strip format):

- **Addon** (`addon/bmpl/`, Lua): reads applicants and party, draws the strip in the top-left corner,
  redraws on `LFG_LIST_APPLICANT_LIST_UPDATED` and `GROUP_ROSTER_UPDATE`, and shows or hides it on
  the visibility rule below. Receives nothing, stores nothing, sends nothing.
- **Front**: `web/src/lib/live/` — `decodeStrip` (pixels → frame), `assembleRoster` (frames → roster),
  `encodeStrip` (the TS reference encoder, used by the tests and by the golden vectors). One thin
  hook `useWowCapture` holds the two browser-API lines (`getDisplayMedia`, `drawImage`) and nothing else.
  One `LivePanel` component.
- **Server**: one new route, `POST /api/live/cached`, reading history only.

## The strip format (the interface)

Frozen and tested on both sides; a version byte allows a later change.

**When it is on screen.** The strip is shown only while the Group Finder is open (`PVEFrame` /
`LFGListFrame` visible) **or** the player has an active listing — the two states in which applicants
can exist. It hides on every other screen, including during a run, so the checkerboard is never in
the way. `/bmpl show` forces it on for troubleshooting (until `/reload` or `/bmpl hide`).

**Physical.** A grid of **24 columns × 10 rows** of square *physical* pixels (the addon divides by
`UIParent:GetEffectiveScale()`) — **3 px per cell by default, 72 × 30 px** in the very top-left
corner, above everything (`FULLSCREEN_DIALOG` strata). The cell size is the addon's choice alone
(`/bmpl cell 3`–`10` for the session): the decoder derives it from the marker's run lengths, so
nothing in the browser changes when it moves. Cells carry 1 bit each, as **two greys**, never colour:
luminance survives the browser's video pipeline (4:2:0 chroma subsampling) where colours would not.
The two levels are the addon's choice — `dim`, the default, paints 0.10 and 0.45 of white (≈ 26 and
≈ 115 luma) so the strip reads as a faint grey patch; `/bmpl contrast full` restores black and white.
The decoder never assumes a level: it finds the marker on *local* contrast and then reads the cells
against the midpoint measured on that strip's own marker. The one requirement is that the two levels
stay **45 luma apart** (`MIN_AMPLITUDE`) once captured; below that the scanner declines the strip
rather than returning cells it cannot trust. The other standing requirement is that the capture be
**pixel-exact**: a half-pixel offset or a fractional rescale (×0.9, ×1.25) smears every cell boundary
into the dead zone around the local midpoint and no marker is found at all — which is what the
"windowed fullscreen, no browser zoom" instruction in the connect dialog is really protecting.
Row 0 and column 0 are the marker: alternating light/dark starting light, cell (0,0) light. The
remaining 23 × 9 = 207 cells carry 25 bytes per frame, MSB first, row-major. At 3 px a cell is
sampled at its centre pixel alone — the 3 × 3 average only applies from 5 px up, where it helps.

**Rate.** The browser samples the video at **20 Hz**, and the addon cycles its chunks at the same
rate — but only while there is something new to say. One frame carries 18 payload bytes, so a
20-applicant roster (~600 B, 34 chunks) completes in about 1.7 s; a 5-applicant roster in under half
a second.

**Cadence (`addon/bmpl/cadence.lua`).** A roster change starts **3 complete passes** over its chunks,
after which the addon **stops repainting altogether** and the strip stands still. This is what makes
it tolerable to look at: a motionless patch is far easier to ignore than a flickering one, and the
browser loses nothing — `RosterAssembler.push` re-stamps a roster's freshness on any frame of a
`rosterSeq` it has already assembled, so the single frame left on screen keeps the panel alive
indefinitely. One catch-up pass every **5 s** (`HEARTBEAT_S`) covers the browser that connects while
the strip is still.

The duty cycle is therefore one pass per 100 ticks, i.e. **as many percent as the roster has chunks**:
4 % for a party of two (58 B, 4 chunks), ~9 % for five applicants (~150 B, 9 chunks), 34 % for the
20-applicant queue above. Small rosters — the common case — are almost always still; a full queue is
not, and that is the price of getting 600 B across at 18 B a frame.

The 5 s is the worst-case delay before a late-connecting browser fills **only if no capture frame is
lost**. A chunk missed during a catch-up pass waits for the next one, so a 15 fps video track against
the 20 Hz painter roughly doubles it. While that is pending, a roster that changed shows nothing: the
previous roster stops being re-stamped as soon as the sequence number moves, and `ROSTER_STALE_MS`
(10 s) then empties the panel.

**Logical.** A 72 × 30 px strip cannot afford a 12-byte header, so the frame header is **7 bytes**:
`magic|version` (1 B — high nibble `0xB`, low nibble the format version, currently `2`) ·
`rosterSeq` (1 B, wraps at 256) · `chunkIndex` (1 B) · `chunkCount` (1 B) · `length` (1 B) ·
`crc16` (2 B, little-endian, CRC-16/CCITT-FALSE over the 5 header bytes before it followed by the
payload). Payload ≤ **18 bytes**; a frame is exactly `7 + payload length` bytes, never padded. The
roster is compact UTF-8 text, one line per player:

```
a|Biwaadrood-Nerzhul|3|H|3412
p|Tom-Hyjal|11|D|2890
```

(`a` = applicant, `p` = party member, `s` = the player themself — `s` behaves as a party member
everywhere and is the only row the panel labels "you"; the third field is the **class index** into
the shared list in `src/wow/classes.ts` — the one module `web/` may import at runtime — not a class
name; role is `T` / `H` / `D`; the score is the declared Raider.IO score, `0` when unknown;
applicants are listed in arrival order, oldest first.) **The spec is not carried**: the panel never
showed it, and for a DPS applicant the Group Finder does not expose it before an invite, so it was
a guess costing a fifth of the payload. The text is split
across as many chunks as needed. An unchanged roster keeps its `rosterSeq` and the decoder does no
work. A frame whose CRC fails is dropped whole — partial data never reaches the UI.

**Realm names.** `C_LFGList.GetApplicantMemberInfo` returns a bare name for same-realm applicants;
the addon appends the player's own realm, exactly as the clipboard flow resolves it today
(`parseNameRealm` in `src/util.ts` expects `Name-Realm`).

**Windowed fullscreen is required.** Exclusive fullscreen is not capturable by `getDisplayMedia`.
No marker found for 5 s → an explicit message, never a silent failure.

## The UI

Mocked on the Claude Design canvas as 2 variants before implementation (`docs/agents/workflow.md`).

**Connecting.** A **Live** chip in the header. The capture keeps running while the strip is hidden
in game: the chip then reads "waiting for the Group Finder" and the panel keeps the last roster for
10 s before collapsing to that same line. Off → click → a short dialog states what happens
("pick the World of Warcraft window; the image never leaves your browser, only the names read from
it are sent") → the browser's window picker → chip on, showing the number of players detected.
Closing the tab or revoking the share turns the chip grey with "reconnect".

**The Live panel.** A collapsible band under the header (canvas variant A), shown while a roster is fresh (< 10 s). Its head row holds the title, the count ("showing 3 of 14 · updated 1 s ago"), the role toggles, the sort menu, the class filter and the auto-lookup switch:

- One row per player: class-tinted icon (existing tokens), name-realm, role, declared RIO score,
  then **either** the cached bmpl verdict (the history chip's pill plus its age, "vetted 12 min ago")
  **or** a **Check** button.
- Applicants first, party members under a quiet separator.
- A player who leaves the queue fades out after 5 s (no flicker on the game's own refreshes).
- Clicking a row runs the normal lookup in a new bmpl tab — the existing flow, unchanged.

**Sorting and filtering.** Pure functions over the decoded roster, in `web/src/lib/live/roster.ts`:

- `sortApplicants(list, key)` with `key` in `arrival | verdict | score | role | class`. **Arrival is the default** (newest applicant first — the queue is a stream). `verdict` orders INVITE → MAYBE → PASS → INSUFFICIENT (a lookup that ran but found too little data) → not vetted, breaking ties on the cached score then on arrival; `score` uses the declared Raider.IO score descending; `role` uses Tank → Heal → DPS then arrival; `class` is alphabetical on the WCL class name then arrival. Sorting never reorders the party block.
- `filterApplicants(list, { roles, classes })` — `roles` is a subset of the three roles (empty = none shown, all three = the default), `classes` a set of class names (empty = every class). The party block ignores both.
- Both are remembered per user the way the region is (`Settings.liveSort`, `Settings.liveRoles`, `Settings.liveClasses`; `localStorage` locally, `user_settings` hosted) so a reconnect does not reset the view.
- The count line always states the filtered total against the real one ("showing 3 of 14"), so a filter can never silently hide an applicant.

**Auto-lookup.** A switch in the panel, "evaluate new applicants automatically". Enabled only with
an own WCL client (hosted) or in local mode; otherwise disabled with a link to the own-client guide
(`/help#wcl-client`). When on, each new uncached name is queued, **one lookup at a time**, with a
"3 queued" counter, and the switch turns itself off on the first quota/budget refusal (the existing
message and toast).

## Server

`POST /api/live/cached` — the only new route.

- Body: `{ players: [{ name, realm, region? }] }`, **40 entries max** (beyond that: 400).
- Response: `[{ key, verdict, targetLevel, fetchedAt } | null]`, index-aligned with the request.
- Reads the caller's history plus another member's entry younger than `SHARED_HISTORY_TTL_MS`
  (6 h, `src/hosted/history.ts`) — the rule that already makes a second member's lookup free.
- **Never calls WCL**: 0 points, pinned by a test that fails on any `gql` call.
- Authenticated like every other hosted route; available in local mode too.
- Roster names are **not logged and never written to an audit row**: they exist for the duration of
  the request.

Auto-lookup has no route of its own: it calls `POST /api/lookup`, so the quota gate, the meter and
`usage_hourly` apply unchanged.

## Security and privacy

- The captured image never leaves the browser; only decoded names are sent.
- The capture permission is per session and revocable from the browser's own UI.
- `Permissions-Policy` gains `display-capture=(self)` next to the current `clipboard-read=()`
  (`src/server/security.ts`), so capture is only ever initiated by our own page.
- What transits are public character names — the same data the user types today.
- The addon reads public APIs only, writes nothing, communicates with nothing: no grey area with
  Blizzard's add-on policy.

## Error handling

| Situation | What the user sees |
|---|---|
| No marker for 5 s, Group Finder open | "Switch WoW to windowed fullscreen — exclusive fullscreen cannot be captured." |
| No marker, nothing else wrong | "Waiting for the Group Finder — the strip only shows while you are listed or browsing." (Not an error: the normal idle state.) |
| > 50 % of frames fail CRC over 5 s | "Increase your UI scale or the window size so the strip stays readable." |
| Share stopped or tab lost the stream | Grey chip, "reconnect". |
| Browser without window capture | A clear message instead of a dead button. |
| Addon older than the strip version the site expects | A banner with the download link. |
| Quota or budget refusal while auto-lookup is on | The existing quota toast; the switch turns off. |

## Testing

- `web/src/lib/live/roster.test.ts` — every sort key (including tie-breaks and the party block staying put), both filters, the empty-role case, and the "showing N of M" line.
- `web/src/lib/live/*.test.ts` — pure: `encodeStrip` → `decodeStrip` round-trip; noise; half-pixel
  offsets; 0.8× and 1.25× scaling; a corrupted chunk dropped; a truncated roster never surfacing;
  `assembleRoster` sequence handling (stale `rosterSeq` ignored, chunks out of order, a player
  leaving the queue, and the strip disappearing → the roster goes stale after 10 s rather than
  reporting an error).
- Golden vectors committed under `addon/bmpl/tests/vectors.txt` (roster → expected bit matrix),
  produced by the TS reference encoder. The addon ships a `/bmpl selftest` slash command that
  checks its own encoder against them in-game. The Lua side has no automated CI test — the plan
  carries an explicit manual in-game checklist (strip appears when the Group Finder opens and hides
  when it closes, applicant appears, party member appears, `/reload`, UI scale change, windowed
  fullscreen toggle, `/bmpl show`).
- `test/server-live.test.ts` — cached hit from own history, hit from another member's fresh entry,
  miss → `null`, cap of 40, unauthenticated refusal, and the 0-point assertion.
- `useWowCapture` is kept thin enough that its logic is the pure functions above; it is exercised by
  the manual checklist, not by a DOM test.

## Out of scope / later

Removing `bmpl watch`. CurseForge/Wago distribution. A native capture client. Auto-lookup for
members on the shared WCL client. Showing anything other than applicants and party.
