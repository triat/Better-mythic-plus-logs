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

-- 1. A change is followed by exactly PASSES_AFTER_CHANGE complete passes, in order, then silence.
do
  local state = Cadence.new()
  local frames = 4
  local painted = run(state, 20, frames, true)
  local want = {}
  for i = 1, Cadence.PASSES_AFTER_CHANGE * frames do want[i] = (i - 1) % frames + 1 end
  for i = Cadence.PASSES_AFTER_CHANGE * frames + 1, 20 do want[i] = 0 end
  check(concat(painted) == concat(want), "after a change: got " .. concat(painted) .. ", want " .. concat(want))
end

-- 2. Once still, nothing is painted until HEARTBEAT_S has passed, and then exactly one full pass.
do
  local state = Cadence.new()
  local frames = 3
  run(state, Cadence.PASSES_AFTER_CHANGE * frames, frames, true) -- burn the post-change passes
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
  for i = 1, frames - 1 do rest[i] = Cadence.step(state, TICK, frames, false) end
  check(concat(rest) == "2,3", "rest of the heartbeat pass: got " .. concat(rest))
  check(Cadence.step(state, TICK, frames, false) == nil, "the heartbeat pass did not stop after one pass")
end

-- 3. A change during the still window restarts the cycling at once, from chunk 1.
do
  local state = Cadence.new()
  local frames = 2
  run(state, Cadence.PASSES_AFTER_CHANGE * frames, frames, true)
  check(Cadence.step(state, TICK, frames, false) == nil, "expected stillness before the change")
  check(Cadence.step(state, TICK, frames, true) == 1, "a change must repaint chunk 1 on the same tick")
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
  local painted = run(state, 10, 1, true)
  local want = {}
  for i = 1, Cadence.PASSES_AFTER_CHANGE do want[i] = 1 end
  for i = Cadence.PASSES_AFTER_CHANGE + 1, 10 do want[i] = 0 end
  check(concat(painted) == concat(want), "single chunk: got " .. concat(painted))
end

print("OK " .. checked)
