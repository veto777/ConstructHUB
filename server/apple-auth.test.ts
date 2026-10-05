/** Sign in with Apple (server/apple-auth.ts): Apple's token checks, and the app-only sign-in route on real sessions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { pool } from "./db";
import { verifyAppleToken, APPLE_ISSUER } from "./apple-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as any), kid: "apple-test", kty: "RSA", alg: "RS256", use: "sig" };
const keys = async () => [jwk];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newNonce = () => randomBytes(32).toString("base64url");

function appleToken(claims: Record<string, unknown>, opts: { key?: any; header?: Record<string, unknown> } = {}) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b(opts.header ?? { alg: "RS256", kid: "apple-test" })}.${b(claims)}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(opts.key ?? privateKey).toString("base64url")}`;
}
function claimsFor(nonce: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: APPLE_ISSUER, aud: "us.constructhub.app", iat: now, exp: now + 600, sub: "000123.test", nonce: sha(nonce),
    email: "someone@privaterelay.appleid.com", email_verified: "true", ...extra };
}

describe("verifyAppleToken: only Apple's token, for our apps, for this sign-in", () => {
  it("accepts a good token for either app", async () => {
    const n = newNonce();
    await expect(verifyAppleToken(appleToken(claimsFor(n)), n, { keys })).resolves.toMatchObject({ sub: "000123.test" });
    await expect(verifyAppleToken(appleToken(claimsFor(n, { aud: "us.constructhub.crm" })), n, { keys })).resolves.toBeTruthy();
  });
  it("refuses everything else", async () => {
    const n = newNonce(), now = Math.floor(Date.now() / 1000);
    const bad: [string, Record<string, unknown>][] = [
      ["another app", { aud: "us.remindrapp.ios" }], ["another issuer", { iss: "https://evil.example" }],
      ["expired", { exp: now - 1 }], ["issued in the future", { iat: now + 3600 }],
      ["another sign-in's nonce", { nonce: sha(newNonce()) }], ["no nonce", { nonce: undefined }], ["no subject", { sub: "" }],
    ];
    for (const [why, patch] of bad) await expect(verifyAppleToken(appleToken(claimsFor(n, patch)), n, { keys }), why).rejects.toThrow();
    await expect(verifyAppleToken(appleToken(claimsFor(n), { key: other.privateKey }), n, { keys }), "forged").rejects.toThrow(/signature/);
    await expect(verifyAppleToken(appleToken(claimsFor(n), { header: { alg: "none", kid: "apple-test" } }), n, { keys }), "alg none").rejects.toThrow();
    await expect(verifyAppleToken(appleToken(claimsFor(n), { header: { alg: "RS256", kid: "nope" } }), n, { keys }), "unknown key").rejects.toThrow();
    await expect(verifyAppleToken("not.a.jwt", n, { keys }), "garbage").rejects.toThrow();
  });
});

describe("POST /api/auth/apple", () => {
  let child: ChildProcess, base: string;
  const APP_UA = "Mozilla/5.0 (iPhone) ConstructHUBApp/1.0";
  const subs = [`000001.${randomUUID()}`, `000002.${randomUUID()}`, `000003.${randomUUID()}`];
  const emails = [`apple-new-${randomUUID()}@privaterelay.appleid.com`, `apple-existing-${randomUUID()}@example.invalid`];
  const ip = `198.18.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
  let existingId = 0;

  async function signIn(sub: string, email: string, opts: { ua?: string; cookie?: string; purpose?: string; token?: string; nonce?: string } = {}) {
    const nonce = opts.nonce ?? newNonce();
    const token = opts.token ?? appleToken(claimsFor(nonce, { sub, email }));
    const res = await fetch(`${base}/api/auth/apple`, {
      method: "POST", body: JSON.stringify({ identityToken: token, nonce, givenName: "Pat", familyName: "Builder", purpose: opts.purpose ?? "login", next: "/crm" }),
      headers: { "content-type": "application/json", "user-agent": opts.ua ?? APP_UA, "x-forwarded-for": ip, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    return { res, body: await res.json().catch(() => ({})), cookie, token, nonce };
  }
  const me = async (cookie: string) => (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a6") throw Error("Requires assigned development database");
    child = spawn(process.execPath, ["--import", "tsx", "server/test-fixtures/app-auth-server.ts"], {
      env: { ...process.env, NODE_ENV: "test", SESSION_SECRET: "apple-auth-fixture", GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
        DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", EMAIL_FORCE_SINK: "1", APP_TEST_APPLE_JWKS: JSON.stringify([jwk]),
        APPLE_SIGNIN_KEY_ID: "", APPLE_SIGNIN_KEY_FILE: "" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let logs = ""; child.stderr?.on("data", (b) => { logs += b; });
    base = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(Error(logs)), 30000);
      child.once("message", (m: any) => { clearTimeout(t); resolve(`http://127.0.0.1:${m.port}`); });
      child.once("exit", () => { clearTimeout(t); reject(Error(logs)); });
    });
    const { rows: [u] } = await pool.query("INSERT INTO users(email,email_verified) VALUES($1,false) RETURNING id", [emails[1]]);
    existingId = u.id;
  }, 40000);

  afterAll(async () => {
    if (child && child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    const { rows } = await pool.query("SELECT user_id FROM user_apple_ids WHERE sub=ANY($1::text[])", [subs]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[]) OR lower(email)=ANY($2::text[])", [[existingId, ...rows.map((r) => r.user_id)], emails]);
    await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'apple-signin:%'");
    await pool.end();
  });

  it("is only for the iPhone apps", async () => {
    const r = await signIn(subs[0], emails[0], { ua: "Mozilla/5.0 Safari" });
    expect(r.res.status).toBe(403);
    expect(r.body.code).toBe("app_only");
  });

  it("creates a verified account on the first sign-in, signs it in, and never takes the same token twice", async () => {
    const first = await signIn(subs[0], emails[0]);
    expect(first.res.status).toBe(200);
    expect(first.body).toEqual({ ok: true, next: "/crm" });
    const user = await me(first.cookie);
    expect(user.email).toBe(emails[0]);
    const { rows: [row] } = await pool.query("SELECT email_verified, display_name FROM users WHERE id=$1", [user.id]);
    expect(row).toEqual({ email_verified: true, display_name: "Pat Builder" });
    const replay = await signIn(subs[0], emails[0], { token: first.token, nonce: first.nonce });
    expect(replay.res.status).toBe(401);
    const again = await signIn(subs[0], emails[0]);
    expect((await me(again.cookie)).id).toBe(user.id);
  });

  it("links to the open account with the same Apple-verified email", async () => {
    const r = await signIn(subs[1], emails[1]);
    expect(r.res.status).toBe(200);
    expect((await me(r.cookie)).id).toBe(existingId);
    const { rows: [row] } = await pool.query("SELECT email_verified FROM users WHERE id=$1", [existingId]);
    expect(row.email_verified).toBe(true);
  });

  it("re-verifies only with the Apple ID linked to the signed-in account", async () => {
    const login = await signIn(subs[1], emails[1]);
    expect((await signIn(subs[1], emails[1], { cookie: login.cookie, purpose: "reauth" })).res.status).toBe(200);
    expect((await signIn(subs[0], emails[0], { cookie: login.cookie, purpose: "reauth" })).res.status).toBe(403);
    expect((await signIn(subs[1], emails[1], { purpose: "reauth" })).res.status).toBe(401);
  });

  it("refuses an unverified email and a closed account", async () => {
    const n = newNonce();
    const unverified = await signIn(subs[2], `x-${randomUUID()}@example.invalid`, { nonce: n, token: appleToken(claimsFor(n, { sub: subs[2], email: "x@example.invalid", email_verified: "false" })) });
    expect(unverified.res.status).toBe(403);
    await pool.query("UPDATE users SET deletion_requested_at=now() WHERE id=$1", [existingId]);
    expect((await signIn(subs[1], emails[1])).res.status).toBe(403);
  });
});
