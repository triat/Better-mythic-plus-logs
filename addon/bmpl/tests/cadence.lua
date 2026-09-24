-- Exercises addon/bmpl/cadence.lua outside the game (pure Lua, no WoW API).
-- Usage: luajit addon/bmpl/tests/cadence.lua   (cwd = repo root)
-- Prints "OK <n>" and exits 0, or the first failed assertion and exits 1.

local ns = {}
assert(loadfile("addon/bmpl/cadence.lua"))("bmpl", ns)
local Cadence = assert(ns.Cadence, "cadence.lua did not publish ns.Cadence")

local checked = 0
local function check(cond, msg)
  if not cond then
    io.stderr:write("FAIL: " .. msg .. "\n")
    os.exit(1)
  end
  checked = checked + 1
end

local TICK = 0.05 -- the addon's 20 Hz tick

-- Collects the chunk indexes painted over `ticks` ticks; nil (no repaint) is recorded as 0.
local function run(state, ticks, frameCount, changedFirst)
  local out = {}
  for i = 1, ticks do
    out[i] = Cadence.step(state, TICK, frameCount, changedFirst and i == 1) or 0
  end
  return out
end

local function concat(t)
  local parts = {}
  for i = 1, #t do parts[i] = tostring(t[i]) end
  return table.concat(parts, ",")
end

local HOLD = Cadence.HOLD_TICKS

-- The paint record of `passes` passes over `frames` chunks: each chunk painted once, then held (0) for
-- HOLD - 1 ticks.
local function passes(n, frames)
  local out = {}
  for i = 0, n * frames - 1 do
    out[#out + 1] = i % frames + 1
    for _ = 2, HOLD do out[#out + 1] = 0 end
  end
  return out
end

-- 1. A change is followed by exactly PASSES_AFTER_CHANGE complete passes, in order, each chunk held
--    HOLD_TICKS, then silence.
do
  local state = Cadence.new()
  local frames = 4
  local busy = Cadence.PASSES_AFTER_CHANGE * frames * HOLD
  local painted = run(state, busy + 10, frames, true)
  local want = passes(Cadence.PASSES_AFTER_CHANGE, frames)
  for i = busy + 1, busy + 10 do want[i] = 0 end
  check(concat(painted) == concat(want), "after a change: got " .. concat(painted) .. ", want " .. concat(want))
end

-- 2. Once still, nothing is painted until HEARTBEAT_S has passed, and then exactly one full pass.
do
  local state = Cadence.new()
  local frames = 3
  run(state, Cadence.PASSES_AFTER_CHANGE * frames * HOLD, frames, true) -- burn the post-change passes
  -- Count the still ticks before the heartbeat fires. Summing 0.05 in floating point lands on either
  -- side of HEARTBEAT_S, so the expected count is checked with a one-tick tolerance rather than exactly.
  local silent = 0
  local first = nil
  for _ = 1, 400 do
    first = Cadence.step(state, TICK, frames, false)
    if first then break end
    silent = silent + 1
  end
  local want = Cadence.HEARTBEAT_S / TICK
  check(first == 1, "the heartbeat must start a pass at chunk 1, got " .. tostring(first))
  check(math.abs(silent - want) <= 1, silent .. " still ticks before the heartbeat, expected ~" .. want)
  local rest = {}
  for i = 1, frames * HOLD - 1 do rest[i] = Cadence.step(state, TICK, frames, false) or 0 end
  local pass = passes(1, frames)
  table.remove(pass, 1)
  check(concat(rest) == concat(pass), "rest of the heartbeat pass: got " .. concat(rest))
  check(Cadence.step(state, TICK, frames, false) == nil, "the heartbeat pass did not stop after one pass")
end

-- 3. A change during the still window restarts the cycling at once, from chunk 1 — even mid-hold.
do
  local state = Cadence.new()
  local frames = 2
  run(state, Cadence.PASSES_AFTER_CHANGE * frames * HOLD, frames, true)
  check(Cadence.step(state, TICK, frames, false) == nil, "expected stillness before the change")
  check(Cadence.step(state, TICK, frames, true) == 1, "a change must repaint chunk 1 on the same tick")
  check(Cadence.step(state, TICK, frames, true) == 1, "a change mid-hold must repaint at once too")
end

-- 4. No frames (roster empty / strip hidden): never paints, and the heartbeat does not build up.
do
  local state = Cadence.new()
  for i = 1, 400 do
    check(Cadence.step(state, TICK, 0, i == 1) == nil, "painted with no frames at tick " .. i)
  end
  check(state.since == 0, "the heartbeat timer ran while there was nothing to draw")
end

-- 5. A single-chunk roster parks too (the common case: the strip is then wholly motionless).
do
  local state = Cadence.new()
  local busy = Cadence.PASSES_AFTER_CHANGE * HOLD
  local painted = run(state, busy + 5, 1, true)
  local want = passes(Cadence.PASSES_AFTER_CHANGE, 1)
  for i = busy + 1, busy + 5 do want[i] = 0 end
  check(concat(painted) == concat(want), "single chunk: got " .. concat(painted))
end

-- 6. The bug HOLD_TICKS fixes: a browser that samples at 5 fps, at any phase against the game's
--    ticks, sees every chunk of ONE heartbeat pass. With one tick per chunk it saw only one in four.
do
  local frames = 4
  for phase = 0, 3 do
    local state = Cadence.new()
    run(state, Cadence.PASSES_AFTER_CHANGE * frames * HOLD, frames, true)
    local onScreen, seen, n, tick = nil, {}, 0, 0
    while n < frames and tick < 400 do
      tick = tick + 1
      onScreen = Cadence.step(state, TICK, frames, false) or onScreen
      -- 5 fps = one sample every 4 ticks, starting `phase` ticks in.
      if (tick + phase) % 4 == 0 and onScreen and not seen[onScreen] then
        seen[onScreen] = true
        n = n + 1
      end
    end
    check(n == frames, "phase " .. phase .. ": a 5 fps capture saw " .. n .. " of " .. frames .. " chunks")
  end
end

print("OK " .. checked)
