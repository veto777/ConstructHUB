/**
 * The Learn group's Master Class tile (server/dashboard/tiles/learn.ts): "Modules unlocked" follows the course's
 * access rule (server/state-guides.ts courseUnlocks) — an included Master Class or the bundle opens every module,
 * a module purchase opens its category — instead of counting purchase rows, which told an Unlimited account whose
 * every module was open "0 of 4" (re-score, 2026-10-11). The dashboard pool is stubbed; no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dq: vi.fn() }));
vi.mock("../pool", () => ({ dq: mocks.dq, dashboardPool: () => { throw new Error("not in this test"); } }));

import { learnTiles } from "./learn";

const MODULES = [{ id: 11, category: "licensing" }, { id: 12, category: "gmb" }, { id: 13, category: "website" }, { id: 14, category: "seo" }];
const ctx = (masterClass: boolean) => ({ userId: 7, now: new Date(), ent: { modules: { masterClass } }, crm: null } as any);
const tile = async (masterClass: boolean, purchases: { module_id: number | null; is_bundle: boolean | null }[], modules = MODULES) => {
  mocks.dq.mockImplementation(async (sql: string) => (sql.includes("master_class_modules") ? modules : purchases));
  return learnTiles.masterClass!(ctx(masterClass));
};
const owned = (outcome: any) => outcome.status === "ok" ? outcome.metrics[0] : outcome;

beforeEach(() => { mocks.dq.mockReset(); });

describe("Modules unlocked", () => {
  it("an included Master Class (Unlimited) shows every module open with no purchase row, and says why", async () => {
    expect(owned(await tile(true, []))).toMatchObject({ key: "owned", label: "Modules unlocked", value: 4, hint: "of 4 · included in your plan" });
  });
  it("the bundle opens every module", async () => {
    expect(owned(await tile(false, [{ module_id: null, is_bundle: true }]))).toMatchObject({ value: 4, hint: "of 4" });
  });
  it("one module bought is 1 of 4, by the module's category and not by a guessed id", async () => {
    expect(owned(await tile(false, [{ module_id: 13, is_bundle: false }]))).toMatchObject({ value: 1, hint: "of 4" });
    // Two rows for the same module still count one module.
    expect(owned(await tile(false, [{ module_id: 13, is_bundle: false }, { module_id: 13, is_bundle: false }]))).toMatchObject({ value: 1 });
  });
  it("nothing bought and nothing included is honestly 0 of 4", async () => {
    expect(owned(await tile(false, []))).toMatchObject({ value: 0, hint: "of 4" });
  });
  it("a purchase of a module that is no longer active opens nothing", async () => {
    expect(owned(await tile(false, [{ module_id: 99, is_bundle: false }]))).toMatchObject({ value: 0 });
  });
  it("no active modules is the empty tile", async () => {
    expect(await tile(false, [], [])).toEqual({ status: "empty" });
  });
  it("reads only the module table and the account's own purchases", async () => {
    await tile(false, []);
    const calls = mocks.dq.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.includes("FROM master_class_modules WHERE is_active"))).toBe(true);
    expect(calls.some((s) => s.includes("FROM course_purchases WHERE user_id=$1"))).toBe(true);
    expect(mocks.dq.mock.calls.find((c) => (c[0] as string).includes("course_purchases"))?.[1]).toEqual([7]);
  });
});
