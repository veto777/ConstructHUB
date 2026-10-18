import { describe, it, expect } from "vitest";
import { jobStageOf, currentProject } from "@shared/job-stage";

describe("jobStageOf", () => {
  it("follows the newest live project", () => {
    expect(jobStageOf({ projects: [{ status: "paid", createdAt: "2026-01-01" }, { status: "proposal_sent", createdAt: "2026-06-01" }] })).toBe("bid");
    expect(jobStageOf({ estimates: [{ status: "approved" }], projects: [{ status: "punch_list" }] })).toBe("in_progress");
    expect(jobStageOf({ projects: [{ status: "invoiced" }] })).toBe("closed_out");
    expect(jobStageOf({ projects: [{ status: "scheduled" }] })).toBe("approved");
  });
  it("falls back to the estimates when there is no live project", () => {
    expect(jobStageOf({})).toBeNull();
    expect(jobStageOf({ estimates: [{ status: "sent" }] })).toBe("bid");
    expect(jobStageOf({ estimates: [{ status: "sent" }, { status: "approved" }], projects: [{ status: "cancelled" }] })).toBe("approved");
    expect(jobStageOf({ estimates: [{ status: "cancelled" }, { status: "declined" }, { status: "expired" }] })).toBeNull();
  });
  it("picks the newest non-cancelled project as the current one", () => {
    const a = { id: "a", status: "complete", createdAt: "2026-01-01" }, b = { id: "b", status: "cancelled", createdAt: "2026-09-01" };
    expect(currentProject([a, b])?.id).toBe("a");
  });
});
