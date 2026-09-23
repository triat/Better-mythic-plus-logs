-- addon/bmpl/roster.lua
--
-- Builds the roster text line (kind|Name-Realm|classIndex|Role|score) the browser's
-- web/src/lib/live/roster.ts parses, for the player themself ("s"), the player's party ("p") and the
-- current Group Finder applicants ("a"). Reads only; never writes SavedVariables, never talks to the
-- network — the addon "sends nothing, receives nothing, stores nothing" per addon/README.md.
--
-- v2 drops the spec field entirely (the panel never showed it, and the Group Finder does not expose
-- an applicant's exact spec before you invite them anyway, so it was a guess costing a fifth of the
-- payload). The class field is now the addon's own **class index** — Warcraft Logs' numbering
-- (src/wow/classes.ts), not WoW's own UnitClass()/GetClassInfo() ordering — so every line carries a
-- number, never a class name.
--
-- KNOWN LIMITATIONS (read before trusting a roster line in game — see the manual checklist):
--   * The exact return signature of C_LFGList.GetApplicantInfo/GetApplicantMemberInfo used below is
--     transcribed from Blizzard's public Lua API documentation and has not been exercised against a
--     live client by this change (this repo's tests never touch WoW — see AGENTS.md). Every call into
--     it is pcall-guarded, so a signature drift drops that one applicant rather than breaking the
--     addon; if applicants stop appearing at all, that is the first thing to check.

local ADDON_NAME, ns = ...

local Roster = {}
ns.Roster = Roster

-- Blizzard's class file token (locale-independent, e.g. "DEATHKNIGHT") -> Warcraft Logs' class index
-- (CLASS_NAMES in src/wow/classes.ts, the source of truth, pinned by test/live-vectors.test.ts — NOT
-- UnitClass()'s own numeric id, which numbers Warrior 1 and Death Knight 6). An unknown token drops
-- the line rather than guessing.
local CLASS_TOKEN_TO_INDEX = {
  DEATHKNIGHT = 1,
  DRUID = 2,
  HUNTER = 3,
  MAGE = 4,
  MONK = 5,
  PALADIN = 6,
  PRIEST = 7,
  ROGUE = 8,
  SHAMAN = 9,
  WARLOCK = 10,
  WARRIOR = 11,
  DEMONHUNTER = 12,
  EVOKER = 13,
}

local ROLE_TOKEN_TO_CODE = { TANK = "T", HEALER = "H", DAMAGER = "D" }

-- The player's own realm, appended whenever the game gives us a bare name (same-realm applicants and
-- party members usually come back that way).
local function ownRealm()
  local realm = GetNormalizedRealmName and GetNormalizedRealmName()
  if realm and realm ~= "" then return realm end
  return GetRealmName and GetRealmName() or nil
end

local function withRealm(name)
  if not name or name == "" then return nil end
  if name:find("-", 1, true) then return name end
  local realm = ownRealm()
  if not realm or realm == "" then return nil end
  return name .. "-" .. realm
end

-- One roster line, or nil when a required field is missing (roster.ts's parser drops a malformed
-- line anyway; this just avoids sending one) — including an unrecognized class token, which is
-- dropped rather than guessed at.
local function rosterLine(kind, nameRealm, classToken, roleCode, score)
  local classIndex = classToken and CLASS_TOKEN_TO_INDEX[classToken]
  if not nameRealm or not classIndex or not roleCode then return nil end
  local n = tonumber(score) or 0
  if n < 0 then n = 0 end
  return string.format("%s|%s|%d|%s|%d", kind, nameRealm, classIndex, roleCode, math.floor(n))
end

-- ---------------------------------------------------------------------------------------------
-- The player ("s")
-- ---------------------------------------------------------------------------------------------

local function selfLine()
  local nameRealm = withRealm(UnitName("player"))
  local classToken = select(2, UnitClass("player"))
  local roleCode = ROLE_TOKEN_TO_CODE[UnitGroupRolesAssigned("player")]

  local score = 0
  if C_ChallengeMode and C_ChallengeMode.GetOverallDungeonScore then
    local ok, s = pcall(C_ChallengeMode.GetOverallDungeonScore)
    if ok and type(s) == "number" then score = s end
  end

  return rosterLine("s", nameRealm, classToken, roleCode, score)
end

-- ---------------------------------------------------------------------------------------------
-- The party ("p") — up to 4 other members of a 5-man Mythic+ group.
-- ---------------------------------------------------------------------------------------------

local function partyUnits()
  local units = {}
  if IsInRaid and IsInRaid() then return units end -- 5-man scope only, per the addon's brief
  local n = GetNumGroupMembers()
  for i = 1, n - 1 do
    local unit = "party" .. i
    if UnitExists(unit) then table.insert(units, unit) end
  end
  return units
end

function Roster.PartyLines()
  local lines = {}
  for _, unit in ipairs(partyUnits()) do
    local name = UnitName(unit)
    local classToken = select(2, UnitClass(unit))
    local roleCode = ROLE_TOKEN_TO_CODE[UnitGroupRolesAssigned(unit)]
    local line = rosterLine("p", withRealm(name), classToken, roleCode, 0)
    if line then table.insert(lines, line) end
  end
  return lines
end

-- ---------------------------------------------------------------------------------------------
-- Applicants ("a") — the current Group Finder posting's pending applications, oldest first (the
-- order C_LFGList.GetApplicants() itself returns them in).
-- ---------------------------------------------------------------------------------------------

