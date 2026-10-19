/** New-HOVER-report owner notification: the state scope and the words (owner, 2026-10-19). */
import { describe, it, expect } from "vitest";
import { hoverNotifyStatesOf, hoverReportWanted } from "@shared/hover-notify";
import { hoverReportNotice } from "./hover-notify";
import { CRM_NOTIFICATION_PREFS } from "@shared/schema";

const alpine = { notificationScopes: { hoverReportReady: { states: ["WA"] } } };

describe("HOVER report notification scope", () => {
  it("is a real notification preference with the standard channel switches", () => {
    expect(CRM_NOTIFICATION_PREFS).toContain("hoverReportReady");
  });
  it("reads the chosen states, uppercased and deduplicated; absent or empty means every state", () => {
    expect(hoverNotifyStatesOf(alpine)).toEqual(["WA"]);
    expect(hoverNotifyStatesOf({ notificationScopes: { hoverReportReady: { states: ["wa", "WA", "fl", "Texas"] } } })).toEqual(["WA", "FL"]);
    expect(hoverNotifyStatesOf({})).toBeNull();
    expect(hoverNotifyStatesOf(null)).toBeNull();
    expect(hoverNotifyStatesOf({ notificationScopes: { hoverReportReady: { states: [] } } })).toBeNull();
  });
  it("rings for WA, stays quiet for FL, and never drops a report whose state is unknown", () => {
    expect(hoverReportWanted(alpine, "WA")).toBe(true);
    expect(hoverReportWanted(alpine, "wa")).toBe(true);
    expect(hoverReportWanted(alpine, "FL")).toBe(false);
    expect(hoverReportWanted(alpine, null)).toBe(true);
    expect(hoverReportWanted(alpine, "")).toBe(true);
    expect(hoverReportWanted({}, "FL")).toBe(true);
  });
  it("names the client, the place and the state; an unmatched capture says so and links to the photos page", () => {
    const n = hoverReportNotice({
      report: { id: "m1", customerId: "c1", addressLine1: "19848 Skyridge Dr S", city: "Mount Vernon", state: "WA", postalCode: "98274" },
      customerName: "Linda Wellborn", state: "WA",
    });
    expect(n.title).toBe("New HOVER report — Linda Wellborn (WA)");
    expect(n.body).toBe("19848 Skyridge Dr S · Mount Vernon, WA");
    expect(n.link).toBe("/crm/clients/c1");
    const u = hoverReportNotice({ report: { id: "m2", customerId: null, addressLine1: null, city: null, state: null, postalCode: null, rawPayload: { hoverJobName: "Job 4411" } }, customerName: null, state: null });
    expect(u.title).toBe("New HOVER report — Job 4411 (state unknown)");
    expect(u.body).toContain("Not matched to a client yet");
    expect(u.link).toBe("/crm/photos");
  });
});
