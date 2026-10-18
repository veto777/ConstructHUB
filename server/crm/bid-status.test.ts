/** shared/bid-status.ts — Open / Pending / Complete / Dead lead and "bid not submitted", from what is on file. */
import { describe, it, expect } from "vitest";
import { bidStateOf, bidNotSubmitted, clientStageOf, deadLeadOf, type BidFacts } from "@shared/bid-status";

const f = (over: Partial<BidFacts> = {}): BidFacts => ({ dead: false, anyEstimate: false, sentEstimate: false, appointment: false, hover: false, projectStatus: null, ...over });

describe("bid state", () => {
  it("open: nothing scheduled, nothing measured, nothing written", () => {
    expect(bidStateOf(f())).toBe("open");
  });
  it("pending: a visit on the calendar, a HOVER report, or a draft estimate — but no bid sent", () => {
    expect(bidStateOf(f({ appointment: true }))).toBe("pending");
    expect(bidStateOf(f({ hover: true }))).toBe("pending");
    expect(bidStateOf(f({ anyEstimate: true }))).toBe("pending");
  });
  it("complete: the bid reached the client (sent, viewed, approved or declined all count)", () => {
    expect(bidStateOf(f({ anyEstimate: true, sentEstimate: true }))).toBe("complete");
    expect(bidStateOf(f({ anyEstimate: true, sentEstimate: true, appointment: true, hover: true }))).toBe("complete");
  });
  it("dead beats everything else — a dead lead with a sent bid is still dead", () => {
    expect(bidStateOf(f({ dead: true, sentEstimate: true, anyEstimate: true }))).toBe("dead");
  });
  it("bid not submitted = HOVER ran and no estimate is in the file (a live lead)", () => {
    expect(bidNotSubmitted(f({ hover: true }))).toBe(true);
    expect(bidNotSubmitted(f({ hover: true, anyEstimate: true }))).toBe(false);
    expect(bidNotSubmitted(f({ hover: true, dead: true }))).toBe(false);
    expect(bidNotSubmitted(f({ appointment: true }))).toBe(false);
  });
});

describe("client stage", () => {
  it("a live project decides the stage", () => {
    expect(clientStageOf(f({ projectStatus: "scheduled", sentEstimate: true }))).toBe("job_scheduled");
    expect(clientStageOf(f({ projectStatus: "complete" }))).toBe("closed_out");
  });
  it("without a project: sent bid → Bid Submitted; any estimate or HOVER → Bid; else none", () => {
    expect(clientStageOf(f({ anyEstimate: true, sentEstimate: true }))).toBe("bid_submitted");
    expect(clientStageOf(f({ anyEstimate: true }))).toBe("bid");
    expect(clientStageOf(f({ hover: true }))).toBe("bid");
    expect(clientStageOf(f())).toBeNull();
  });
});

describe("dead-lead mark", () => {
  it("reads the stored mark and ignores junk", () => {
    expect(deadLeadOf({ bidDead: { at: "2026-10-18T00:00:00.000Z", memberId: "m1", reason: "No response after 3 calls" } }))
      .toEqual({ at: "2026-10-18T00:00:00.000Z", memberId: "m1", reason: "No response after 3 calls" });
    expect(deadLeadOf({ bidDead: true })).toBeNull();
    expect(deadLeadOf(null)).toBeNull();
  });
});
