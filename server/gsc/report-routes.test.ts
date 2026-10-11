import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
vi.mock("../db", () => ({ pool: { query: vi.fn() }, db: {} }));
vi.mock("../entitlements", () => ({
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../growth-limits", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../account-events", () => ({
  logActivity: vi.fn(),
  notifyUser: vi.fn(),
}));
vi.mock("../account-security", () => ({ requireRecentAuth: () => true }));
vi.mock("../cloudflare/service", () => ({}));
vi.mock("../cloudflare/hooks", () => ({}));
vi.mock("./service", () => ({
  dimensions: ["date", "query", "page", "country", "device"],
}));
vi.mock("../cloudflare/common", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ownedAsset: vi.fn(),
  budget: vi.fn(async () => {}),
  pace: vi.fn(async () => {}),
}));
import { pool } from "../db";
import { ownedAsset, ProviderError } from "../cloudflare/common";
import { registerGscRoutes } from "./routes";
import { registerCloudflareRoutes } from "../cloudflare/routes";
const query = vi.mocked(pool.query);
const owned = vi.mocked(ownedAsset);
async function request(path: string, params: Record<string, string> = {}) {
  const app = express();
  registerGscRoutes(app, () => ({ id: 7 }));
  const handler = (app as any).router.stack.find(
    (l: any) => l.route?.path === path,
  ).route.stack[0].handle;
  const res: any = {
    code: 200,
    body: null,
    status(n: number) {
      this.code = n;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  await handler({ params: { id: "12" }, query: params }, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  query.mockReset();
  query.mockResolvedValue({ rows: [] } as any);
  owned.mockResolvedValue({
    id: 12,
    connection_id: 3,
    synced_at: "2026-10-10T10:00:00Z",
  });
});
it("overview queries the complete date dimension and weights CTR and position without pagination", async () => {
  query
    .mockResolvedValueOnce({
      rows: [
        {
          clicks: 12,
          impressions: 100,
          ctr: 0.12,
          position: 4.5,
          first_date: "2026-09-01",
          last_date: "2026-09-30",
        },
      ],
    } as any)
    .mockResolvedValueOnce({
      rows: [{ date: "2026-09-30", clicks: 12 }],
    } as any);
  const r = await request("/api/gsc/assets/:id/overview", {
    start: "2026-09-01",
    end: "2026-09-30",
  });
  expect(r.code).toBe(200);
  expect(r.body.summary).toMatchObject({
    clicks: 12,
    ctr: 0.12,
    position: 4.5,
  });
  expect(owned).toHaveBeenCalledWith(7, 12, "gsc");
  const sql = query.mock.calls[0][0] as string;
  expect(sql).toContain("dimension='date'");
  expect(sql).toContain("sum(position*impressions)/NULLIF(sum(impressions),0)");
  expect(sql).not.toContain("LIMIT");
  expect(query.mock.calls[0][1]).toEqual([12, "2026-09-01", "2026-09-30"]);
});
it("leaves unknown overview metrics null", async () => {
  query
    .mockResolvedValueOnce({
      rows: [{ clicks: null, impressions: null, ctr: null, position: null }],
    } as any)
    .mockResolvedValueOnce({ rows: [] } as any);
  expect(
    (
      await request("/api/gsc/assets/:id/overview", {
        start: "2026-09-01",
        end: "2026-09-30",
      })
    ).body.summary.clicks,
  ).toBeNull();
});
it("rejects reversed date ranges before querying", async () => {
  expect(
    (
      await request("/api/gsc/assets/:id/overview", {
        start: "2026-10-01",
        end: "2026-09-30",
      })
    ).code,
  ).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
it("does not query reports for an inaccessible property", async () => {
  owned.mockRejectedValue(new ProviderError("Site not found", 404));
  expect(
    (
      await request("/api/gsc/assets/:id/overview", {
        start: "2026-09-01",
        end: "2026-09-30",
      })
    ).code,
  ).toBe(404);
  expect(query).not.toHaveBeenCalled();
});
it("keeps sitemap freshness separate from pending and failed analytics", async () => {
  query
    .mockResolvedValueOnce({ rows: [{ kind: "sync", state: "done" }] } as any)
    .mockResolvedValueOnce({
      rows: [{ pending: 4, failed: 1, updated_at: null }],
    } as any);
  const r = await request("/api/gsc/assets/:id/sync-status");
  expect(r.body).toMatchObject({
    syncedAt: "2026-10-10T10:00:00Z",
    analytics: { pending: 4, failed: 1, updated_at: null },
  });
  expect(query.mock.calls[1][1]).toEqual([7, 12]);
});
it("returns a fetch failure instead of an empty overview", async () => {
  query.mockRejectedValueOnce(new Error("database unavailable"));
  const r = await request("/api/gsc/assets/:id/overview", {
    start: "2026-09-01",
    end: "2026-09-30",
  });
  expect(r.code).toBe(500);
  expect(r.body.summary).toBeUndefined();
});
it("zone discovery paginates accounts independently and preserves the default account page", async () => {
  const seen: string[] = [];
  const http = (async (url: string) => {
    seen.push(url);
    return new Response(
      JSON.stringify({
        success: true,
        result: [],
        result_info: { total_count: 200 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const app = express();
  registerCloudflareRoutes(app, () => ({ id: 7 }), http);
  const handler = (app as any).router.stack.find(
    (l: any) => l.route?.path === "/api/cloudflare/key-discovery",
  ).route.stack[0].handle;
  const res: any = { status: () => res, json: vi.fn() };
  await handler(
    {
      body: {
        email: "fixture@example.invalid",
        key: "fixture-key-only",
        page: 4,
        accountPage: 2,
      },
      secure: true,
    },
    res,
  );
  expect(seen.some((url) => url.endsWith("/accounts?page=2&per_page=50"))).toBe(
    true,
  );
  expect(seen.some((url) => url.endsWith("/zones?page=4&per_page=50"))).toBe(
    true,
  );
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ accountPage: 2, accountTotal: 200, page: 4 }),
  );
  seen.length = 0;
  await handler(
    {
      body: {
        email: "fixture@example.invalid",
        key: "fixture-key-only",
        page: 4,
      },
      secure: true,
    },
    res,
  );
  expect(seen.some((url) => url.endsWith("/accounts?page=1&per_page=50"))).toBe(
    true,
  );
});
it("site activity scopes pagination to the owned site", async () => {
  query
    .mockResolvedValueOnce({
      rows: [{ id: 9, kind: "sync", state: "failed" }],
    } as any)
    .mockResolvedValueOnce({ rows: [{ total: 26 }] } as any);
  const r = await request("/api/gsc/assets/:id/activity", {
    page: "2",
    limit: "25",
  });
  expect(r.body.total).toBe(26);
  expect(query.mock.calls[0][1]).toEqual([7, 12, "%%", "", 25, 25]);
});
