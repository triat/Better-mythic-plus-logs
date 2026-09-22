-- addon/bmpl/strip.lua
--
-- Owns the 40x16 grid of black/white textures the browser scanner reads. One frame at the
-- FULLSCREEN_DIALOG strata, anchored TOPLEFT of UIParent; the frame is counter-scaled by
-- `1 / UIParent:GetEffectiveScale()` so a texture sized to STRIP.cell logical units always renders as
-- STRIP.cell *physical* pixels, whatever the player's UI scale or window resolution — see
-- Strip.Rescale() below. Never touches the network; only ever draws.

local ADDON_NAME, ns = ...
local Encode = ns.Encode
local STRIP = Encode.STRIP

local Strip = {}
ns.Strip = Strip

local frame = CreateFrame("Frame", "BmplStripFrame", UIParent)
frame:SetFrameStrata("FULLSCREEN_DIALOG")
frame:SetToplevel(true)
frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
frame:SetSize(STRIP.cols * STRIP.cell, STRIP.rows * STRIP.cell)
frame:Hide()

-- One Texture per cell, black by default; indexed the same way Encode.cellIndex()/encodeCells()
-- index the bit matrix, so Strip.Paint(cells) can read cells[i] straight into textures[i].
local textures = {}
for y = 0, STRIP.rows - 1 do
  for x = 0, STRIP.cols - 1 do
    local tex = frame:CreateTexture(nil, "OVERLAY")
    tex:SetSize(STRIP.cell, STRIP.cell)
    tex:SetPoint("TOPLEFT", frame, "TOPLEFT", x * STRIP.cell, -(y * STRIP.cell))
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

function Strip.Show()
  frame:Show()
end

function Strip.Hide()
  frame:Hide()
end

function Strip.IsShown()
  return frame:IsShown() and true or false
end

-- `cells`: the flat 40x16 table Encode.encodeCells() returns (1 = white, 0/nil = black).
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
