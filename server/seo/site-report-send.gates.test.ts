import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), ent: vi.fn(), build: vi.fn(), pdf: vi.fn(), send: vi.fn() }));
vi.mock("../db", () => ({ pool: { query: mocks.query } }));
vi.mock("../entitlements", () => ({ getEntitlements: mocks.ent }));
vi.mock("../account/email", () => ({ emailLayout: vi.fn(), sendTransactionalEmail: mocks.send, APP_BASE_URL: () => "https://example.com" }));
vi.mock("./site-report", () => ({ buildSiteReport: mocks.build, renderReportPdf: mocks.pdf, reportIsEmpty: () => false, reportHighlights: () => [], nextSendAt: vi.fn(), sendPeriod: vi.fn() }));
import { sendDueReports, sendSiteReport } from "./site-report-send";

const brand = { name: "Saved agency", logo: "data:image/png;base64,AAAA" };
const ent = (scheduledReports: boolean, whiteLabel = false, seoKeywords = 10) => ({ modules: { scheduledReports, whiteLabel }, allowances: { seoKeywords } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ent.mockResolvedValue(ent(true));
  mocks.build.mockResolvedValue({ domain: "example.com" });
  mocks.pdf.mockResolvedValue(Buffer.from("pdf"));
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("sitescan_branding") ? [brand] : [] }));
});
it.each([ent(false), ent(false, false, 0), ent(true, false, 0)])("refuses sending without both SEO and scheduled-report access", async (access) => {
  mocks.ent.mockResolvedValue(access);
  await expect(sendSiteReport(1, 2, ["client@example.com"], "weekly")).rejects.toThrow("active plan");
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it.each([false, true])("renders email PDF with branding only when whiteLabel=%s", async (whiteLabel) => {
  mocks.ent.mockResolvedValue(ent(true, whiteLabel));
  await sendSiteReport(1, 2, [], "weekly");
  expect(mocks.pdf).toHaveBeenCalledWith({ domain: "example.com" }, whiteLabel ? brand : null);
  expect(mocks.query.mock.calls.some(([sql]) => /DELETE.*sitescan_branding/.test(sql))).toBe(false);
});
it("defers a downgraded saved schedule without sending or deleting it", async () => {
  mocks.ent.mockResolvedValue(ent(false));
  mocks.query.mockResolvedValueOnce({ rows: [{ site_id: 2, user_id: 1, recipients: ["client@example.com"], frequency: "weekly" }] });
  expect(await sendDueReports()).toBe(0);
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining("interval '1 day'"), [2, expect.any(String)]);
});
