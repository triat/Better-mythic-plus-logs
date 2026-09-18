import { describe, expect, test } from "bun:test";
import { planInvite } from "../src/cli.ts";

describe("planInvite", () => {
  test("add with optional note", () => {
    expect(planInvite(["123456789012345678"])).toEqual({ ok: true, action: "add", discordId: "123456789012345678", note: null });
    expect(planInvite(["123456789012345678", "--note", "guild mate"])).toEqual({ ok: true, action: "add", discordId: "123456789012345678", note: "guild mate" });
  });
  test("list and remove", () => {
    expect(planInvite(["--list"])).toEqual({ ok: true, action: "list" });
    expect(planInvite(["--remove", "123456789012345678"])).toEqual({ ok: true, action: "remove", discordId: "123456789012345678" });
  });
  test("errors: missing id, bad id", () => {
    expect(planInvite([]).ok).toBe(false);
    expect(planInvite(["42"]).ok).toBe(false);
    expect(planInvite(["--remove", "x"]).ok).toBe(false);
  });
});
