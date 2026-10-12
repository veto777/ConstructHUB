import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { combinedSql, tutorialSocialSql } from "../../scripts/tutorials/seed-platform";
import { TUTORIAL_SOCIAL_TENANT, TUTORIAL_SOCIAL_ENCRYPTION_KEY } from "../../scripts/tutorials/social-sample";
import { decryptKey } from "../social/client";
import { NATIVE_MARK, NativeClient } from "../social/native";
import { tenantFor } from "../social/outstand";
const original = process.env.SOCIAL_ENCRYPTION_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.SOCIAL_ENCRYPTION_KEY;
  else process.env.SOCIAL_ENCRYPTION_KEY = original;
});
describe("Social recording sample", () => {
  it("encrypts only the sample connection using the slot key and app hash", async () => {
    process.env.SOCIAL_ENCRYPTION_KEY = "caller-value-must-survive";
    const sql = await tutorialSocialSql("postgres://sample:sample@127.0.0.1:5432/constructhub_tut_slot1");
    expect(process.env.SOCIAL_ENCRYPTION_KEY).toBe("caller-value-must-survive");
    process.env.SOCIAL_ENCRYPTION_KEY = TUTORIAL_SOCIAL_ENCRYPTION_KEY;
    expect(decryptKey(sql.match(/SET key_enc='([^']+)'/)![1], 1)).toBe(NATIVE_MARK + TUTORIAL_SOCIAL_TENANT);
    expect(TUTORIAL_SOCIAL_TENANT).toBe(tenantFor(1, 910001));
    expect(sql).toContain(new NativeClient(TUTORIAL_SOCIAL_TENANT).hash);
    expect(sql).toContain("business_id=910001 AND key_enc='fs-b-placeholder'");
    const app = fs.readFileSync(new URL("../../scripts/tutorials/app.ts", import.meta.url), "utf8");
    expect(app).toContain("SOCIAL_ENCRYPTION_KEY: TUTORIAL_SOCIAL_ENCRYPTION_KEY");
    expect(app).toContain('env.TUTORIAL_FIXTURES = "1"');
  });
  it("refuses non-tutorial databases and forbidden ports before encryption", async () => {
    for (const url of ["postgres://u:p@127.0.0.1:5432/constructhub_dev_fs", "postgres://u:p@127.0.0.1:5433/constructhub_tut_slot1", "postgres://u:p@example.com:5432/constructhub_tut_slot1", "postgres://u:p@127.0.0.1:5432/not_constructhub_tut_slot1", "postgres://u:p@127.0.0.1:5432/live?options=-c%20application_name=constructhub_tut_slot1", "postgres://u:p@127.0.0.1:5432/constructhub_tut_slot1?options=-c%20search_path=public"]) {
      await expect(tutorialSocialSql(url)).rejects.toThrow(/only writes/);
    }
  });
  it("seeds generic siding and four linked synced business photos idempotently", () => {
    const sql = combinedSql();
    expect(sql).toContain("fiber-cement lap siding");
    expect(sql).not.toContain("James Hardie");
    expect(sql).toContain("FROM media_photos WHERE user_id=1 AND id BETWEEN 92001 AND 92004");
    expect(sql).toContain("SELECT 910001, 'locations/fs-b-910001/media/social-' || id, 'business'");
    expect(sql).toContain("ON CONFLICT(location_id,name) DO UPDATE");
  });
});
