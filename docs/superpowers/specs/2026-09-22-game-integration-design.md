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
| What the site does with it | A **Live panel** listing the roster with the bmpl verdict when it is already cached (0 WCL points), and a **Check** button per row that runs the normal lookup. Plus an opt-in **auto-lookup** switch. |
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
party1..4            ┴→ encode → pixel strip ──capture @2 Hz──→ decode → roster ──→ cached verdicts (0 pts)
                        (Lua)                                    (pure TS)      ←──
                                                                 Live panel ──click──→ POST /api/lookup (existing)
```

Three units, one shared contract (the strip format):

- **Addon** (`addon/bmpl/`, Lua): reads applicants and party, draws the strip in the top-left corner,
  redraws on `LFG_LIST_APPLICANT_LIST_UPDATED` and `GROUP_ROSTER_UPDATE`. Receives nothing, stores
  nothing, sends nothing.
- **Front**: `web/src/lib/live/` — `decodeStrip` (pixels → frame), `assembleRoster` (frames → roster),
  `encodeStrip` (the TS reference encoder, used by the tests and by the golden vectors). One thin
  hook `useWowCapture` holds the two browser-API lines (`getDisplayMedia`, `drawImage`) and nothing else.
  One `LivePanel` component.
- **Server**: one new route, `POST /api/live/cached`, reading history only.

## The strip format (the interface)

Frozen and tested on both sides; a version byte allows a later change.

**Physical.** Cells of 6×6 *physical* pixels (the addon divides by `UIParent:GetEffectiveScale()`),
**black or white only** — 1 bit per cell. Luminance survives the browser's video pipeline (4:2:0
chroma subsampling) where colours would not. The strip sits at the very top-left of the game screen,
above everything (`FULLSCREEN_DIALOG` strata). The first three cells of the first row and of the
first column form the marker `■□■`, so the decoder locates the origin and the true cell size
whatever the resolution, window size or browser zoom. 16 rows × 320 columns on a 1920-wide window
≈ 640 bytes per frame.

**Logical.** Each frame carries: `magic "bmpl"` (4 B) · `version` (1 B) · `rosterSeq` (2 B) ·
`chunkIndex`/`chunkCount` (1 B each) · `length` (2 B) · `crc16` (2 B) · payload. The roster is
compact UTF-8 text, one line per player:

```
a|Biwaadrood-Nerzhul|Druid|Restoration|HEALER|3412
p|Tom-Hyjal|Warrior|Fury|DAMAGER|2890
```

(`a` = applicant, `p` = party member; the score is the declared Raider.IO score, `0` when unknown.)
Split across chunks when it does not fit in one frame. At 2 Hz a 20-applicant roster completes in
~1 s. An unchanged roster keeps its `rosterSeq` and the decoder does no work. A frame whose CRC
fails is dropped whole — partial data never reaches the UI.

**Realm names.** `C_LFGList.GetApplicantMemberInfo` returns a bare name for same-realm applicants;
the addon appends the player's own realm, exactly as the clipboard flow resolves it today
(`parseNameRealm` in `src/util.ts` expects `Name-Realm`).

**Windowed fullscreen is required.** Exclusive fullscreen is not capturable by `getDisplayMedia`.
No marker found for 5 s → an explicit message, never a silent failure.

## The UI

Mocked on the Claude Design canvas as 2 variants before implementation (`docs/agents/workflow.md`).

**Connecting.** A **Live** chip in the header. Off → click → a short dialog states what happens
("pick the World of Warcraft window; the image never leaves your browser, only the names read from
it are sent") → the browser's window picker → chip on, showing the number of players detected.
Closing the tab or revoking the share turns the chip grey with "reconnect".

**The Live panel.** A collapsible band under the header, shown while a roster is fresh (< 10 s):

- One row per player: class-tinted icon (existing tokens), name-realm, role, declared RIO score,
  then **either** the cached bmpl verdict (the history chip's pill plus its age, "vetted 12 min ago")
  **or** a **Check** button.
- Applicants first, party members under a quiet separator.
- A player who leaves the queue fades out after 5 s (no flicker on the game's own refreshes).
- Clicking a row runs the normal lookup in a new bmpl tab — the existing flow, unchanged.

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
| No marker for 5 s | "Switch WoW to windowed fullscreen — exclusive fullscreen cannot be captured." |
| > 50 % of frames fail CRC over 5 s | "Increase your UI scale or the window size so the strip stays readable." |
| Share stopped or tab lost the stream | Grey chip, "reconnect". |
| Browser without window capture | A clear message instead of a dead button. |
| Addon older than the strip version the site expects | A banner with the download link. |
| Quota or budget refusal while auto-lookup is on | The existing quota toast; the switch turns off. |

## Testing

- `web/src/lib/live/*.test.ts` — pure: `encodeStrip` → `decodeStrip` round-trip; noise; half-pixel
  offsets; 0.8× and 1.25× scaling; a corrupted chunk dropped; a truncated roster never surfacing;
  `assembleRoster` sequence handling (stale `rosterSeq` ignored, chunks out of order, a player
  leaving the queue).
- Golden vectors committed under `addon/bmpl/tests/vectors.txt` (roster → expected bit matrix),
  produced by the TS reference encoder. The addon ships a `/bmpl selftest` slash command that
  checks its own encoder against them in-game. The Lua side has no automated CI test — the plan
  carries an explicit manual in-game checklist (applicant appears, party member appears, `/reload`,
  UI scale change, windowed fullscreen toggle).
- `test/server-live.test.ts` — cached hit from own history, hit from another member's fresh entry,
  miss → `null`, cap of 40, unauthenticated refusal, and the 0-point assertion.
- `useWowCapture` is kept thin enough that its logic is the pure functions above; it is exercised by
  the manual checklist, not by a DOM test.

## Out of scope / later

Removing `bmpl watch`. CurseForge/Wago distribution. A native capture client. Auto-lookup for
members on the shared WCL client. Showing anything other than applicants and party.
