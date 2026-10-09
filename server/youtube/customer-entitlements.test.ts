import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), usersWithModule: vi.fn() }));
vi.mock("../db", () => ({ pool: { query: mocks.query } }));
vi.mock("../entitlements", () => ({ usersWithModule: mocks.usersWithModule }));
import { claimNextUpload, filesToDelete, requeueUpload } from "./customer-store";

beforeEach(() => vi.resetAllMocks());

describe("customer upload claims", () => {
  it("filters all owners before taking the oldest slot, keeping paused owners out of the claim", async () => {
    const owners = Array.from({ length: 40 }, (_, i) => ({ user_id: i + 1 }));
    mocks.query.mockResolvedValueOnce({ rows: owners }).mockResolvedValueOnce({ rows: [{ id: "eligible", user_id: 40, state: "uploading", bytes: 10, sent_bytes: 0 }] });
    mocks.usersWithModule.mockResolvedValue(new Set([40]));
    expect(await claimNextUpload()).toMatchObject({ id: "eligible", user_id: 40 });
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/LIMIT/);
    expect(mocks.usersWithModule).toHaveBeenCalledWith(owners.map((r) => r.user_id), "socialPublishing");
    const [sql, params] = mocks.query.mock.calls[1];
    expect(sql).toMatch(/state = 'queued' AND user_id = ANY\(\$1::int\[\]\).*ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1/s);
    expect(params).toEqual([[40]]);
  });

  it("leaves paused work untouched and claims it on a later pass after resubscription", async () => {
    mocks.query.mockResolvedValue({ rows: [{ user_id: 1 }] });
    mocks.usersWithModule.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set([1]));
    expect(await claimNextUpload()).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    mocks.query.mockResolvedValueOnce({ rows: [{ user_id: 1 }] }).mockResolvedValueOnce({ rows: [{ id: "resumed", user_id: 1 }] });
    expect(await claimNextUpload()).toMatchObject({ id: "resumed" });
    expect(mocks.query.mock.calls[2][1]).toEqual([[1]]);
  });

  it("does not claim anything if entitlement resolution fails", async () => {
    mocks.query.mockResolvedValue({ rows: [{ user_id: 1 }] });
    mocks.usersWithModule.mockRejectedValue(new Error("unavailable"));
    await expect(claimNextUpload()).rejects.toThrow("unavailable");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("releases only an uploading lease without changing its queue order, quota reservation or file", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await requeueUpload("paused");
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/SET state = 'queued', lease_until = NULL, updated_at = now\(\)/);
    expect(sql).toMatch(/WHERE id = \$1 AND state = 'uploading'/);
    expect(sql).not.toMatch(/queued_at|quota_|storage_|file_deleted_at|DELETE/);
    expect(params).toEqual(["paused"]);
    await filesToDelete();
    expect(mocks.query.mock.calls[1][0]).toContain("state NOT IN ('uploading','queued')");
  });
});
