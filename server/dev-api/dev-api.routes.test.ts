/**
 * The Code API end to end, in-process, on a dev lane DB and a throwaway
 * "GitHub" (a local bare repo):
 *   - issuing needs a platform admin, our Origin, a Google-linked account and a
 *     Google re-verification from the last 15 minutes; hours are 24–48 only
 *   - the token reads the code, cannot see secrets, commits to its own branch
 *     (pushed), and cannot write CI config or outside its scope
 *   - submit, revoke (401 afterwards), expiry, and the audit trail
 *
 *   - and the authenticator code: two-step must be on, the code must be right, a code works once
 *
 * Run with DATABASE_URL on a constructhub_dev* lane, DEV_AUTH_BYPASS_USER1=true and NODE_ENV=development.
 * Skipped otherwise. User 1's google_id and two-step settings are set for the run and restored after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";

const DB = process.env.DATABASE_URL ?? "";
const enabled = /constructhub_dev/.test(DB) && process.env.DEV_AUTH_BYPASS_USER1 === "true" && process.env.NODE_ENV !== "production";

describe.skipIf(!enabled)("Code API routes", () => {
  let server: Server, base = "", root = "", origin = "";
  let pool: any, oldGoogleId: string | null = null, oldTotp: { totp_enabled: boolean; totp_secret: string | null } | null = null;
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({ issuer: "ConstructHUB", algorithm: "SHA1", digits: 6, period: 30, secret });
  // A valid code not used yet, made when it is needed (the check accepts one step either side).
  const usedCodes = new Set<string>();
  const freshCode = () => {
    for (const d of [0, -30_000, 30_000]) {
      const c = totp.generate({ timestamp: Date.now() + d });
      if (!usedCodes.has(c)) { usedCodes.add(c); return c; }
    }
    throw new Error("no unused code in the current window");
  };
  const session: any = {};
  const issued: string[] = [];
  const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "devapi-routes-"));
    origin = join(root, "origin.git");
    g(root, "init", "--bare", "--quiet", "-b", "main", origin);
    const seed = join(root, "seed");
    g(root, "init", "--quiet", "-b", "main", seed);
    mkdirSync(join(seed, "server"), { recursive: true });
    writeFileSync(join(seed, "server", "routes.ts"), "export const a = 1;\n");
    writeFileSync(join(seed, ".env.example"), "X=1\n");
    g(seed, "add", "-A");
    g(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "seed");
    g(seed, "push", "--quiet", origin, "main");

    const { createRepo } = await import("./repo");
    const repo = createRepo({ url: origin, sshKey: null, dir: join(root, "clone.git"), base: "main", githubRepo: "veto777/ConstructHUB" });
    ({ pool } = await import("../db"));
    const { ensureDevApiSchema } = await import("./tokens");
    await ensureDevApiSchema();
    const { rows: [u] } = await pool.query("SELECT google_id FROM users WHERE id=1");
    oldGoogleId = u?.google_id ?? null;
    if (!oldGoogleId) await pool.query("UPDATE users SET google_id=$1 WHERE id=1", [`devapi-test-${Date.now()}`]);
    ({ rows: [oldTotp] } = await pool.query("SELECT totp_enabled, totp_secret FROM users WHERE id=1"));
    await pool.query("UPDATE users SET totp_enabled=false WHERE id=1"); // first: two-step off

    const { registerDevApi } = await import("./routes");
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use((req: any, _res, next) => {
      req.session = session;
      if (req.headers["x-test-user"] === "1") req.user = { id: 1, email: "dev@constructhub.local" };
      next();
    });
    const getUser = (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null);
    registerDevApi(app as any, getUser, { repo: () => repo });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (pool) {
      if (issued.length) {
        await pool.query("DELETE FROM dev_api_audit WHERE token_id = ANY($1)", [issued]);
        await pool.query("DELETE FROM dev_api_tokens WHERE id = ANY($1)", [issued]);
      }
      if (!oldGoogleId) await pool.query("UPDATE users SET google_id=NULL WHERE id=1 AND google_id LIKE 'devapi-test-%'");
      if (oldTotp) await pool.query("UPDATE users SET totp_enabled=$1, totp_secret=$2 WHERE id=1", [oldTotp.totp_enabled, oldTotp.totp_secret]);
    }
    rmSync(root, { recursive: true, force: true });
  });

  const admin = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { "x-test-user": "1", "content-type": "application/json", origin: base }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const api = (token: string, method: string, path: string, body?: unknown) => fetch(`${base}/api/dev/v1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const issue = { name: "Codex test agent", holderType: "agent", hours: 24, scopes: ["read", "write"] };
  let token = "", tokenId = "", branch = "";

  it("refuses to issue without a session, without our Origin, or without a Google re-check", async () => {
    expect((await fetch(`${base}/api/admin/dev-tokens`, { method: "POST" })).status).toBe(401);
    const noOrigin = await fetch(`${base}/api/admin/dev-tokens`, { method: "POST", headers: { "x-test-user": "1", "content-type": "application/json" }, body: JSON.stringify(issue) });
    expect(noOrigin.status).toBe(403);
    const noGoogle = await admin("POST", "/api/admin/dev-tokens", issue);
    expect(noGoogle.status).toBe(403);
    expect((await noGoogle.json()).google).toBe("verify");
    session.googleVerified = { userId: 1, at: Date.now() - 16 * 60_000 }; // stale
    expect((await admin("POST", "/api/admin/dev-tokens", issue)).status).toBe(403);
  });

  it("after Google, still needs two-step on and the right authenticator code, once", async () => {
    session.googleVerified = { userId: 1, at: Date.now() };
    const off = await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode: "123456" });
    expect(off.status).toBe(403);
    expect((await off.json()).totp).toBe("setup");
    expect((await (await admin("GET", "/api/admin/dev-tokens")).json()).verification.totpEnabled).toBe(false);
    const { encryptToken } = await import("../gbp/token-crypto");
    await pool.query("UPDATE users SET totp_enabled=true, totp_secret=$1 WHERE id=1", [encryptToken(secret.base32)]);
    for (const totpCode of [undefined, "12345", "000000"]) {
      const res = await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode });
      expect(res.status, String(totpCode)).toBe(403);
      expect((await res.json()).totp).toBe("invalid");
    }
  });

  it("issues a 24–48 hour token after Google + code, shown once, on its own pushed branch", async () => {
    session.googleVerified = { userId: 1, at: Date.now() };
    const code = freshCode();
    expect((await admin("POST", "/api/admin/dev-tokens", { ...issue, hours: 72, totpCode: code })).status).toBe(400);
    const res = await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode: code });
    expect(res.status).toBe(201);
    const body = await res.json();
    token = body.token; tokenId = body.item.id; branch = body.item.branch; issued.push(tokenId);
    expect(token).toMatch(/^chdev_[a-z0-9]{8}_[a-f0-9]{64}$/);
    expect(body.apiUrl).toMatch(/\/api\/dev\/v1$/);
    const hours = (new Date(body.item.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9); expect(hours).toBeLessThanOrEqual(24);
    expect(g(origin, "rev-parse", branch)).toBe(g(origin, "rev-parse", "main"));
    const list = await (await admin("GET", "/api/admin/dev-tokens")).json();
    const item = list.tokens.find((t: any) => t.id === tokenId);
    expect(item.status).toBe("live");
    expect(JSON.stringify(list)).not.toContain(token.slice(15));
    expect(list.verification.googleLinked).toBe(true);
    expect(list.verification.totpEnabled).toBe(true);
    // The same code cannot issue a second token (a 4th strike; the right code cleared the earlier 3).
    expect((await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode: code })).status).toBe(403);
  });

  it("reads the code, never secrets", async () => {
    expect((await api("chdev_aaaaaaaa_" + "0".repeat(64), "GET", "/me")).status).toBe(401);
    const me = await (await api(token, "GET", "/me")).json();
    expect(me.branch).toBe(branch);
    const file = await (await api(token, "GET", "/files?path=server/routes.ts")).json();
    expect(file.content).toBe("export const a = 1;\n");
    const tree = await (await api(token, "GET", "/tree")).json();
    expect(tree.entries.map((e: any) => e.path)).toEqual(["server"]);
    expect((await api(token, "GET", "/files?path=.env.example")).status).toBe(403);
    expect((await api(token, "GET", "/files?path=../etc/passwd")).status).toBe(400);
  });

  it("commits to its branch only, and cannot touch CI or secrets", async () => {
    const res = await api(token, "POST", "/commits", { message: "Bump a", changes: [{ path: "server/routes.ts", content: "export const a = 2;\n" }, { path: "scripts/x.sh", content: "echo hi\n", executable: true }] });
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(g(origin, "rev-parse", branch)).toBe(out.commit);
    expect(g(origin, "show", "main:server/routes.ts")).toBe("export const a = 1;");
    expect(g(origin, "log", "-1", "--format=%B", branch)).toContain(`Code-API-Token: ${tokenId}`);
    expect(out.changed.find((c: any) => c.path === "scripts/x.sh").sensitive).toBe(true);
    expect((await api(token, "POST", "/commits", { message: "ci", changes: [{ path: ".github/workflows/x.yml", content: "on: push" }] })).status).toBe(403);
    expect((await api(token, "POST", "/commits", { message: "env", changes: [{ path: ".env", content: "A=1" }] })).status).toBe(403);
    const diff = await (await api(token, "GET", "/diff")).json();
    expect(diff.files.map((f: any) => f.path).sort()).toEqual(["scripts/x.sh", "server/routes.ts"]);
    expect(diff.sensitive).toEqual(["scripts/x.sh"]);
    const sub = await api(token, "POST", "/submit", { note: "ready" });
    expect(sub.status).toBe(200);
    const act = await (await admin("GET", `/api/admin/dev-tokens/${tokenId}/activity`)).json();
    expect(act.commits).toHaveLength(1);
    expect(act.requests.some((r: any) => r.method === "POST" && r.path.endsWith("/commits") && r.status === 201)).toBe(true);
  });

  it("a read-only token cannot write", async () => {
    session.googleVerified = { userId: 1, at: Date.now() };
    const body = await (await admin("POST", "/api/admin/dev-tokens", { ...issue, name: "Reader", scopes: ["read"], hours: 48, totpCode: freshCode() })).json();
    issued.push(body.item.id);
    expect((await api(body.token, "GET", "/me")).status).toBe(200);
    expect((await api(body.token, "POST", "/commits", { message: "x", changes: [{ path: "a.ts", content: "x" }] })).status).toBe(403);
  });

  it("five wrong codes lock issuing for 15 minutes", async () => {
    session.googleVerified = { userId: 1, at: Date.now() };
    for (let i = 0; i < 5; i++) expect((await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode: "000000" })).status).toBe(403);
    const locked = await admin("POST", "/api/admin/dev-tokens", { ...issue, totpCode: freshCode() });
    expect(locked.status).toBe(429);
    expect((await locked.json()).totp).toBe("locked");
  });

  it("revoked and expired tokens stop at once", async () => {
    expect((await admin("DELETE", `/api/admin/dev-tokens/${tokenId}`)).status).toBe(200);
    expect((await api(token, "GET", "/me")).status).toBe(401);
    const { newTokenIdentity, insertToken } = await import("./tokens");
    const id = newTokenIdentity();
    const row = await insertToken(id, { name: "Expiring", holderType: "agent", hours: 24, scopes: ["read"] }, "0".repeat(40), { id: 1, email: "dev@constructhub.local" });
    issued.push(row.id);
    expect((await api(id.token, "GET", "/me")).status).not.toBe(401);
    await pool.query("UPDATE dev_api_tokens SET expires_at = now() - interval '1 second' WHERE id=$1", [row.id]);
    expect((await api(id.token, "GET", "/me")).status).toBe(401);
    // The branches stay on GitHub for review.
    expect(g(origin, "rev-parse", branch)).toMatch(/^[0-9a-f]{40}$/);
  });
});
