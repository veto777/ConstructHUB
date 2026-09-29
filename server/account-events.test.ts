import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "./db";
import { ensureAccountEventsSchema, notifyUser, logActivity, channelsFor } from "./account-events";
let userId: number;
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)) throw new Error("requires a local development DB");
  await ensureAccountEventsSchema();
  ({ rows: [{ id: userId }] } = await pool.query("INSERT INTO users(email) VALUES('acct-events-'||gen_random_uuid()::text||'@example.invalid') RETURNING id"));
});
afterAll(async () => { await pool.query("DELETE FROM users WHERE id=$1", [userId]); await pool.end(); });
describe("account events", () => {
  it("security kinds always email; ordinary kinds follow preferences", async () => {
    await pool.query("INSERT INTO user_notification_prefs(user_id,kind,in_app,email) VALUES($1,'google.connected',false,false),($1,'gbp.new_review',false,false)", [userId]);
    expect(await channelsFor(userId, "google.connected")).toEqual({ inApp: false, email: true });
    expect(await channelsFor(userId, "gbp.new_review")).toEqual({ inApp: false, email: false });
    await notifyUser(userId, "gbp.new_review", { title: "muted" });
    await notifyUser(userId, "gbp.profile_change", { title: "Profile changed", severity: "warning" });
    const { rows } = await pool.query("SELECT kind,title FROM user_notifications WHERE user_id=$1", [userId]);
    expect(rows).toEqual([{ kind: "gbp.profile_change", title: "Profile changed" }]);
  });
  it("records who, what and from where", async () => {
    await logActivity({ ip: "10.0.0.1", headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "UA" } }, userId, "google.connected", { email: "a@example.invalid" });
    const { rows: [a] } = await pool.query("SELECT kind,detail,ip,user_agent FROM account_activity WHERE user_id=$1", [userId]);
    expect(a).toMatchObject({ kind: "google.connected", detail: { email: "a@example.invalid" }, ip: "203.0.113.9", user_agent: "UA" });
  });
});
