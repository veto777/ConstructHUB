import { beforeEach, describe, it, expect, vi } from "vitest";
// Register real handlers but replace external dependencies: no app boot or database connection.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../crm/admin", () => ({
  platformGatePassed: vi.fn(() => true),
  ADMIN_REAUTH_BODY: { message: "re-authenticate" },
}));
vi.mock("../growth-limits", () => ({ takeBudget: vi.fn(async () => true) }));
vi.mock("../gbp/listing-editor", () => ({ loadListing: vi.fn() }));
import { registerListingsRoutes } from "./routes";
import { pool } from "../db";
import { platformGatePassed } from "../crm/admin";
function harness(user: any = { id: 1 }, actor: any = { id: 1 }) {
  const handlers = new Map<string, any>();
  const app: any = Object.fromEntries(
    ["get", "put", "post", "patch"].map((method) => [
      method,
      (path: string, fn: any) => handlers.set(`${method} ${path}`, fn),
    ]),
  );
  const store: any = Object.fromEntries(
    [
      "profile",
      "saveProfile",
      "location",
      "directories",
      "summary",
      "list",
      "add",
      "recheck",
      "events",
      "saveDirectory",
      "adminProfiles",
    ].map((k) => [k, vi.fn(async () => [])]),
  );
  registerListingsRoutes(
    app,
    (_req, res) => {
      if (!user) {
        res.status(401).json({ message: "Not authenticated" });
        return null;
      }
      return user;
    },
    { store },
  );
  const call = async (method: string, path: string, input: any = {}) => {
    const res: any = {
      locals: {},
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: any) {
        this.body = value;
        return this;
      },
    };
    await handlers.get(`${method} /api/listings${path}`)(
      {
        user: actor,
        params: { locationId: "2", id: "4" },
        query: {},
        body: {},
        ...input,
      },
      res,
    );
    return res;
  };
  return { store, call };
}
describe("signed-in API and trusted scope", () => {
  it("requires authentication on every route", async () => {
    const { call, store } = harness(null, null);
    for (const [method, path] of [
      ["get", ""],
      ["post", ""],
      ["get", "/profiles/:locationId"],
      ["put", "/profiles/:locationId"],
      ["post", "/profiles/:locationId/import-from-gbp"],
      ["post", "/:id/recheck"],
      ["get", "/summary"],
      ["get", "/directories"],
      ["get", "/profiles/:locationId/events"],
    ])
      expect((await call(method, path)).statusCode).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  });
  it("uses workspace account but authenticates admin privileges against the actual actor", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "customer@example.com" }],
    } as never);
    const { call, store } = harness(
      { id: 22, email: "support@constructhub.us" },
      { id: 1 },
    );
    await call("get", "");
    expect(pool.query).toHaveBeenLastCalledWith(
      "SELECT email FROM users WHERE id=$1",
      [1],
    );
    expect(store.list).toHaveBeenCalledWith(
      { userId: 22, actorId: 1, admin: false },
      { limit: 50, offset: 0 },
    );
  });
  it("gives platform admins cross-account scope only after the existing gate", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "support@constructhub.us" }],
    } as never);
    const { call, store } = harness({ id: 3 }, { id: 3 });
    await call("get", "/summary");
    expect(store.summary).toHaveBeenCalledWith(
      { userId: 3, actorId: 3, admin: true },
      undefined,
    );
    vi.mocked(platformGatePassed).mockReturnValue(false);
    expect((await call("get", "")).statusCode).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
    vi.mocked(platformGatePassed).mockReturnValue(true);
  });
  it("rejects client billability, statuses, account injection and unsafe URLs", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "customer@example.com" }],
    } as never);
    const { call, store } = harness();
    for (const body of [
      {
        profile_id: 1,
        directory_id: 2,
        listing_url: "https://yelp.com/a",
        billable: true,
      },
      { profile_id: 1, directory_id: 2, listing_url: "http://127.0.0.1/" },
      { profile_id: 1, directory_id: 2, listing_url: "file:///etc/passwd" },
    ])
      expect((await call("post", "", { body })).statusCode).toBe(400);
    expect(
      (
        await call("put", "/profiles/:locationId", {
          body: { user_id: 2, name: "Other" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await call("get", "", { query: { user_id: 2 } })).statusCode).toBe(
      400,
    );
    expect(store.add).not.toHaveBeenCalled();
    expect(store.saveProfile).not.toHaveBeenCalled();
  });
  it("passes validated profile edits and the trusted account scope", async () => {
    const { call, store } = harness();
    expect(
      (
        await call("put", "/profiles/:locationId", {
          body: { name: "Owner edited", phone: null },
        })
      ).statusCode,
    ).toBe(200);
    expect(store.saveProfile).toHaveBeenCalledWith(
      { userId: 1, actorId: 1, admin: false },
      2,
      { name: "Owner edited", phone: null },
    );
  });
});

