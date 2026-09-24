-- Exercises addon/bmpl/roster.lua outside the game, against a stubbed WoW API.
-- Usage: luajit addon/bmpl/tests/roster.lua   (cwd = repo root)
-- Prints "OK <n>" and exits 0, or the first failed assertion and exits 1.

local checked = 0
local function check(cond, msg)
  if not cond then
    io.stderr:write("FAIL: " .. msg .. "\n")
    os.exit(1)
  end
  checked = checked + 1
end

-- The group: the player on Hyjal, one party member from the same realm (UnitName gives no realm) and
-- one from another realm (UnitName gives it as a second value, without spaces).
local UNITS = {
  player = { name = "Biwaasham", class = "SHAMAN", role = "HEALER" },
  party1 = { name = "Eldrilas", realm = "Dalaran", class = "MAGE", role = "DAMAGER" },
  party2 = { name = "Sameguy", realm = nil, class = "WARRIOR", role = "TANK" },
  party3 = { name = "Emptyrealm", realm = "", class = "ROGUE", role = "DAMAGER" },
  party4 = { name = "Spaced", realm = "TarrenMill", class = "PRIEST", role = "DAMAGER" },
}
function UnitName(unit) local u = UNITS[unit]; return u.name, u.realm end
function UnitClass(unit) return "x", UNITS[unit].class end
function UnitGroupRolesAssigned(unit) return UNITS[unit].role end
function UnitExists(unit) return UNITS[unit] ~= nil end
function GetNumGroupMembers() return 5 end
function IsInRaid() return false end
function GetNormalizedRealmName() return "Hyjal" end
C_LFGList = nil

local ns = {}
assert(loadfile("addon/bmpl/roster.lua"))("bmpl", ns)
local Roster = assert(ns.Roster, "roster.lua did not publish ns.Roster")

local text = Roster.BuildText()
local lines = {}
for line in text:gmatch("[^\n]+") do lines[#lines + 1] = line end

check(#lines == 5, "expected 5 lines, got " .. #lines .. ":\n" .. text)
check(lines[1] == "s|Biwaasham-Hyjal|9|H|0", "self line: " .. lines[1])
check(lines[2] == "p|Eldrilas-Dalaran|4|D|0", "cross-realm party member keeps their realm: " .. lines[2])
check(lines[3] == "p|Sameguy-Hyjal|11|T|0", "same-realm party member gets the player's realm: " .. lines[3])
check(lines[4] == "p|Emptyrealm-Hyjal|8|D|0", "an empty realm is the player's realm: " .. lines[4])
check(lines[5] == "p|Spaced-TarrenMill|7|D|0", "a realm without spaces is passed as is: " .. lines[5])

print("OK " .. checked)
