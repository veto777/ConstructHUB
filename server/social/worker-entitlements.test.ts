import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), clientQuery: vi.fn(), request: vi.fn(),
  connection: vi.fn(), userLock: vi.fn(), usersWithModule: vi.fn(), getEntitlements: vi.fn(),
}));
vi.mock("../db", () => ({ pool: { query: mocks.query } }));
vi.mock("../entitlements", () => ({ usersWithModule: mocks.usersWithModule, getEntitlements: mocks.getEntitlements }));
vi.mock("./agency", () => ({ runAgencyWorker: vi.fn() }));
vi.mock("./gbp-sources", () => ({ syncGbpSources: vi.fn() }));
vi.mock("../growth-limits", () => ({ takeBudget: vi.fn() }));
vi.mock("../account-events", () => ({ notifyUser: vi.fn(), logActivity: vi.fn() }));
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn() }));
vi.mock("../ai-output", () => ({ aiClient: vi.fn(), aiComplete: vi.fn(), AiAnswerError: class extends Error {}, NO_TOOLS_RULE: "" }));
vi.mock("./schedule", () => ({
  clientFactory: vi.fn(), userLock: mocks.userLock, ownedBusiness: vi.fn(), connection: mocks.connection,
  validateDestinations: vi.fn(), destinationFromPayload: vi.fn(), destinationKey: vi.fn(),
  requestFingerprint: vi.fn(), insertPosts: vi.fn(), createPosts: vi.fn(),
}));
import { runSocialWorker, workerUser } from "./service";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.clientQuery.mockResolvedValue({ rows: [] });
  mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: true, autoPosts: true } });
  mocks.userLock.mockImplementation(async (_id, fn) => fn({ query: mocks.clientQuery }));
  mocks.connection.mockResolvedValue({ client: { hash: "connection", request: mocks.request } });
  mocks.request.mockResolvedValue({ postSubmissionId: "submission" });
});

describe("social worker entitlement scheduling", () => {
  it("reaches eligible work behind 30 paused groups on every tick, without modifying paused work", async () => {
    const groups = Array.from({ length: 32 }, (_, i) => ({ user_id: i + 1, business_id: null }));
    mocks.usersWithModule.mockImplementation(async (ids: number[]) => new Set(ids.filter(id => id > 30)));
    mocks.query.mockImplementation(async (sql: string, params?: number[][]) => {
      if (sql.startsWith("SELECT DISTINCT user_id")) return { rows: groups };
      // Model the query's filter-before-limit contract, including old due groups.
      expect(sql).toMatch(/WHERE user_id=ANY\(\$1::int\[\]\)[\s\S]*GROUP BY[\s\S]*LIMIT 30/);
      expect(sql).toContain("NOT generation OR user_id=ANY($2::int[])");
      return { rows: groups.filter(g => params![0].includes(g.user_id)).slice(0, 30) };
    });
    await runSocialWorker();
    await runSocialWorker();
    expect(mocks.userLock.mock.calls.map(([id]) => id)).toEqual([31, 32, 31, 32]);
    expect(mocks.usersWithModule).toHaveBeenCalledWith(groups.map(g => g.user_id), "socialPublishing");
    expect(mocks.usersWithModule).toHaveBeenCalledWith([31, 32], "autoPosts");
    expect(mocks.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("leaves paused work untouched when nobody qualifies", async () => {
    mocks.query.mockResolvedValue({ rows: [{ user_id: 1 }] });
    mocks.usersWithModule.mockResolvedValue(new Set());
    await runSocialWorker();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.userLock).not.toHaveBeenCalled();
  });

  it("rechecks publishing access inside the owner lock", async () => {
    mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: false, autoPosts: true } });
    await workerUser(1);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it("publishes queued posts without running generation when autoPosts is absent", async () => {
    mocks.getEntitlements.mockResolvedValue({ modules: { socialPublishing: true, autoPosts: false } });
    mocks.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes("state IN ('queued','submitted')")
      ? [{ id: "post", state: "queued", auto_generated: false, payload: { post: {} } }] : [] }));
    const generate = vi.fn();
    await workerUser(1, undefined, generate);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql.startsWith("SELECT * FROM social_settings"))).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith("/posts", { post: {} });
  });

  it("still checks due generation for an entitled owner", async () => {
    await workerUser(1);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      "SELECT * FROM social_settings WHERE user_id=$1 AND business_id IS NOT DISTINCT FROM $2", [1, null],
    );
  });
});
