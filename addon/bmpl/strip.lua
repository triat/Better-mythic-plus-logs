-- addon/bmpl/strip.lua
--
-- Owns the 24x10 grid of black/white textures the browser scanner reads. One frame at the
-- FULLSCREEN_DIALOG strata, anchored TOPLEFT of UIParent; the frame is counter-scaled by
-- `1 / UIParent:GetEffectiveScale()` so a texture sized to STRIP.cell logical units always renders as
-- STRIP.cell *physical* pixels, whatever the player's UI scale or window resolution — see
-- Strip.Rescale() below. Never touches the network; only ever draws.

local ADDON_NAME, ns = ...
local Encode = ns.Encode
local STRIP = Encode.STRIP

local Strip = {}
ns.Strip = Strip

-- Physical pixels per cell. The browser derives the real cell size from the marker's run lengths, so
-- this is the addon's choice alone: smaller means a less intrusive strip, larger means a more robust
-- read. 3 is the default (72x30 px on screen); /bmpl cell <n> changes it for the session.
local cellPx = 3
local MIN_CELL, MAX_CELL = 3, 10

local frame = CreateFrame("Frame", "BmplStripFrame", UIParent)
frame:SetFrameStrata("FULLSCREEN_DIALOG")
frame:SetToplevel(true)
frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
frame:SetSize(STRIP.cols * cellPx, STRIP.rows * cellPx)
frame:Hide()

-- One Texture per cell, black by default; indexed the same way Encode.cellIndex()/encodeCells()
-- index the bit matrix, so Strip.Paint(cells) can read cells[i] straight into textures[i].
local textures = {}
for y = 0, STRIP.rows - 1 do
  for x = 0, STRIP.cols - 1 do
    local tex = frame:CreateTexture(nil, "OVERLAY")
    tex:SetSize(cellPx, cellPx)
    tex:SetPoint("TOPLEFT", frame, "TOPLEFT", x * cellPx, -(y * cellPx))
    tex:SetColorTexture(0, 0, 0, 1)
    textures[Encode.cellIndex(x, y)] = tex
  end
end

-- Recompute the counter-scale. Call once at load and again whenever the effective scale can have
-- changed: UI_SCALE_CHANGED, DISPLAY_SIZE_CHANGED (window/resolution toggles), or on demand from
-- /bmpl show.
function Strip.Rescale()
  local scale = UIParent:GetEffectiveScale()
  if scale and scale > 0 then
    frame:SetScale(1 / scale)
  end
end

-- Resize every cell in place. Returns the size actually applied, or nil when `n` is out of range.
function Strip.SetCell(n)
  n = tonumber(n)
  if not n then return nil end
  n = math.floor(n)
  if n < MIN_CELL or n > MAX_CELL then return nil end
  cellPx = n
  frame:SetSize(STRIP.cols * cellPx, STRIP.rows * cellPx)
  for y = 0, STRIP.rows - 1 do
    for x = 0, STRIP.cols - 1 do
      local tex = textures[Encode.cellIndex(x, y)]
      tex:SetSize(cellPx, cellPx)
      tex:ClearAllPoints()
      tex:SetPoint("TOPLEFT", frame, "TOPLEFT", x * cellPx, -(y * cellPx))
    end
  end
  return cellPx
end

function Strip.Cell()
  return cellPx
end

function Strip.Show()
  frame:Show()
end

function Strip.Hide()
  frame:Hide()
end

function Strip.IsShown()
  return frame:IsShown() and true or false
end

-- `cells`: the flat 24x10 table Encode.encodeCells() returns (1 = white, 0/nil = black).
function Strip.Paint(cells)
  for i = 1, STRIP.cols * STRIP.rows do
    local tex = textures[i]
    if cells[i] == 1 then
      tex:SetColorTexture(1, 1, 1, 1)
    else
      tex:SetColorTexture(0, 0, 0, 1)
    end
  end
end

Strip.Rescale()
