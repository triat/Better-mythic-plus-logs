-- addon/bmpl/roster.lua
--
-- Builds the roster text line (kind|Name-Realm|Class|Spec|Role|score) the browser's
-- web/src/lib/live/roster.ts parses, for the player themself ("s"), the player's party ("p") and the
-- current Group Finder applicants ("a"). Reads only; never writes SavedVariables, never talks to the
-- network — the addon "sends nothing, receives nothing, stores nothing" per addon/README.md.
--
-- KNOWN LIMITATIONS (read before trusting a spec label in game — see the manual checklist):
--   * Spec names come straight from the client's own API strings (whitespace stripped, e.g. "Beast
--     Mastery" -> "BeastMastery") rather than a hardcoded table, so any current or future spec name
--     the game reports is passed through unchanged — but only on an ENGLISH client. A non-English
--     client will report a localized spec name that will not match Warcraft Logs' English keys.
--     Class names are locale-safe (UnitClassBase() returns the same file token in every locale).
--   * Blizzard's public LFG applicant API (C_LFGList.GetApplicantMemberInfo) exposes an applicant's
--     class and role but not their exact talent spec (the stock Group Finder UI doesn't show it
--     either). For an applicant, and for a party member before their inspect completes, the spec is a
--     best-effort default: the class's tank spec when the role is Tank, its healer spec when Healer
--     (both unique per class), and the class's first damage spec when the role is Damage (ambiguous —
--     a Fire Mage applicant may show as its class's default DPS spec instead). A party member's real
--     spec replaces the guess automatically once NotifyInspect()/INSPECT_READY resolves it.
--   * The exact return signature of C_LFGList.GetApplicantInfo/GetApplicantMemberInfo used below is
--     transcribed from Blizzard's public Lua API documentation and has not been exercised against a
--     live client by this change (this repo's tests never touch WoW — see AGENTS.md). Every call into
--     it is pcall-guarded, so a signature drift drops that one applicant rather than breaking the
--     addon; if applicants stop appearing at all, that is the first thing to check.

local ADDON_NAME, ns = ...

local Roster = {}
ns.Roster = Roster

-- Blizzard's class file token (locale-independent, e.g. "DEATHKNIGHT") -> Warcraft Logs' spacing-free
-- class name. Mirrors src/wow/classes.ts / src/signals/kick-cooldowns.ts (the source of truth).
local CLASS_TOKEN_TO_WCL = {
  WARRIOR = "Warrior", PALADIN = "Paladin", HUNTER = "Hunter", ROGUE = "Rogue", PRIEST = "Priest",
  DEATHKNIGHT = "DeathKnight", SHAMAN = "Shaman", MAGE = "Mage", WARLOCK = "Warlock", MONK = "Monk",
  DRUID = "Druid", DEMONHUNTER = "DemonHunter", EVOKER = "Evoker",
}

local ROLE_TOKEN_TO_CODE = { TANK = "T", HEALER = "H", DAMAGER = "D" }

-- One tank spec and one healer spec per class (unique given the role) plus a best-effort damage-spec
-- default — see the "KNOWN LIMITATIONS" note above. Keys are Blizzard class file tokens.
local DEFAULT_SPEC = {
  DEATHKNIGHT = { T = "Blood", D = "Frost" },
  DEMONHUNTER = { T = "Vengeance", D = "Havoc" },
  DRUID = { T = "Guardian", H = "Restoration", D = "Balance" },
  EVOKER = { H = "Preservation", D = "Devastation" },
  HUNTER = { D = "BeastMastery" },
  MAGE = { D = "Fire" },
  MONK = { T = "Brewmaster", H = "Mistweaver", D = "Windwalker" },
  PALADIN = { T = "Protection", H = "Holy", D = "Retribution" },
  PRIEST = { H = "Holy", D = "Shadow" },
  ROGUE = { D = "Assassination" },
  SHAMAN = { H = "Restoration", D = "Elemental" },
  WARLOCK = { D = "Affliction" },
  WARRIOR = { T = "Protection", D = "Arms" },
}

local function specGuess(classToken, roleCode)
  local byRole = DEFAULT_SPEC[classToken]
  return byRole and byRole[roleCode] or nil
end

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
-- line anyway; this just avoids sending one).
local function rosterLine(kind, nameRealm, classToken, spec, roleCode, score)
  local wclClass = classToken and CLASS_TOKEN_TO_WCL[classToken]
  if not nameRealm or not wclClass or not spec or spec == "" or not roleCode then return nil end
  local n = tonumber(score) or 0
  if n < 0 then n = 0 end
  return string.format("%s|%s|%s|%s|%s|%d", kind, nameRealm, wclClass, spec, roleCode, math.floor(n))
