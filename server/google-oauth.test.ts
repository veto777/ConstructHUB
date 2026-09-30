import { pool } from "./db";
import { randomBytes, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
const base = process.env.CRM_TEST_BASE_URL || "http://127.0.0.1:8149";
describe("Google OAuth request binding", () => {
  it.each([""])("uses session state and rejects an unbound callback %s", async suffix => {
    const start = await fetch(`${base}/api/auth/google${suffix}`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get("location")!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toBeTruthy();
    if (suffix) expect(url.searchParams.get("scope")).toContain("business.manage");
    const cookie = start.headers.get("set-cookie")!.split(";")[0];
    // Invalid state is checked before attempting any Google token exchange.
    const callback = await fetch(`${base}/api/auth/google/callback?code=local-fixture&state=wrong`, {
      redirect: "manual", headers: { cookie },
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/auth?error=google-failed");
  });
  it.each(["server_error", "temporarily_unavailable", "access_denied"])("sends Google error=%s back to the sign-in page, never raw JSON", async error => {
    const res = await fetch(`${base}/api/auth/google/callback?error=${error}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth?error=google-failed");
  });
  it("offers a single-use Google step-up to the signed-in user that never signs anyone in", async () => {
    // The dev server signs anonymous requests in as user 1 (DEV_AUTH_BYPASS_USER1).
    const me = await (await fetch(`${base}/api/auth/me`)).json();
    expect(me?.id, "dev auth bypass user").toBeTruthy();
    const start = await fetch(`${base}/api/auth/google?reauth=1&next=${encodeURIComponent("/locations?tab=x")}`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get("location")!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("login_hint")).toBe(me.email);
    const cookie = start.headers.get("set-cookie")!.split(";")[0];
    // A failed or forged round-trip returns to the page with a flag; the session keeps its user.
    const failed = await fetch(`${base}/api/auth/google/callback?code=fixture&state=wrong`, { redirect: "manual", headers: { cookie } });
    expect(failed.status).toBe(302);
    expect(failed.headers.get("location")).toBe("/locations?tab=x&reauth=google-failed");
    const again = await fetch(`${base}/api/auth/google/callback?code=fixture&state=wrong`, { redirect: "manual", headers: { cookie } });
    expect(again.headers.get("location")).toBe("/auth?error=google-failed");
  });
  it("binds GBP consent separately and rejects invalid state before token exchange", async () => {
    const legacy = await fetch(`${base}/api/auth/google?gbp=1`, {redirect:"manual"});
    expect(legacy.headers.get("location")).toBe("/api/gbp/connect");
    const denied = await fetch(`${base}/api/gbp/connect`, {redirect:"manual"});
    expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({reauth:true});
    const sid=randomBytes(24).toString('hex');
    await pool.query(`INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '5 minutes')`,[sid,JSON.stringify({cookie:{maxAge:300000},passport:{user:1},recentAuth:{userId:1,at:Date.now()}})]);
    const signed='s:'+sid+'.'+createHmac('sha256',process.env.SESSION_SECRET!).update(sid).digest('base64').replace(/=+$/,'');
    const cookie='connect.sid='+encodeURIComponent(signed);
    const start = await fetch(`${base}/api/gbp/connect`, {redirect:"manual",headers:{cookie}});
    const url = new URL(start.headers.get("location")!);
    expect(url.searchParams.get("scope")).toContain("business.manage");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/gbp/callback");
    const callback = await fetch(`${base}/api/gbp/callback?code=fixture&state=wrong`,{redirect:"manual",headers:{cookie}});
    expect(callback.headers.get("location")).toBe("/locations?gbp=consent-failed");
    await pool.query("DELETE FROM session WHERE sid=$1",[sid]);
  });
});
