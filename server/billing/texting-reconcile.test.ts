import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), reconcile: vi.fn() }));
vi.mock("../db", () => ({ pool: { query: state.query }, db: {} }));
vi.mock("./schema", () => ({ ensureBillingSchema: vi.fn() }));
vi.mock("../crm/sms", () => ({ reconcileTextingNumbers: state.reconcile }));
import { recordCancellation } from "./sync";
beforeEach(() => { vi.clearAllMocks(); state.query.mockResolvedValue({ rows: [{ user_id: 7 }] }); });
describe("subscription persistence texting hook", () => {
  it.each([null, { cancel_at_period_end: false, cancel_at: null }, { cancel_at_period_end: true, cancel_at: 1000 }])("reconciles effective entitlements after persisted state %j", async sub => {
    await recordCancellation({ id: 12 }, sub as any);
    expect(state.query.mock.calls[0][0]).toContain("RETURNING user_id");
    expect(state.reconcile).toHaveBeenCalledWith(7);
    expect(state.query.mock.invocationCallOrder[0]).toBeLessThan(state.reconcile.mock.invocationCallOrder[0]);
  });
  it("does not reconcile a missing subscription row", async () => {
    state.query.mockResolvedValue({ rows: [] });
    await recordCancellation({ userId: 7 }, null);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("propagates reconciliation failure for webhook retry", async () => {
    state.reconcile.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(recordCancellation({ userId: 7 }, null)).rejects.toThrow("database unavailable");
  });
});
