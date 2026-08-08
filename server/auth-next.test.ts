/**
 * Open-redirect guard on the Google OAuth `next` param (safeNextPath in
 * server/auth.ts). Browsers resolve `Location: /\evil.com` (and `//evil.com`)
 * off-origin, so a lax `/^\/[^\/]/` check was an open redirect — the guard
 * must reject anything but a plain same-origin path.
 *
 * Part 1 is pure unit tests of the validator — no server needed.
 * Part 2 exercises the running dev server: GET /api/auth/google?next=… must
 * only stash vetted paths in the session (authNext). Google itself is never
 * contacted — the assertion is on what lands in the session table, so a
 * dummy/unreachable Google config doesn't matter.
 *
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { safeNextPath } from "./auth";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: any[] = []) => pool.query(text, params);

afterAll(async () => {
  await pool.end();
});

describe("safeNextPath (unit)", () => {
  it("accepts plain same-origin paths", () => {
    expect(safeNextPath("/crm/join?token=abc")).toBe("/crm/join?token=abc");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/settings/billing#plans")).toBe("/settings/billing#plans");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/\\\\/evil.com",
    "%2f%2f",
    "javascript:alert(1)",
    " /crm/join?token=abc",
    "\t/crm/join",
    "/crm/\tevil",
    "evil.com",
    "",
    undefined,
    null,
  ])("rejects %j", (bad) => {
    expect(safeNextPath(bad as any)).toBeNull();
  });
});

describe("GET /api/auth/google next stashing", () => {
  beforeAll(async () => {
    const r = await fetch(`${BASE}/api/crm/me`);
    expect(r.status, "dev server reachable").toBe(200);
  });

  /** Returns the authNext the request stashed in its session row, if any. */
  async function stashedNext(next: string) {
    const r = await fetch(`${BASE}/api/auth/google?next=${encodeURIComponent(next)}`, {
      redirect: "manual",
    });
    const setCookie = r.headers.get("set-cookie") || "";
    const m = setCookie.match(/connect\.sid=([^;]+)/);
    if (!m) return { authNext: undefined as any, hadCookie: false };
    // Cookie value is "s:<sid>.<signature>", URI-encoded.
    const sid = decodeURIComponent(m[1]).slice(2).split(".")[0];
    try {
      const { rows } = await q(`select sess from "session" where sid = $1`, [sid]);
      return { authNext: rows[0]?.sess?.authNext, hadCookie: true };
    } finally {
      await q(`delete from "session" where sid = $1`, [sid]);
    }
  }

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/\\\\/evil.com",
    "%2f%2f",
    "javascript:alert(1)",
    " /crm/join?token=abc",
  ])("never stashes %j", async (bad) => {
    const { authNext } = await stashedNext(bad);
    expect(authNext).toBeUndefined();
  });

  it("stashes a plain same-origin path", async () => {
    const { authNext, hadCookie } = await stashedNext("/crm/join?token=abc");
    expect(hadCookie).toBe(true);
    expect(authNext).toBe("/crm/join?token=abc");
  });
});
