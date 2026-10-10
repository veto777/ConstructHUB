import { describe, expect, it } from "vitest";
// The JobCam-only CRM shell (owner, 2026-10-10: JobCam bought à la carte with no CRM plan): which API paths stay
// open, and the 402 body everything else gets. Pure (server/crm/jobcam-shell.ts).
import { JOBCAM_SHELL_PATHS, jobcamShellPath, jobcamOnlyBody } from "./jobcam-shell";

describe("the JobCam-only shell", () => {
  it("opens JobCam and the clients/projects shots are filed to, nothing else", () => {
    for (const p of ["/api/crm/jobcam", "/api/crm/jobcam/uploads", "/api/crm/jobcam/media/abc/file/thumb", "/api/crm/jobcam/projects?lat=1&lng=2",
      "/api/crm/customers", "/api/crm/customers/7", "/api/crm/projects", "/api/crm/projects/9"]) expect(jobcamShellPath(p), p).toBe(true);
    for (const p of ["/api/crm/estimates", "/api/crm/invoices", "/api/crm/schedule", "/api/crm/payments", "/api/crm/sms/send", "/api/crm/pricebook",
      "/api/crm/integrations", "/api/crm/team", "/api/crm/jobcamera", "/api/crm/projectsx"]) expect(jobcamShellPath(p), p).toBe(false);
    expect(JOBCAM_SHELL_PATHS).toHaveLength(3);
  });
  it("the 402 keeps the CRM's own code and says what JobCam-only means", () => {
    const body = jobcamOnlyBody({ code: "crm_plan_required", message: "x", href: "/pricing#crm" });
    expect(body).toMatchObject({ code: "crm_plan_required", href: "/pricing#crm", jobcamOnly: true });
    expect(body.message).toMatch(/JobCam on its own/);
    expect(body.message).toMatch(/needs a CRM plan/);
  });
});
