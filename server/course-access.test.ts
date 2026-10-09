import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ hasModule: vi.fn(), where: vi.fn(), select: vi.fn() }));
vi.mock("./entitlements", () => ({ hasModule: mocks.hasModule }));
vi.mock("./db", () => ({ db: { select: mocks.select } }));
import { getCourseAccess } from "./course-access";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  mocks.where.mockResolvedValue([]);
  mocks.hasModule.mockResolvedValue(false);
});
it("signed-out visitors have no access and never query account data", async () => {
  expect(await getCourseAccess(null)).toEqual({ included: false, purchases: [] });
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.hasModule).not.toHaveBeenCalled();
});
it("Unlimited access does not require or manufacture a purchase", async () => {
  mocks.hasModule.mockResolvedValue(true);
  expect(await getCourseAccess(42)).toEqual({ included: true, purchases: [] });
  expect(mocks.hasModule).toHaveBeenCalledWith(42, "masterClass");
});
it("downgrading removes subscription access and preserves purchased modules and bundles", async () => {
  const purchases = [{ moduleId: 1, isBundle: false }, { moduleId: null, isBundle: true }];
  mocks.where.mockResolvedValue(purchases);
  expect(await getCourseAccess(42)).toEqual({ included: false, purchases });
});
it("an account with neither entitlement nor purchases stays locked", async () => {
  expect(await getCourseAccess(42)).toEqual({ included: false, purchases: [] });
});
it("entitlement lookup failures fail closed", async () => {
  mocks.hasModule.mockRejectedValue(new Error("unavailable"));
  await expect(getCourseAccess(42)).rejects.toThrow("unavailable");
});

// Exercise the page's real unlock calculation without booting its large UI tree.
import { readFileSync } from "node:fs";
import ts from "typescript";
const page = readFileSync(new URL("../client/src/pages/master-class.tsx", import.meta.url), "utf8");
const from = page.indexOf("  const purchases = courseAccess?.purchases;");
const to = page.indexOf("  const enrollMutation", from);
const unlockJs = ts.transpileModule(page.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const unlock = new Function("courseAccess", "isDev", "TAB_MODULE_MAP", unlockJs + "\nreturn { hasBundle, isTabUnlocked };");
it.each([
  [{ included: true, purchases: [] }, true, true],
  [{ included: false, purchases: [{ moduleId: 1, isBundle: false }] }, true, false],
  [{ included: false, purchases: [{ moduleId: null, isBundle: true }] }, true, true],
  [{ included: false, purchases: [] }, false, false],
  [undefined, false, false],
])("the production page respects included access and permanent purchases: %j", (access, first, second) => {
  const result = unlock(access, false, { first: 1, second: 2 });
  expect(result.isTabUnlocked("first")).toBe(first);
  expect(result.isTabUnlocked("second")).toBe(second);
  expect(result.isTabUnlocked("public")).toBe(true);
});
