-- Runs addon/bmpl/encode.lua against addon/bmpl/tests/vectors.txt outside the game, so a Lua-side
-- drift fails `bun test` instead of waiting for someone to type /bmpl selftest in game.
-- Usage: luajit addon/bmpl/tests/harness.lua   (cwd = repo root)
-- Prints "OK <n>" and exits 0, or the first mismatch and exits 1. Loads encode.lua exactly the way
-- WoW does (`local ADDON_NAME, ns = ...`) with a bare namespace table — encode.lua is pure Lua and
-- touches no WoW API, which is what makes this possible.

local ns = {}
local chunk = assert(loadfile("addon/bmpl/encode.lua"))
chunk("bmpl", ns)
local Encode = assert(ns.Encode, "encode.lua did not publish ns.Encode")

local function fail(msg)
  io.stderr:write(msg .. "\n")
  os.exit(1)
end

local function split(line)
  local fields = {}
  for field in (line .. "\t"):gmatch("([^\t]*)\t") do fields[#fields + 1] = field end
  return fields
end

local checked = 0
local file = assert(io.open("addon/bmpl/tests/vectors.txt", "r"), "vectors.txt not found (cwd must be the repo root)")
for line in file:lines() do
  if line ~= "" and line:sub(1, 1) ~= "#" then
    local f = split(line)
    local kind = f[1]
    if kind == "frame" then
      local text = f[2]:gsub("\\n", "\n")
      local frames = Encode.chunkRoster(text, tonumber(f[3]))
      local expected = #f - 3
      if #frames ~= expected then
        fail(string.format("rosterSeq %s: %d frames, expected %d", f[3], #frames, expected))
      end
      for i = 1, #frames do
        local got = Encode.toHex(Encode.encodeFrame(frames[i]))
        if got ~= f[3 + i] then
          fail(string.format("rosterSeq %s chunk %d: %s, expected %s", f[3], i - 1, got, f[3 + i]))
        end
        checked = checked + 1
      end
    elseif kind == "cells" then
      -- A `cells` record carries no roster text, only a rosterSeq: re-derive the roster from the
      -- matching `frame` record (always earlier in the file).
      local seq, chunkIndex, expected = f[2], tonumber(f[3]), f[4]
      local text
      for l in io.lines("addon/bmpl/tests/vectors.txt") do
        local g = split(l)
        if g[1] == "frame" and g[3] == seq then text = g[2]:gsub("\\n", "\n") end
      end
      if not text then fail("no frame record for rosterSeq " .. seq) end
      local frames = Encode.chunkRoster(text, tonumber(seq))
      local got = Encode.cellsToHex(Encode.encodeCells(frames[chunkIndex + 1]))
      if got ~= expected then
        fail(string.format("rosterSeq %s cells: %s, expected %s", seq, got, expected))
      end
      checked = checked + 1
    else
      fail("unknown vectors.txt record: " .. tostring(kind))
    end
  end
end
file:close()

print("OK " .. checked)
