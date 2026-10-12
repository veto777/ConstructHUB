import { expect, it, vi } from "vitest";
import { postSchema } from "../../shared/social";
import { loadComposerDraft, saveComposerDraft } from "../../client/src/components/social-drafts";

it.skipIf(!process.env.DATABASE_URL)("replays a restored accepted submission into exactly one database post per destination", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port === "5433" || url.pathname !== "/constructhub_dev_fs") {
    throw new Error("Recovery integration test requires the local constructhub_dev_fs lane database, never port 5433");
  }
  const { pool } = await import("../db");
  const { ensureSocialSchema } = await import("./schema");
  const { encryptKey } = await import("./client");
  const { NativeClient, NATIVE_MARK } = await import("./native");
  const { tenantFor } = await import("./outstand");
  const { createPosts } = await import("./schedule");
  vi.stubEnv("SOCIAL_ENCRYPTION_KEY", "ab".repeat(32));
  const memory = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  } });
  let owner: number | undefined;
  try {
    await ensureSocialSchema();
    owner = (await pool.query("INSERT INTO users(email) VALUES('recovery-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows[0].id;
    const business = (await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'Submission recovery fixture') RETURNING id", [owner])).rows[0].id;
    const submission = postSchema.parse({
      requestId: crypto.randomUUID(), text: "Recovery fixture", draft: true,
      destinations: [{ accountId: "recovery-x", platform: "twitter" }, { accountId: "recovery-threads", platform: "threads" }],
      tweaks: { threads: "Threads recovery fixture" },
    });
    const tenant = tenantFor(owner!, business);
    const fixtureKey = NATIVE_MARK + tenant;
    await pool.query("INSERT INTO social_connections(user_id,business_id,key_enc,accounts) VALUES($1,$2,$3,$4::jsonb)", [
      owner, business, encryptKey(fixtureKey, owner!), JSON.stringify(submission.destinations.map(d => ({ id: d.accountId, platform: d.platform }))),
    ]);
    await pool.query("INSERT INTO social_business_config(user_id,business_id,destinations,connection_hash) VALUES($1,$2,$3::jsonb,$4)", [
      owner, business, JSON.stringify(submission.destinations), new NativeClient(tenant).hash,
    ]);
    saveComposerDraft(owner, String(business), { text: submission.text, tweaks: submission.tweaks, destinations: submission.destinations, schedule: "", mediaText: "", submission });
    const accepted = await createPosts(owner!, submission, business);
    // The browser never receives this result; returning to the page restores its saved request.
    const restored = loadComposerDraft(owner, String(business))!;
    const retried = await createPosts(owner!, restored.submission, business);
    expect(retried.map(p => p.id).sort()).toEqual(accepted.map(p => p.id).sort());
    const { rows } = await pool.query("SELECT destination_key, count(*)::int AS count FROM social_posts WHERE user_id=$1 AND business_id=$2 AND request_id=$3 GROUP BY destination_key", [owner, business, submission.requestId]);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.count === 1)).toBe(true);
    await expect(createPosts(owner!, { ...restored.submission, text: "Changed request" }, business)).rejects.toMatchObject({ status: 409 });
  } finally {
    if (owner !== undefined) {
      await pool.query("DELETE FROM business_locations WHERE user_id=$1", [owner]);
      await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await pool.end();
  }
});
