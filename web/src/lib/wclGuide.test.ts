import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { fmtPts } from "./format.ts";
import { menuModel } from "./session.ts";
import { WCL_CLIENTS_URL, showsWclGuide, wclGuideView } from "./wclGuide.ts";

const tFr = makeT(fr, "fr");
const member = { id: 2, discordId: "22", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", role: "member" as const };
const spent = { used: 300, limit: 300, resetInS: 2280 };
const usableClient = { clientId: "9f2c…ab12", verifiedAt: 1, updatedAt: 1, usable: true, snapshot: null };

describe("the guided own-client sheet", () => {
  test("the quota line, the pitch with how many times the quota a key gives, the values to copy, the wait", () => {
    const v = wclGuideView(tEn, spent, "https://bmpl.example.com");
    expect(v.title).toBe("Your quota for this hour is used up (300/300 pts) · resets in 38 min");
    expect(v.pitch).toContain(`${fmtPts(3600)} pts an hour to yourself, 12 times your quota`);
    expect(v.values).toEqual([
      { key: "name", label: "Name", value: "bmpl" },
      { key: "redirect", label: "Redirect URL", value: "https://bmpl.example.com" },
    ]);
    expect(v.wait).toBe("Or wait 38 min: your quota starts again from zero.");
    expect(wclGuideView(tFr, spent, "https://x").title).toBe("Ton quota de l'heure est atteint (300/300 pts) · reset dans 38 min");
    // No limit to compare with: the pitch says the budget without a ratio.
    expect(wclGuideView(tEn, { used: 0, limit: null, resetInS: 60 }, "https://x").pitch).not.toContain("times");
    expect(WCL_CLIENTS_URL).toBe("https://www.warcraftlogs.com/api/clients");
  });

  test("shown only hosted, with own clients stored, on a quota refusal, without a usable own client", () => {
    const base = { hosted: true, wclClients: true, ownClient: null, quota: spent };
    expect(showsWclGuide(base)).toBe(true);
    expect(showsWclGuide({ ...base, hosted: false })).toBe(false);
    expect(showsWclGuide({ ...base, wclClients: false })).toBe(false);
    expect(showsWclGuide({ ...base, quota: undefined })).toBe(false);
    expect(showsWclGuide({ ...base, ownClient: usableClient })).toBe(false);
    expect(showsWclGuide({ ...base, ownClient: { ...usableClient, usable: false } })).toBe(true);
  });

  test("the sidebar link: only once the quota is exhausted, and only when the instance stores own clients", () => {
    expect(menuModel(tEn, member, spent, null, true).keyLink).toEqual({ label: `Your own key · ${fmtPts(3600)} pts/h →`, href: "/settings#wcl-client" });
    expect(menuModel(tEn, member, spent, null, false).keyLink).toBeNull();
    expect(menuModel(tEn, member, { ...spent, used: 120 }, null, true).keyLink).toBeNull();
    expect(menuModel(tFr, member, spent, null, true).keyLink?.label).toBe(`Ta propre clé · ${fmtPts(3600)} pts/h →`);
  });
});
