import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { LOCAL_STATUS, type StatusInfo } from "./hostedMode.ts";
import { PREVIEW_AXES, landingView } from "./landing.ts";

const tFr = makeT(fr, "fr");
const hosted: StatusInfo = { ...LOCAL_STATUS, hosted: true };

describe("landingView", () => {
  test("refusals pass through from the sign-in callback", () => {
    expect(landingView(tEn, hosted, "?denied=123456789012345678").notice).toEqual({ kind: "invite", discordId: "123456789012345678" });
    expect(landingView(tEn, hosted, "?denied=banned").notice).toMatchObject({ kind: "banned", title: "Account banned" });
    expect(landingView(tEn, hosted, "").notice).toBeNull();
    expect(landingView(tEn, hosted, "?login=failed").loginFailed).toBe(true);
    expect(landingView(tEn, hosted, "").loginFailed).toBe(false);
  });
  test("three steps, in order", () => {
    const v = landingView(tEn, hosted, "");
    expect(v.steps.map((s) => [s.n, s.title])).toEqual([[1, "Look a player up"], [2, "Read the verdict"], [3, "Dig into the runs"]]);
    expect(landingView(tFr, hosted, "").steps.map((s) => s.title)).toEqual(["Cherche un joueur", "Lis le verdict", "Creuse les runs"]);
  });
  test("facts: WCL points, then the instance's note as the data fact", () => {
    const guild = landingView(tEn, { ...hosted, guildRequired: true }, "");
    expect(guild.facts.map((f) => f.key)).toEqual(["points", "data"]);
    expect(guild.note).toStartWith("Members of the guild's Discord only.");
    expect(guild.facts[1]!.text).toBe(guild.note);
    expect(landingView(tEn, { ...hosted, openSignup: true }, "").note).toStartWith("Anyone with a Discord account can sign in.");
    expect(landingView(tFr, hosted, "").facts[0]!.text).toStartWith("Chaque recherche consomme des points de l'API Warcraft Logs");
  });
});

describe("preview", () => {
  test("only consistency is marked informational (weight 0, spec decision 5)", () => {
    expect(PREVIEW_AXES.filter((a) => a.informational).map((a) => a.key)).toEqual(["consistency"]);
  });
  test("the points fact does not claim a lookup's cost shows beforehand", () => {
    expect(landingView(tEn, LOCAL_STATUS, "").facts[0]!.text).not.toContain("before every action");
  });
});
