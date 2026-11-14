/**
 * gscToken's refresh: only Google refusing the grant means "Reconnect Search Console" (401, never retried by the
 * worker). The token endpoint being unavailable (5xx, 429) is the default 502, which the worker retries. Audit M9.
 */
import { expect, it, vi } from "vitest";
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, db: {} }));
vi.mock("../growth-limits", () => ({ takeBudget: vi.fn() }));
import { gscToken } from "./service";
import { encryptToken } from "../gbp/token-crypto";

const conn = () => ({ id: 1, user_id: 1, token: null, expires_at: new Date(0), refresh_token: encryptToken("refresh-fixture") });
const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

it("treats an unavailable token endpoint as retryable, not as a lost grant", async () => {
  for (const status of [500, 503, 429]) {
    await expect(gscToken(conn(), answer(status, { error: "backend_error" }))).rejects.toMatchObject({ message: "Search Console token refresh unavailable", status: 502 });
  }
});

it("asks to reconnect only when Google refuses the grant", async () => {
  for (const status of [400, 401]) {
    await expect(gscToken(conn(), answer(status, { error: "invalid_grant" }))).rejects.toMatchObject({ message: "Reconnect Search Console", status: 401 });
  }
  await expect(gscToken(conn(), answer(200, { access_token: "a", scope: "openid", expires_in: 3600 }))).rejects.toMatchObject({ status: 401 });
});
