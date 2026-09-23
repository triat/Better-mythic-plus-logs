-- addon/bmpl/cadence.lua
--
-- Decides WHEN the strip is repainted. Pure Lua, no WoW API and no state outside the table handed in,
-- so addon/bmpl/tests/cadence.lua can exercise it outside the game (bun test drives that harness
-- through luajit).
--
-- Why it exists: the strip used to cycle its chunks at 20 Hz forever, which is what makes a small
-- black-and-white patch so hard to ignore. Nothing needs that. The browser's RosterAssembler re-stamps
-- a roster's freshness on ANY frame of a rosterSeq it has already assembled (web/src/lib/live/roster.ts),
-- so once a roster has been transmitted a *motionless* strip keeps it alive just as well as a moving
-- one. So: cycle hard for a few passes after the roster changes, then stop repainting entirely, and
-- run one catch-up pass every HEARTBEAT_S for the browser that connected after the strip went still.

local ADDON_NAME, ns = ...

local Cadence = {}
ns.Cadence = Cadence

-- How many complete passes over the roster's chunks follow a change. One pass would be enough if
-- every frame reached the browser; three covers dropped frames, a scanner that is out of phase, and
-- the capture being paused for a moment. At 20 Hz a 4-chunk roster is 0.6 s of motion.
Cadence.PASSES_AFTER_CHANGE = 3
-- Seconds of stillness between catch-up passes. This is the worst case for a browser that connects
-- while the roster is unchanged: it sees the panel fill within this delay.
Cadence.HEARTBEAT_S = 5

function Cadence.new()
  return { remaining = 0, cursor = 0, since = 0 }
end

-- One tick. `dt` is the seconds since the previous call, `frameCount` the number of chunks the current
-- roster encodes to, `changed` true on the tick where the roster text became different.
-- Returns the 1-based chunk index to paint, or nil to leave the strip exactly as it is.
function Cadence.step(state, dt, frameCount, changed)
  if frameCount <= 0 then
    state.remaining, state.cursor, state.since = 0, 0, 0
    return nil
  end
  if changed then
    state.remaining = Cadence.PASSES_AFTER_CHANGE * frameCount
    state.cursor = 0
    state.since = 0
  end
  if state.remaining <= 0 then
    state.since = state.since + (dt or 0)
    if state.since < Cadence.HEARTBEAT_S then return nil end
    state.since = 0
    state.remaining = frameCount -- one catch-up pass, then still again
    state.cursor = 0
  end
  state.remaining = state.remaining - 1
  state.cursor = (state.cursor % frameCount) + 1
  return state.cursor
end