end

-- ---------------------------------------------------------------------------------------------
-- The player ("s")
-- ---------------------------------------------------------------------------------------------

local function selfLine()
  local nameRealm = withRealm(UnitName("player"))
  local classToken = select(2, UnitClass("player"))
  local roleCode = ROLE_TOKEN_TO_CODE[UnitGroupRolesAssigned("player")]

  local spec
  if GetSpecialization then
    local specIndex = GetSpecialization()
    if specIndex then
      local _, name = GetSpecializationInfo(specIndex)
      if name then spec = (name:gsub("%s+", "")) end
    end
  end
  if not spec then spec = specGuess(classToken, roleCode) end

  local score = 0
  if C_ChallengeMode and C_ChallengeMode.GetOverallDungeonScore then
    local ok, s = pcall(C_ChallengeMode.GetOverallDungeonScore)
    if ok and type(s) == "number" then score = s end
  end

  return rosterLine("s", nameRealm, classToken, spec, roleCode, score)
end

-- ---------------------------------------------------------------------------------------------
-- The party ("p") — up to 4 other members of a 5-man Mythic+ group. Spec is resolved via
-- NotifyInspect()/INSPECT_READY (real data) and falls back to specGuess() until that completes.
-- ---------------------------------------------------------------------------------------------

local partySpecByGuid = {}

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

-- Call periodically (main.lua's 10 Hz tick) while grouped: asks the client to inspect any party
-- member whose spec we don't have cached yet. Cheap to call every tick — NotifyInspect() is a no-op
-- when nothing changed and the client throttles inspect requests on its own.
function Roster.RequestPartyInspects()
  for _, unit in ipairs(partyUnits()) do
    local guid = UnitGUID(unit)
    if guid and not partySpecByGuid[guid] then
      pcall(NotifyInspect, unit)
    end
  end
end

-- INSPECT_READY handler (main.lua forwards the event's GUID argument here).
function Roster.HandleInspectReady(guid)
  if not guid or not GetInspectSpecialization then return end
  for _, unit in ipairs(partyUnits()) do
    if UnitGUID(unit) == guid then
      local ok, specID = pcall(GetInspectSpecialization, unit)
      if ok and specID and specID > 0 and GetSpecializationInfoByID then
        local infoOk, _id, name = pcall(GetSpecializationInfoByID, specID)
        if infoOk and name then partySpecByGuid[guid] = (name:gsub("%s+", "")) end
      end
      return
    end
  end
end

function Roster.PartyLines()
  local lines = {}
  for _, unit in ipairs(partyUnits()) do
    local name = UnitName(unit)
    local classToken = select(2, UnitClass(unit))
    local guid = UnitGUID(unit)
    local roleCode = ROLE_TOKEN_TO_CODE[UnitGroupRolesAssigned(unit)]
    local spec = guid and partySpecByGuid[guid]
    if not spec then spec = specGuess(classToken, roleCode) end
    local line = rosterLine("p", withRealm(name), classToken, spec, roleCode, 0)
    if line then table.insert(lines, line) end
  end
  return lines
end

-- ---------------------------------------------------------------------------------------------
-- Applicants ("a") — the current Group Finder posting's pending applications, oldest first (the
-- order C_LFGList.GetApplicants() itself returns them in).
-- ---------------------------------------------------------------------------------------------

function Roster.ApplicantLines()
  local lines = {}
  if not C_LFGList or not C_LFGList.GetApplicants or not C_LFGList.GetApplicantMemberInfo then
    return lines
  end
  local ok, applicantIDs = pcall(C_LFGList.GetApplicants)
  if not ok or not applicantIDs then return lines end

  for _, applicantID in ipairs(applicantIDs) do
    local numMembers = 1
    if C_LFGList.GetApplicantInfo then
      local infoOk, _id, n = pcall(C_LFGList.GetApplicantInfo, applicantID)
      if infoOk and type(n) == "number" and n > 0 then numMembers = n end
    end
    for memberIdx = 1, numMembers do
      local memberOk, name, classToken, _localizedClass, _level, _itemLevel, _honorLevel,
        tank, healer, damage, _assignedRole, _relationship, dungeonScore =
        pcall(C_LFGList.GetApplicantMemberInfo, applicantID, memberIdx)
      if memberOk and name then
        local roleCode
        if tank then roleCode = "T"
        elseif healer then roleCode = "H"
        elseif damage then roleCode = "D" end
        local spec = classToken and roleCode and specGuess(classToken, roleCode)
        local line = rosterLine("a", withRealm(name), classToken, spec, roleCode, dungeonScore)
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
