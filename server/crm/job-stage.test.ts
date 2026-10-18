import { describe, it, expect } from "vitest";
import { jobStageOf, currentProject, nextAutoStatus, stageIndex, JOB_STAGES } from "@shared/job-stage";

describe("jobStageOf", () => {
  it("follows the newest live project", () => {
    expect(jobStageOf({ projects: [{ status: "paid", createdAt: "2026-01-01" }, { status: "proposal_sent", createdAt: "2026-06-01" }] })).toBe("bid_submitted");
    expect(jobStageOf({ projects: [{ status: "estimating" }] })).toBe("bid");
    expect(jobStageOf({ estimates: [{ status: "approved" }], projects: [{ status: "punch_list" }] })).toBe("in_progress");
    expect(jobStageOf({ projects: [{ status: "invoiced" }] })).toBe("closed_out");
    // Job Scheduled sits between Approved and In progress (owner, 2026-10-17): a scheduled project is there, not Approved.
    expect(jobStageOf({ projects: [{ status: "scheduled" }] })).toBe("job_scheduled");
    expect(jobStageOf({ projects: [{ status: "approved" }] })).toBe("approved");
  });
  it("falls back to the estimates when there is no live project", () => {
    expect(jobStageOf({})).toBeNull();
    expect(jobStageOf({ estimates: [{ status: "sent" }] })).toBe("bid_submitted");
    expect(jobStageOf({ estimates: [{ status: "draft" }] })).toBe("bid");
    expect(jobStageOf({ estimates: [{ status: "sent" }, { status: "approved" }], projects: [{ status: "cancelled" }] })).toBe("approved");
    expect(jobStageOf({ estimates: [{ status: "cancelled" }, { status: "declined" }] })).toBeNull();
    // A HOVER measurement or an expired quote is still a bid.
    expect(jobStageOf({ estimates: [{ status: "expired" }] })).toBe("bid");
    expect(jobStageOf({ measured: true })).toBe("bid");
  });
  it("picks the newest non-cancelled project as the current one", () => {
    const a = { id: "a", status: "complete", createdAt: "2026-01-01" }, b = { id: "b", status: "cancelled", createdAt: "2026-09-01" };
    expect(currentProject([a, b])?.id).toBe("a");
  });
  it("orders the six stages", () => {
    expect(JOB_STAGES.map((s) => s.key)).toEqual(["bid", "bid_submitted", "approved", "job_scheduled", "in_progress", "closed_out"]);
    expect(stageIndex("job_scheduled")).toBe(3);
    expect(stageIndex(null)).toBe(-1);
  });
});

describe("nextAutoStatus — the stage only ever moves forward on its own", () => {
  it("advances a job that is behind the event", () => {
    expect(nextAutoStatus("lead", "bid_submitted")).toBe("proposal_sent");
    expect(nextAutoStatus("estimating", "approved")).toBe("approved");
    expect(nextAutoStatus("proposal_sent", "approved")).toBe("approved");
    expect(nextAutoStatus("approved", "job_scheduled")).toBe("scheduled");
    expect(nextAutoStatus("scheduled", "in_progress")).toBe("in_progress");
    expect(nextAutoStatus("approved", "in_progress")).toBe("in_progress");
    expect(nextAutoStatus("waiting_on_trades", "closed_out")).toBe("complete");
  });
  it("never moves backward, never re-enters the same stage", () => {
    expect(nextAutoStatus("approved", "bid_submitted")).toBeNull();
    expect(nextAutoStatus("in_progress", "job_scheduled")).toBeNull();
    expect(nextAutoStatus("punch_list", "in_progress")).toBeNull();
    expect(nextAutoStatus("scheduled", "job_scheduled")).toBeNull();
    expect(nextAutoStatus("proposal_sent", "bid_submitted")).toBeNull();
  });
  it("never moves past Closed out and never touches a cancelled or unknown project", () => {
    expect(nextAutoStatus("complete", "closed_out")).toBeNull();
    expect(nextAutoStatus("invoiced", "in_progress")).toBeNull();
    expect(nextAutoStatus("paid", "closed_out")).toBeNull();
    expect(nextAutoStatus("cancelled", "approved")).toBeNull();
    expect(nextAutoStatus("made_up", "approved")).toBeNull();
    expect(nextAutoStatus(null, "approved")).toBeNull();
  });
});
