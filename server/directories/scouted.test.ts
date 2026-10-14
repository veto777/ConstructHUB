import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scoutRow, toDirectoryRow, loadScoutedDirectories, SCOUTED_FILE, type ScoutedDirectory } from "./scouted";

const line = {
  name: "ACCA at Home HVAC Contractor Locator",
  domain: "www.ACCA.org",
  directory_url: "https://hvac-contractors.acca.org/acca-at-home",
  join_url: "https://www.acca.org/join",
  category: "trade_assoc",
  trades: ["HVAC"],
  states: null,
  requires_street_address: null,
  paid: true,
  membership_or_certification_required: true,
  evidence: "FIND A NATIONALLY RECOGNIZED HVAC CONTRACTOR IN YOUR AREA; Become a Member",
};

function scouted(overrides: Partial<ScoutedDirectory> = {}): ScoutedDirectory {
  const row = scoutRow.parse(line);
  return {
    name: row.name,
    domain: row.domain,
    category: row.category,
    trades: row.trades,
    states: row.states,
    requiresStreetAddress: row.requires_street_address,
    requiresPhoneVerification: row.requires_phone_verification,
    requiresPostcard: row.requires_postcard,
    paid: row.paid,
    membershipRequired: row.membership_or_certification_required,
    directoryUrl: row.directory_url,
    joinUrl: row.join_url,
    evidence: row.evidence,
    notes: row.notes,
    foundBy: "assoc-national",
    linkStatus: "verified",
    checkedAt: "2026-10-13T23:00:00.000Z",
    ...overrides,
  };
}

describe("scouted directories", () => {
  it("normalizes a scout line and leaves unseen fields null", () => {
    const row = scoutRow.parse(line);
    expect(row.domain).toBe("acca.org");
    expect(row.trades).toEqual(["hvac"]);
    expect(row.requires_postcard).toBeNull();
    expect(row.notes).toBeNull();
  });

  it("rejects categories outside the scout brief", () => {
    expect(scoutRow.safeParse({ ...line, category: "ai" }).success).toBe(false);
  });

  it("becomes a tier-4 submission row with its page as the source and evidence in the notes", () => {
    const row = toDirectoryRow(scouted());
    expect(row).toMatchObject({ kind: "submission", tier: 4, category: "trade_assoc", domain: "acca.org", paid: true, active: true });
    expect(row.source).toBe("https://hvac-contractors.acca.org/acca-at-home");
    expect(row.notes).toContain("How to get listed: https://www.acca.org/join");
    expect(row.notes).toContain("Membership or certification required.");
    expect(row.notes).toContain("Link verified 2026-10-13");
  });

  it("refuses private or malformed URLs and domains", () => {
    expect(() => toDirectoryRow(scouted({ directoryUrl: "http://127.0.0.1/admin" }))).toThrow();
    expect(() => toDirectoryRow(scouted({ domain: "acca.org/path" }))).toThrow();
    expect(() => toDirectoryRow(scouted({ states: ["Texas"] }))).toThrow();
  });

  it("loads the shipped data file and treats a missing one as empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scouted-"));
    expect(loadScoutedDirectories(dir).length).toBeGreaterThanOrEqual(0);
    writeFileSync(path.join(dir, SCOUTED_FILE), JSON.stringify([scouted()]));
    expect(loadScoutedDirectories(dir)).toHaveLength(1);
  });
});
