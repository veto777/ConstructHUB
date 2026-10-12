/** Data deletion callbacks (server/social/deletion.ts): Meta's signed_request, and the deletion on the dev database. */
import { afterAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { pool } from "../db";
import { deleteForExternalUser, deletionStatus, ensureDeletionSchema, newConfirmationCode, parseSignedRequest, secretsFor } from "./deletion";
import { ensureNativeSchema } from "./native";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signed(payload: object, secret: string) {
  const p = b64url(JSON.stringify(payload));
  return `${b64url(createHmac("sha256", secret).update(p).digest())}.${p}`;
}
const SECRET = "8fbbcd3be2301d4194fa4795910a2470-test";

describe("Meta signed_request", () => {
  const good = signed({ algorithm: "HMAC-SHA256", issued_at: 1791800000, user_id: "122131265457169997" }, SECRET);
  it("accepts a request signed with one of our secrets and returns the user id", () => {
    expect(parseSignedRequest(good, ["some-other-secret-0000", SECRET])?.user_id).toBe("122131265457169997");
  });
  it("refuses a wrong secret, a tampered payload, junk and a wrong algorithm", () => {
    expect(parseSignedRequest(good, ["not-the-secret-000000"])).toBeNull();
    const [sig, payload] = good.split(".");
    const tampered = `${sig}.${b64url(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999" }))}`;
    expect(parseSignedRequest(tampered, [SECRET])).toBeNull();
    expect(parseSignedRequest(`${sig}.${payload}x`, [SECRET])).toBeNull();
    expect(parseSignedRequest("nodot", [SECRET])).toBeNull();
    expect(parseSignedRequest(undefined, [SECRET])).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: "HMAC-SHA1", user_id: "1" }, SECRET), [SECRET])).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: "HMAC-SHA256", user_id: "../x" }, SECRET), [SECRET])).toBeNull();
  });
  it("uses the right app secret for each network, skipping unset ones", () => {
    const env = { SOCIAL_META_APP_SECRET: "m".repeat(32), SOCIAL_THREADS_APP_SECRET: "t".repeat(32) } as any;
    expect(secretsFor("meta", env)).toEqual(["m".repeat(32)]);
    expect(secretsFor("threads", env)).toEqual(["t".repeat(32), "m".repeat(32)]);
    expect(secretsFor("instagram", env)).toEqual([]);
  });
  it("makes readable confirmation codes", () => {
    expect(newConfirmationCode()).toMatch(/^[2-9A-HJ-NP-Z]{12}$/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("deleting what a network names (development database)", () => {
  const tenant = "chu999998b0";
  afterAll(async () => {
    await pool.query("DELETE FROM social_native_accounts WHERE tenant=$1", [tenant]);
    await pool.query("DELETE FROM social_deletion_requests WHERE external_user_id IN ('7700001','7700002')");
  });
  it("deletes the person's connected accounts on that network only and records a completed request", async () => {
    await ensureNativeSchema();
    await ensureDeletionSchema();
    await pool.query("DELETE FROM social_native_accounts WHERE tenant=$1", [tenant]);
    const ins = "INSERT INTO social_native_accounts(id,tenant,platform,external_id,name,token_enc,owner_user_id) VALUES($1,$2,$3,$4,$5,'x',$6)";
    await pool.query(ins, ["t-fb", tenant, "facebook", "1336027662933910", "Construct HUB", "7700001"]);
    await pool.query(ins, ["t-ig", tenant, "instagram", "17841467935668597", "@constructhubapp", "7700001"]);
    await pool.query(ins, ["t-th", tenant, "threads", "555", "@constructhubapp", "7700001"]);
    await pool.query(ins, ["t-other", tenant, "facebook", "222", "Other person's Page", "7700002"]);

    const { code, deleted } = await deleteForExternalUser("meta", "7700001");
    expect(deleted).toBe(2);
    const { rows } = await pool.query("SELECT id FROM social_native_accounts WHERE tenant=$1 ORDER BY id", [tenant]);
    expect(rows.map((r) => r.id)).toEqual(["t-other", "t-th"]);   // Threads is its own app; another person untouched
    expect(await deletionStatus(code)).toMatchObject({ status: "completed" });
    expect(await deletionStatus("NOSUCHCODE")).toBeNull();

    expect((await deleteForExternalUser("threads", "7700001")).deleted).toBe(1);
  });
});
