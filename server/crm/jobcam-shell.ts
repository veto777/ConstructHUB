/**
 * The JobCam-only CRM shell (owner, 2026-10-10: JobCam bought à la carte with
 * no CRM plan): which staff routes stay open. JobCam itself, and the clients
 * and projects a shot is filed to (a project needs a client; the camera lists
 * projects nearest first). Everything else — estimates, invoices, schedule,
 * payments, texting, the price book, integrations — answers 402
 * crm_plan_required, so the app shows the CRM plans. Pure; tested in
 * server/crm/jobcam-shell.test.ts.
 */
export const JOBCAM_SHELL_PATHS: readonly RegExp[] = [
  /^\/api\/crm\/jobcam(\/|$)/,
  /^\/api\/crm\/customers(\/|$)/,
  /^\/api\/crm\/projects(\/|$)/,
];

/** Is this API path part of the JobCam-only shell? */
export const jobcamShellPath = (path: string): boolean => JOBCAM_SHELL_PATHS.some((re) => re.test(path.split("?")[0]));

/** The 402 body for a CRM route outside the shell. */
export const jobcamOnlyBody = (body: { code: string; message: string; href: string }) => ({
  ...body,
  jobcamOnly: true,
  message: "Your account has JobCam on its own. The rest of the ConstructHUB CRM — estimates, invoices, scheduling, payments and texting — needs a CRM plan. Choose one to open it.",
});
