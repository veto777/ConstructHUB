import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), take: vi.fn() }));
vi.mock("./db", () => ({ pool: { query: mocks.query }, db: {} }));
vi.mock("./auth", () => ({ getBaseUrl: () => "http://localhost" }));
vi.mock("./growth-limits", () => ({ actorKey: (req: any) => `user:${req.user?.id}`, takeBudget: mocks.take }));
import { planLimit, reserveMonthlyQuota } from "./growth-quotas";
describe("documented growth quotas", () => {
  it("uses the catalog photo/search/ranking limits, including unlimited plans", () => {
    expect(planLimit("standard", "photos")).toBe(5);
    expect(planLimit("professional", "photos")).toBe(25);
    expect(planLimit("business", "photos")).toBe(50);
    expect(planLimit("premium", "photos")).toBe(-1);
    expect(planLimit("professional", "rankings")).toBe(10);
    expect(planLimit("standard", "searches")).toBe(50);
  });
  it("reserves the entire photo batch before processing and rejects exhausted quotas", async () => {
    mocks.query.mockResolvedValue({ rows: [{ plan: "professional", status: "active" }] });
    mocks.take.mockResolvedValue(false);
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    expect(await reserveMonthlyQuota({ user: { id: 42 } } as any, res, "photos", 10)).toBe(false);
    expect(mocks.take.mock.calls.at(-1)?.slice(1,3)).toEqual([25, 10]);
    expect(res.status).toHaveBeenCalledWith(403);
    mocks.take.mockResolvedValue(true);
    expect(await reserveMonthlyQuota({ user: { id: 42 } } as any, res, "photos", 1)).toBe(true);
  });
});
