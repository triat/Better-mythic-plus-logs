import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { canDelete, clientCard, storedDataText } from "./account.ts";

const tFr = makeT(fr, "fr");
const NOW = 1_700_000_000_000;
const client = { clientId: "a3f1…9c2e", verifiedAt: NOW - 2 * 3_600_000, updatedAt: NOW - 2 * 3_600_000, usable: true, snapshot: { pointsSpentThisHour: 1412, limitPerHour: 3600, pointsResetIn: 2280, observedAt: NOW - 60_000 } };

describe("clientCard", () => {
  test("disabled instance", () => {
    expect(clientCard(tEn, false, null, 300, NOW)).toEqual({ state: "disabled", status: "This instance does not store WCL clients — your lookups use the shared budget.", dot: "dot-none", showForm: false });
  });
  test("stale client: the instance key changed, the secret must be saved again", () => {
    expect(clientCard(tEn, true, { ...client, usable: false }, 300, NOW)).toEqual({
      state: "stale", status: "Stored secret cannot be decrypted (the instance key changed) — save the client again. Your lookups use the shared budget meanwhile.", dot: "dot-none", showForm: true,
    });
  });
  test("no client: shared budget with the limit", () => {
    expect(clientCard(tEn, true, null, 300, NOW)).toEqual({ state: "none", status: "No client — your lookups use the shared budget (300 pts per hour).", dot: "dot-none", showForm: true });
    expect(clientCard(tEn, true, null, null, NOW).status).toBe("No client — your lookups use the shared budget (no quota).");
  });
  test("client set: verified age, abbreviated id, spent / limit (narrow no-break space thousands)", () => {
    expect(clientCard(tEn, true, client, 300, NOW)).toEqual({ state: "set", status: "Verified 2 h ago · a3f1…9c2e · 1 412 / 3 600 pts", dot: "dot-approved", showForm: false });
    expect(clientCard(tEn, true, { ...client, snapshot: null }, 300, NOW).status).toBe("Verified 2 h ago · a3f1…9c2e");
    expect(clientCard(tEn, true, { ...client, verifiedAt: null, snapshot: null }, 300, NOW).status).toBe("Saved 2 h ago · a3f1…9c2e");
  });
  test("French: every state, the age already spaced, the id and counter untouched", () => {
    expect(clientCard(tFr, false, null, 300, NOW).status).toBe("Cette instance ne stocke pas de client WCL — tes recherches utilisent le budget partagé.");
    expect(clientCard(tFr, true, null, 300, NOW).status).toBe("Aucun client — tes recherches utilisent le budget partagé (300 pts par heure).");
    expect(clientCard(tFr, true, null, null, NOW).status).toBe("Aucun client — tes recherches utilisent le budget partagé (pas de quota).");
    expect(clientCard(tFr, true, { ...client, usable: false }, 300, NOW).status).toMatch(/^Le secret stocké ne peut plus être déchiffré/);
    expect(clientCard(tFr, true, client, 300, NOW).status).toBe("Vérifié il y a 2 h · a3f1…9c2e · 1 412 / 3 600 pts");
    expect(clientCard(tFr, true, { ...client, verifiedAt: null, snapshot: null }, 300, NOW).status).toBe("Enregistré il y a 2 h · a3f1…9c2e");
  });
});
describe("delete confirmation", () => {
  test("the typed word, trimmed and case-insensitive", () => {
    expect(canDelete("delete")).toBe(true);
    expect(canDelete("  DELETE ")).toBe(true);
    expect(canDelete("delet")).toBe(false);
    expect(canDelete("")).toBe(false);
  });
});
test("storedDataText names every stored thing", () => {
  const t = storedDataText(tEn);
  for (const s of ["Discord id", "lookup history (20 tabs)", "settings", "hourly WCL usage", "defensives proposals", "WCL client (secret encrypted)", "shared cache"]) expect(t).toContain(s);
  const f = storedDataText(tFr);
  for (const s of ["avatar Discord", "historique de recherches (20 onglets)", "paramètres", "usage WCL horaire", "propositions de defensives", "client WCL (secret chiffré)", "cache partagé"]) expect(f).toContain(s);
});
