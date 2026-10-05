import { beforeAll, afterAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "./db";
import { mintAppCode } from "./app-auth";
import { encryptToken } from "./gbp/token-crypto";
import { TOTP } from "otpauth";
let child: ChildProcess, base: string;
const ids: number[] = [], cookies = new Set<string>();
const ip = `198.19.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`;
// RFC 7636 Appendix B test vector.
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const secret = "app-auth-owned-fixture";
process.env.SESSION_SECRET = secret;
const totp = new TOTP({ issuer: "ConstructHUB", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 });
async function api(path: string, cookie = "", init: RequestInit = {}) {
  const response = await fetch(base + path, { ...init, redirect: "manual", headers: { cookie, "x-forwarded-for": ip, ...init.headers } });
  const set = response.headers.get("set-cookie")?.split(";")[0];
  if (set) cookies.add(set);
  return response;
}
const cookieOf = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] || "";
async function google(user: number, next = "/locations", app = true) {
  const r = await api(`/api/auth/google?${app ? `app=1&challenge=${challenge}&challenge_method=S256&` : ""}next=${encodeURIComponent(next)}`);
  const state = new URL(r.headers.get("location")!).searchParams.get("state");
  return api(`/api/auth/google/callback?code=fixture-${ids[user]}&state=${state}`, cookieOf(r));
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a6") throw Error("Requires assigned development database");
  child = spawn(process.execPath, ["--import", "tsx", "server/test-fixtures/app-auth-server.ts"], {
    env: { ...process.env, NODE_ENV: "test", SESSION_SECRET: secret, GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", EMAIL_FORCE_SINK: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let logs = "";
  child.stdout?.on("data", b => { logs += b; }); child.stderr?.on("data", b => { logs += b; });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(logs || "Server startup timed out")), 30000);
    child.once("message", (m: any) => { clearTimeout(timer); resolve(`http://127.0.0.1:${m.port}`); });
    child.once("exit", () => { clearTimeout(timer); reject(Error(logs)); });
  });
  for (let i=0; i<2; i++) {
    const { rows: [u] } = await pool.query("INSERT INTO users(email,email_verified,totp_enabled,totp_secret) VALUES($1,true,$2,$3) RETURNING id", [`${randomUUID()}@example.invalid`, i===1, i===1 ? encryptToken(totp.secret.base32) : null]);
    ids.push(u.id); await pool.query("UPDATE users SET google_id=$1 WHERE id=$2", [`fixture-${u.id}`, u.id]);
  }
}, 40000);
afterAll(async () => {
  if (child && child.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
  for (const cookie of cookies) {
    const sid = decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0];
    await pool.query("DELETE FROM session WHERE sid=$1", [sid]);
  }
  await pool.query("DELETE FROM account_activity WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1::text[]) OR key LIKE ANY($2::text[])", [[`app-auth-exchange:ip:${createHash('sha256').update(ip).digest('hex')}`, `growth-auth:ip:${createHash('sha256').update(ip).digest('hex')}`], ids.flatMap(id => [`%:user:${id}`])]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await pool.end();
});
it("keeps Passport state verification and the website redirect", async () => {
  const bad = await api(`/api/auth/google/callback?code=fixture-${ids[0]}&state=wrong`);
  expect(bad.headers.get("location")).toBe("/auth?error=google-failed");
  const web = await google(0, "/locations", false);
  expect(web.headers.get("location")).toBe("/locations");
  expect((await (await api("/api/auth/me", cookieOf(web))).json()).id).toBe(ids[0]);
});
it("moves Google identity from the sheet to a separate web-view cookie jar exactly once", async () => {
  const sheet = await google(0);
  const callback = new URL(sheet.headers.get("location")!);
  expect(callback.protocol).toBe("constructhub:");
  const code = callback.searchParams.get("code")!;
  expect(code).toMatch(/^[a-f0-9]{64}$/);
  const { rows: [stored] } = await pool.query("SELECT * FROM app_auth_codes WHERE user_id=$1", [ids[0]]);
  expect(stored.challenge).toBe(challenge);
  expect(stored.code_hash).toBe(createHash("sha256").update(code).digest("hex"));
  const exchange = await api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`);
  expect(exchange.headers.get("location")).toBe("/locations");
  expect((await (await api("/api/auth/me", cookieOf(exchange))).json()).id).toBe(ids[0]);
  expect((await api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`)).status).toBe(400);
});
it("rejects wrong hosts, expired codes, unsafe next, and concurrent replay", async () => {
  const wrong = await mintAppCode(ids[0], "portal.constructhub.us", "login", challenge, "/");
  expect((await api(`/api/auth/app-exchange?code=${wrong}&verifier=${verifier}`)).status).toBe(400);
  const expired = await mintAppCode(ids[0], "127.0.0.1", "login", challenge, "/");
  await pool.query("UPDATE app_auth_codes SET expires_at=now()-interval '1 second' WHERE code_hash=$1", [createHash("sha256").update(expired).digest("hex")]);
  expect((await api(`/api/auth/app-exchange?code=${expired}&verifier=${verifier}`)).status).toBe(400);
  const code = await mintAppCode(ids[0], "127.0.0.1", "login", challenge, "//evil.invalid/");
  const results = await Promise.all([api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`), api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`)]);
  expect(results.map(r=>r.status).sort()).toEqual([302,400]);
  expect(results.find(r=>r.status===302)?.headers.get("location")).toBe("/");
});
it("requires the existing second factor before the web view becomes signed in", async () => {
  const sheet = await google(1, "/crm/team");
  const code = new URL(sheet.headers.get("location")!).searchParams.get("code");
  const exchange = await api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`);
  expect(exchange.headers.get("location")).toBe("/auth?mode=2fa&next=%2Fcrm%2Fteam");
  const cookie = cookieOf(exchange);
  expect(await (await api("/api/auth/me", cookie)).json()).toBeNull();
  const verified = await api("/api/auth/2fa/login", cookie, { method:"POST", headers: {"content-type":"application/json"}, body: JSON.stringify({code:totp.generate()}) });
  expect(verified.status).toBe(200);
  expect((await (await api("/api/auth/me", cookieOf(verified))).json()).id).toBe(ids[1]);
});

it("requires a well-formed S256 challenge at app sign-in start", async () => {
  for (const query of ["", `&challenge=${challenge}`, `&challenge=${challenge}&challenge_method=plain`,
    "&challenge=short&challenge_method=S256", `&challenge=${"!".repeat(43)}&challenge_method=S256`,
    `&challenge=${challenge}&challenge=${challenge}&challenge_method=S256`]) {
    expect((await api(`/api/auth/google?app=1${query}`)).status).toBe(400);
  }
});
it("burns the code on a wrong, missing or malformed verifier", async () => {
  for (const supplied of ["", "&verifier=short", `&verifier=${"x".repeat(43)}`, `&verifier=${verifier}&verifier=${verifier}`]) {
    const sheet = await google(0);
    const code = new URL(sheet.headers.get("location")!).searchParams.get("code");
    expect((await api(`/api/auth/app-exchange?code=${code}${supplied}`)).status).toBe(400);
    expect((await api(`/api/auth/app-exchange?code=${code}&verifier=${verifier}`)).status).toBe(400);
  }
});
