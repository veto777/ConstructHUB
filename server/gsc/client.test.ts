import { it, expect } from "vitest";
import { SearchConsoleClient } from "./client";
const client = (body: string | null, status = 200) =>
  new SearchConsoleClient(
    async () => "fixture-token",
    (async () => new Response(body, { status })) as typeof fetch,
    async () => {},
  );
it("accepts empty successful sitemap submission responses", async () => {
  expect(
    await client("").call("/sites/example/sitemaps/example", "PUT"),
  ).toEqual({});
  expect(
    await client(null, 204).call("/sites/example/sitemaps/example", "PUT"),
  ).toEqual({});
});
it("does not turn an empty sites response into fabricated empty discovery", async () => {
  await expect(client("").call("/sites")).rejects.toThrow("request failed");
});
it("returns actionable auth and quota errors without reflecting provider secrets", async () => {
  await expect(
    client('{"error":{"message":"fixture-token"}}', 401).call("/sites"),
  ).rejects.toThrow("Reconnect Search Console");
  await expect(
    client('{"error":{"message":"fixture-token"}}', 429).call("/sites"),
  ).rejects.toMatchObject({
    status: 429,
    message: "Search Console quota reached",
  });
});
