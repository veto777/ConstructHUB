/** Apple push sender (server/apns.ts) against a fake APNs on localhost: signed request, topic, tap URL, dead tokens. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http2 from "node:http2";
import { generateKeyPairSync, randomBytes, randomUUID, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "./db";
import { ensureAppPushSchema } from "./app-push";
import { appForLink, pushPayload, pushToUser, pushUrl } from "./apns";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const live = randomBytes(32).toString("hex"), dead = randomBytes(32).toString("hex");
const seen: { headers: http2.IncomingHttpHeaders; body: any }[] = [];
let server: http2.Http2Server, userId: number, sid: string;
const sessions = new Set<http2.ServerHttp2Session>();

beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a6") throw Error("Requires assigned development database");
  server = http2.createServer();
  server.on("session", (s) => { sessions.add(s); s.on("close", () => sessions.delete(s)); });
  server.on("stream", (stream, headers) => {
    let text = "";
    stream.on("data", (d) => { text += d; });
    stream.on("end", () => {
      seen.push({ headers, body: JSON.parse(text) });
      const gone = String(headers[":path"]).endsWith(dead);
      stream.respond({ ":status": gone ? 410 : 200 });
      stream.end(gone ? JSON.stringify({ reason: "Unregistered" }) : "");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "apns-test-"));
  writeFileSync(join(dir, "key.p8"), privateKey.export({ type: "pkcs8", format: "pem" }));
  Object.assign(process.env, {
    APNS_HOST: `http://127.0.0.1:${(server.address() as any).port}`, APNS_KEY_FILE: join(dir, "key.p8"),
    APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "TEAM123456", APP_URL: "https://constructhub.us", PORTAL_URL: "https://portal.constructhub.us",
  });
  await ensureAppPushSchema();
  const { rows: [u] } = await pool.query("INSERT INTO users(email,email_verified) VALUES($1,true) RETURNING id", [`${randomUUID()}@example.invalid`]);
  userId = u.id; sid = randomUUID();
  await pool.query("INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: {}, passport: { user: userId } })]);
  for (const t of [live, dead]) await pool.query("INSERT INTO app_push_tokens(token,user_id,app,platform,session_id) VALUES($1,$2,'platform','ios',$3)", [t, userId, sid]);
}, 30000);

afterAll(async () => {
  await pool.query("DELETE FROM session WHERE sid=$1", [sid]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
  // The sender keeps its connection open on purpose (Apple asks for that); end it so the fake server can stop.
  for (const s of sessions) s.destroy();
  await new Promise((r) => server.close(r));
});

describe("payload", () => {
  it("joins in-app paths to the right app and ignores anything else", () => {
    expect(pushUrl("platform", "/settings?tab=notifications")).toBe("https://constructhub.us/settings?tab=notifications");
    expect(pushUrl("crm", "/crm/clients/7")).toBe("https://portal.constructhub.us/crm/clients/7");
    for (const bad of [null, "", "https://evil.example/x", "//evil.example/x", "javascript:alert(1)"]) expect(pushUrl("crm", bad)).toBe("https://portal.constructhub.us/");
    expect(appForLink("/call-assistant?tab=calls&call=3")).toBe("platform");
    expect(appForLink("/crm/inbox?c=1")).toBe("crm");
    expect(appForLink(null)).toBe("crm");
  });
  it("is an alert with a title, a trimmed body and the tap URL", () => {
    const p = pushPayload("platform", { title: "New review", body: "  5 stars\n from Ann ".repeat(200), link: "/reviews" });
    expect(p.aps.alert).toMatchObject({ title: "New review" });
    expect((p.aps.alert as any).body.length).toBeLessThanOrEqual(400);
    expect(p.url).toBe("https://constructhub.us/reviews");
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(4096);
  });
});

describe("pushToUser", () => {
  it("sends a signed alert to each live phone and deletes tokens Apple calls dead", async () => {
    expect(await pushToUser(userId, "platform", { title: "Janice answered a call", body: "Roof leak, Tacoma", link: "/call-assistant?tab=calls" })).toBe(1);
    expect(seen).toHaveLength(2);
    for (const { headers, body } of seen) {
      expect(headers["apns-topic"]).toBe("us.constructhub.app");
      expect(headers["apns-push-type"]).toBe("alert");
      const [h, c, s] = String(headers.authorization).replace(/^bearer /, "").split(".");
      expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "ES256", kid: "KEYID12345" });
      expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: "TEAM123456" });
      expect(verify("SHA256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
      expect(body).toEqual({ aps: { alert: { title: "Janice answered a call", body: "Roof leak, Tacoma" }, sound: "default" }, url: "https://constructhub.us/call-assistant?tab=calls" });
    }
    const { rows } = await pool.query("SELECT token FROM app_push_tokens WHERE user_id=$1", [userId]);
    expect(rows.map((r) => r.token)).toEqual([live]);
  });
  it("sends nothing to another app's phones, or when the server isn't configured", async () => {
    seen.length = 0;
    expect(await pushToUser(userId, "crm", { title: "x" })).toBe(0);
    const key = process.env.APNS_KEY_ID; delete process.env.APNS_KEY_ID;
    expect(await pushToUser(userId, "platform", { title: "x" })).toBe(0);
    process.env.APNS_KEY_ID = key;
    expect(seen).toHaveLength(0);
  });
});
