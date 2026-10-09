import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";

// Execute the report handlers in isolation: importing the full route registry boots
// unrelated providers. Keep the actual callbacks and brand resolver under test.
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const section = source.slice(source.indexOf("  const brandOf ="), source.indexOf("  // Usage history:", source.indexOf("  const brandOf =")));
const js = ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const save = vi.fn(), render = vi.fn(), query = vi.fn(), send = vi.fn();
const denied = vi.fn((res, module) => res.status(402).json({ module }));
new Function("route", "pool", "ownedSite", "buildSiteReport", "getSchedule", "reportHighlights", "reportIsEmpty", "optedOut", "renderReportPdf", "scheduleInput", "saveSchedule", "sendModuleRequired", "takeBudget", "sendSiteReport", "MAX_RECIPIENTS", js)(
  (_method: string, path: string, fn: any) => handlers.set(path, fn), { query }, async () => ({ id: 2, domain: "example.com" }), async () => ({ domain: "example.com" }), async () => ({}), () => [], () => false, async () => [], render,
  { parse: (x: any) => x, pick: () => ({ parse: (x: any) => x }) }, save, denied, async () => true, send, 10,
);
const response = () => { const res: any = {}; for (const key of ["status", "json", "type", "setHeader", "send"]) res[key] = vi.fn(() => res); return res; };
const access = (scheduledReports: boolean, whiteLabel = false) => ({ modules: { scheduledReports, whiteLabel } });
beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [{ name: "Saved brand", logo: "saved-logo" }] });
  render.mockResolvedValue(Buffer.from("pdf"));
});
it.each(["weekly", "monthly"])("refuses enabling %s for Solo plus SEO", async (frequency) => {
  const res = response();
  await handlers.get("/api/seo/sites/:id/report/schedule")!({ params: { id: 2 }, body: { frequency, recipients: ["client@example.com"] } }, res, 1, access(false));
  expect(denied).toHaveBeenCalledWith(res, "scheduledReports");
  expect(save).not.toHaveBeenCalled();
});
it.each([[false, "off"], [true, "weekly"], [true, "monthly"]])("access=%s permits frequency=%s", async (enabled, frequency) => {
  const input = { frequency, recipients: ["client@example.com"] };
  await handlers.get("/api/seo/sites/:id/report/schedule")!({ params: { id: 2 }, body: input }, response(), 1, access(enabled as boolean));
  expect(save).toHaveBeenCalledWith(1, 2, input);
});
it("refuses send-now before spending a send or sending email", async () => {
  const res = response();
  await handlers.get("/api/seo/sites/:id/report/send")!({}, res, 1, access(false));
  expect(denied).toHaveBeenCalledWith(res, "scheduledReports");
  expect(send).not.toHaveBeenCalled();
});
it.each([false, true])("download branding requires whiteLabel=%s", async (whiteLabel) => {
  await handlers.get("/api/seo/sites/:id/report.pdf")!({ params: { id: 2 } }, response(), 1, access(true, whiteLabel));
  expect(render).toHaveBeenCalledWith({ domain: "example.com" }, whiteLabel ? { name: "Saved brand", logo: "saved-logo" } : null);
  expect(query).toHaveBeenCalledTimes(whiteLabel ? 1 : 0);
});