const validDirectory = {
  name: "Test directory",
  domain: "directory.example.com",
  kind: "submission",
  tier: 4,
  category: "contractor",
  source: "https://directory.example.com/about",
};
describe("admin directory and profile endpoints", () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "support@constructhub.us" }],
    } as never);
    vi.mocked(platformGatePassed).mockReturnValue(true);
  });
  const endpoints = [
    ["post", "/directories"],
    ["patch", "/directories/:id"],
    ["get", "/admin/profiles"],
  ];
  it("requires sign-in for every new endpoint", async () => {
    const { call } = harness(null, null);
    for (const [method, path] of endpoints)
      expect((await call(method, path)).statusCode).toBe(401);
  });
  it("denies customers even when the projected workspace owner is an admin", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "customer@example.com" }],
    } as never);
    const { call, store } = harness(
      { id: 22, email: "support@constructhub.us" },
      { id: 1 },
    );
    for (const [method, path] of endpoints)
      expect(
        (await call(method, path, { body: validDirectory })).statusCode,
      ).toBe(403);
    expect(store.saveDirectory).not.toHaveBeenCalled();
    expect(store.adminProfiles).not.toHaveBeenCalled();
  });
  it("requires the platform gate on every admin endpoint", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ email: "support@constructhub.us" }],
    } as never);
    vi.mocked(platformGatePassed).mockReturnValue(false);
    try {
      const { call, store } = harness();
      for (const [method, path] of endpoints)
        expect(
          (await call(method, path, { body: validDirectory })).statusCode,
        ).toBe(403);
      expect(store.saveDirectory).not.toHaveBeenCalled();
      expect(store.adminProfiles).not.toHaveBeenCalled();
    } finally {
      vi.mocked(platformGatePassed).mockReturnValue(true);
    }
  });
  it("passes actual actor admin scope and validated data", async () => {
    const { call, store } = harness({ id: 22 }, { id: 3 });
    expect(
      (await call("post", "/directories", { body: validDirectory })).statusCode,
    ).toBe(201);
    expect(store.saveDirectory).toHaveBeenCalledWith(
      { userId: 22, actorId: 3, admin: true },
      null,
      validDirectory,
    );
    expect(
      (await call("patch", "/directories/:id", { body: { active: false } }))
        .statusCode,
    ).toBe(200);
    expect(store.saveDirectory).toHaveBeenLastCalledWith(
      { userId: 22, actorId: 3, admin: true },
      4,
      { active: false },
    );
    await call("get", "/admin/profiles", {
      query: { limit: "10", offset: "20" },
    });
    expect(store.adminProfiles).toHaveBeenCalledWith(
      { userId: 22, actorId: 3, admin: true },
      { limit: 10, offset: 20 },
    );
  });
  it("rejects unsafe domains, sources, metadata, assertions, scope and paging injection", async () => {
    const { call, store } = harness();
    for (const domain of [
      "127.0.0.1",
      "localhost",
      "metadata.google.internal",
      "foo.local",
      "*.example.com",
      "https://yelp.com",
      "yelp.com/path",
      "yelp.com@evil.com",
      "foo..com",
    ]) {
      expect(
        (
          await call("post", "/directories", {
            body: { ...validDirectory, domain },
          })
        ).statusCode,
      ).toBe(400);
    }
    for (const body of [
      {},
      { billable: true },
      { status: "live" },
      { user_id: 2 },
      { source: "file:///etc/passwd" },
      { source: "http://127.0.0.1" },
      { tier: 5 },
      { active: "true" },
      { states: ["New York"] },
      { category: "invented" },
    ]) {
      expect(
        (await call("patch", "/directories/:id", { body })).statusCode,
      ).toBe(400);
    }
    for (const query of [{ user_id: 2 }, { limit: 201 }, { offset: -1 }])
      expect((await call("get", "/admin/profiles", { query })).statusCode).toBe(
        400,
      );
    expect(store.saveDirectory).not.toHaveBeenCalled();
    expect(store.adminProfiles).not.toHaveBeenCalled();
  });
});