-- The application states that still belong on the strip. Anything else the API reports (cancelled,
-- declined, timedout, inviteaccepted, inviteedeclined, failed) is a finished application.
Roster.LIVE_STATUS = { applied = true, invited = true }

-- `C_LFGList.GetApplicantInfo` has two shapes in the wild: the documented multiple returns
-- (id, status, pendingStatus, numMembers, …) and a single info table (what a live Midnight client
-- returns — `1=table:` with every other value nil). Read both, and fall back to probing the members
-- themselves so an application is never truncated just because a field moved.
local function applicantInfo(applicantID)
  if not C_LFGList.GetApplicantInfo then return nil, nil end
  local ok, a, b, _c, d = pcall(C_LFGList.GetApplicantInfo, applicantID)
  if not ok then return nil, nil end
  if type(a) == "table" then
    -- A live client names it `applicationStatus`; the older documentation says `status`.
    local n = a.numMembers
    local status = a.applicationStatus or a.status
    return type(n) == "number" and n or nil, type(status) == "string" and status or nil
  end
  return type(d) == "number" and d or nil, type(b) == "string" and b or nil
end

-- One member of an application. Same story: multiple returns on some clients, an info table on
-- others. Returns nil when there is no member at that index.
local MAX_MEMBERS = 5
local function memberInfo(applicantID, memberIdx)
  local ok, a, classToken, _localizedClass, _level, _itemLevel, _honorLevel,
    tank, healer, damage, _assignedRole, _relationship, dungeonScore =
    pcall(C_LFGList.GetApplicantMemberInfo, applicantID, memberIdx)
  if not ok or a == nil then return nil end
  if type(a) == "table" then
    return {
      name = a.name,
      classToken = a.classFilename or a.className or a.class,
      tank = a.tank, healer = a.healer, damage = a.damage,
      score = a.dungeonScore or a.mythicPlusRating or a.rating,
    }
  end
  return {
    name = a,
    classToken = classToken,
    tank = tank, healer = healer, damage = damage,
    score = dungeonScore,
  }
end

function Roster.ApplicantLines()
  local lines = {}
  if not C_LFGList or not C_LFGList.GetApplicants or not C_LFGList.GetApplicantMemberInfo then
    return lines
  end
  local ok, applicantIDs = pcall(C_LFGList.GetApplicants)
  if not ok or not applicantIDs then return lines end

  for _, applicantID in ipairs(applicantIDs) do
    local numMembers, status = applicantInfo(applicantID)
    -- An application the game still lists but that is no longer pending (withdrawn, declined, timed
    -- out, already invited and accepted) must leave the strip at once, or the panel keeps showing
    -- someone who is gone. Only "applied" and "invited" are live; an unknown status is kept, so a
    -- future value cannot silently hide real applicants.
    local live = not status or Roster.LIVE_STATUS[status]
    if live then
      -- No usable count: walk the members until the game stops giving us one.
      local last = numMembers or MAX_MEMBERS
      for memberIdx = 1, math.min(last, MAX_MEMBERS) do
        local m = memberInfo(applicantID, memberIdx)
        if not m or not m.name then break end
        local roleCode
        if m.tank then roleCode = "T"
        elseif m.healer then roleCode = "H"
        elseif m.damage then roleCode = "D" end
        local line = rosterLine("a", withRealm(m.name), m.classToken, roleCode, m.score)
        if line then table.insert(lines, line) end
      end
    end
  end
  return lines
end

-- ---------------------------------------------------------------------------------------------

-- The full roster text main.lua hands to Encode.chunkRoster(): the player, then the party, then the
-- applicants oldest first. "" when there is nothing to draw.
function Roster.BuildText()
  local lines = {}
  local self = selfLine()
  if self then table.insert(lines, self) end
  for _, line in ipairs(Roster.PartyLines()) do table.insert(lines, line) end
  for _, line in ipairs(Roster.ApplicantLines()) do table.insert(lines, line) end
  if #lines == 0 then return "" end
  return table.concat(lines, "\n") .. "\n"
end
