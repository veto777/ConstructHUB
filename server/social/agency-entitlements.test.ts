import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), clientQuery: vi.fn(), release: vi.fn(), getEntitlements: vi.fn(),
  ownedBusiness: vi.fn(), generateDue: vi.fn(), createPosts: vi.fn(), saveSettings: vi.fn(),
  connection: vi.fn(), userLock: vi.fn(),
}));
vi.mock("../db", () => ({ pool: {
  query: mocks.query, connect: async () => ({ query: mocks.clientQuery, release: mocks.release }),
} }));
vi.mock("../entitlements", () => ({
  getEntitlements: mocks.getEntitlements, planPausedMessage: (module: string) => `Paused: ${module}`,
}));
vi.mock("../account-events", () => ({ logActivity: vi.fn() }));
vi.mock("./gbp-sources", () => ({ syncGbpSources: vi.fn() }));
vi.mock("./service", () => ({
  ...mocks, clientFactory: vi.fn(), generateText: vi.fn(), destinationKey: vi.fn(),
}));
import { runAgencyWorker } from "./agency";

const job = (kind: string, id = 1) => ({
  id, user_id: 42, business_id: 7, kind, connection_hash: "connection", destinations: [],
  payload: { requestId: "550e8400-e29b-41d4-a716-446655440000", businessIds: [7], kind, text: "Business update" },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.clientQuery.mockImplementation(async (sql: string) => ({
    rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [], rowCount: 1,
  }));
  mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: true, autoPosts: true } });
  mocks.ownedBusiness.mockResolvedValue({ business_name: "Builder", city: "Denver", phone: "555" });
  mocks.connection.mockResolvedValue({ client: { hash: "connection" } });
  mocks.userLock.mockImplementation(async (_id, fn) => fn({ query: mocks.clientQuery }));
  mocks.generateDue.mockImplementation(async (_c, _id, generate) => generate({}));
});

describe("bulk social execution entitlements", () => {
  it.each(["post", "settings", "sync", "generate"])("cancels queued %s after publishing access lapses", async kind => {
    mocks.query.mockResolvedValueOnce({ rows: [job(kind)] });
    mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: false, autoPosts: true } });
    const generate = vi.fn();
    await runAgencyWorker(generate);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      "UPDATE social_bulk_jobs SET state='cancelled',error=$2 WHERE id=$1 AND state='queued'", [1, "Paused: socialPublishing"],
    );
    expect(mocks.ownedBusiness).not.toHaveBeenCalled();
    expect(mocks.generateDue).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.clientQuery).toHaveBeenCalledWith("SELECT pg_advisory_unlock(8160,$1::int)", [1]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it.each(["settings", "generate"])("requires autoPosts for %s even with publishing access", async kind => {
    mocks.query.mockResolvedValueOnce({ rows: [job(kind)] });
    mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: true, autoPosts: false } });
    await runAgencyWorker(vi.fn());
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      "UPDATE social_bulk_jobs SET state='cancelled',error=$2 WHERE id=$1 AND state='queued'", [1, "Paused: autoPosts"],
    );
    expect(mocks.generateDue).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("rechecks each job so a lapse during the batch prevents later paid generation", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [job("generate", 1), job("generate", 2)] });
    mocks.getEntitlements.mockResolvedValueOnce({ modules: { socialPublishing: true, autoPosts: true } })
      .mockResolvedValueOnce({ modules: { socialPublishing: false, autoPosts: false } });
    const generate = vi.fn(async () => "Draft");
    await runAgencyWorker(generate);
    expect(generate).toHaveBeenCalledOnce();
    expect(mocks.generateDue).toHaveBeenCalledWith(expect.anything(), 42, generate, true, 7);
    expect(mocks.clientQuery).toHaveBeenCalledWith("UPDATE social_bulk_jobs SET state='done',error=NULL WHERE id=$1", [1]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      "UPDATE social_bulk_jobs SET state='cancelled',error=$2 WHERE id=$1 AND state='queued'", [2, "Paused: socialPublishing"],
    );
  });

  it("allows manual bulk posts without autoPosts", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [job("post")] });
    mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: true, autoPosts: false } });
    await runAgencyWorker(vi.fn());
    expect(mocks.createPosts).toHaveBeenCalledOnce();
    expect(mocks.clientQuery).toHaveBeenCalledWith("UPDATE social_bulk_jobs SET state='done',error=NULL WHERE id=$1", [1]);
  });
});
