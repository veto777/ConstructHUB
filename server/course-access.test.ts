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

// The page's real unlock rule (client/src/components/master-class/access.ts), fed by the server's resolved
// answer (server/state-guides.ts courseUnlocks): the page never maps a purchase to a tab by a guessed id.
import { courseUnlocks } from "./state-guides";
import { resolveTab, tabUnlocked, unlockReason, type CourseAccess } from "@/components/master-class/access";
const MODULES = [{ id: 1, category: "licensing" }, { id: 2, category: "gmb" }, { id: 3, category: "website" }, { id: 4, category: "seo" }];
const resolved = (access: { included: boolean; purchases: { moduleId: number | null; isBundle: boolean | null }[] }): CourseAccess =>
  ({ ...access, purchases: access.purchases as CourseAccess["purchases"], ...courseUnlocks(access, MODULES), signedIn: true });

it.each([
  // included on the plan → every home, including the bonus vetting lessons
  [{ included: true, purchases: [] }, { "state-guide": true, gmb: true, website: true, seo: true, vetting: true }],
  // one module → its home and the bonus lessons only
  [{ included: false, purchases: [{ moduleId: 1, isBundle: false }] }, { "state-guide": true, gmb: false, website: false, seo: false, vetting: true }],
  [{ included: false, purchases: [{ moduleId: 2, isBundle: false }] }, { "state-guide": false, gmb: true, website: false, seo: false, vetting: true }],
  // the bundle → everything
  [{ included: false, purchases: [{ moduleId: null, isBundle: true }] }, { "state-guide": true, gmb: true, website: true, seo: true, vetting: true }],
  // nothing → nothing paid
  [{ included: false, purchases: [] }, { "state-guide": false, gmb: false, website: false, seo: false, vetting: false }],
])("the page respects included access and permanent purchases: %j", (access, expected) => {
  const a = resolved(access);
  for (const [tab, open] of Object.entries(expected)) expect(tabUnlocked(a, tab as any), tab).toBe(open);
  expect(tabUnlocked(a, "overview")).toBe(true);
  expect(tabUnlocked(a, "pricing")).toBe(true);
});

it("without a successful access answer nothing paid is open — loading or failed is not 'not bought'", () => {
  for (const tab of ["state-guide", "gmb", "website", "seo", "vetting"] as const) {
    expect(tabUnlocked(undefined, tab)).toBe(false);
    expect(tabUnlocked(null, tab)).toBe(false);
  }
  expect(tabUnlocked(undefined, "overview")).toBe(true);
});

it("says why a module is open in the words the page uses", () => {
  expect(unlockReason(resolved({ included: true, purchases: [] }), "gmb")).toBe("included");
  expect(unlockReason(resolved({ included: false, purchases: [{ moduleId: 2, isBundle: false }] }), "gmb")).toBe("purchased");
  expect(unlockReason(resolved({ included: false, purchases: [{ moduleId: 2, isBundle: false }] }), "seo")).toBeNull();
  const preview: CourseAccess = { included: false, purchases: [], ...courseUnlocks({ included: false, purchases: [] }, MODULES, true), signedIn: true };
  expect(unlockReason(preview, "seo")).toBe("preview");
});

it("old ?tab= links still open a real tab", () => {
  expect(resolveTab("website-seo")).toBe("website");
  expect(resolveTab("pricing")).toBe("pricing");
  expect(resolveTab("nonsense")).toBe("overview");
  expect(resolveTab(null)).toBe("overview");
});
