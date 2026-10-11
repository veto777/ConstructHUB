import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { assertCallAssistantTarget, callAssistantProfile, seedCallAssistant, CALL_ASSISTANT_SAMPLE_COUNT } from "../../scripts/tutorials/seed-call-assistant";
import { CALL_OUTCOMES, parseVoiceProfile } from "../../shared/voice-profile";
import { compileVoiceProfile } from "../voice/prompt-compiler";
import { VOICE_SCHEMA_DDL } from "../voice/schema";

function recordingUrl(database = "constructhub_dev_fs", options = "-c TimeZone=UTC -c search_path=constructhub_tut_seed_test") {
  const url = new URL(`postgres://sample:sample@127.0.0.1:5432/${database}`);
  if (options) url.searchParams.set("options", options);
  return url.toString();
}

describe("Call Assistant recording guard", () => {
  it("accepts only loopback recording databases or recording schemas in dev databases", () => {
    for (const raw of [recordingUrl(), recordingUrl("constructhub_dev"), recordingUrl("constructhub_tut_slot1", "")])
      expect(() => assertCallAssistantTarget(raw)).not.toThrow();
  });
  it.each([
    recordingUrl().replace(":5432", ":5433"), recordingUrl().replace("127.0.0.1", "remote.example"),
    recordingUrl("production"), recordingUrl("constructhub_dev_production"), recordingUrl("constructhub_tut_prod"),
    recordingUrl("constructhub_dev_fs", ""), recordingUrl("constructhub_dev_fs", "-c search_path=public"),
    recordingUrl("constructhub_dev_fs", "-c search_path=constructhub_tut_test,public"),
    recordingUrl("constructhub_dev_fs", "-c search_path=constructhub_tut_test -c role=admin"),
    recordingUrl().replace("postgres:", "https:"), "",
  ])("refuses an unsafe target before connecting: %s", raw => {
    expect(() => assertCallAssistantTarget(raw)).toThrow();
  });
  it("compiles a valid fictional profile with SMS rules and owner fallback", () => {
    const p = callAssistantProfile();
    expect(parseVoiceProfile(p)).toEqual(p);
    expect(p.escalations.rules.some(r => r.channel === "sms")).toBe(true);
    expect(p.escalations.fallbackToOwner).toBe(true);
    expect(p.leadDelivery.crm.createProject).toBe(true);
    expect(p.policies.priceRanges).toEqual([]);
    expect(compileVoiceProfile(p, 1).greeting).toContain("Aspire Interiors");
  });
});

// Copy the lane URL, never touch the lane's rows or the actual recording template.
// A unique recording schema clones the current tables, then is dropped in afterAll.
const tables = ["users", "crm_orgs", "crm_customers", "crm_projects", "call_assistant_subscriptions",
  "voice_profiles", "voice_profile_versions", "voice_numbers", "voice_calls", "voice_call_tasks", "voice_escalations", "voice_spam", "voice_usage"];
let client: pg.Client | undefined;
let raw: string | undefined;
let skipReason: string | undefined;
const schema = `constructhub_tut_caseed_test_${randomUUID().replaceAll("-", "")}`;
let created = false;

beforeAll(async () => {
  let lane = process.env.TUTORIAL_CALL_ASSISTANT_TEST_DATABASE_URL;
  if (!lane) {
    const envPath = path.join(os.homedir(), "ConstructHUB-featshots/.env");
    if (!fs.existsSync(envPath)) { skipReason = `lane DB unavailable: ${envPath} is missing (or set TUTORIAL_CALL_ASSISTANT_TEST_DATABASE_URL)`; return; }
    lane = parseEnv(fs.readFileSync(envPath, "utf8")).DATABASE_URL;
  }
  if (!lane) { skipReason = "lane DB unavailable: no DATABASE_URL in feature-shots .env"; return; }
  const url = new URL(lane);
  if (url.hostname !== "127.0.0.1" || (url.port || "5432") !== "5432" || url.pathname !== "/constructhub_dev_fs" || url.search)
    throw new Error("Integration test requires the unmodified 127.0.0.1:5432/constructhub_dev_fs URL");
  client = new pg.Client({ connectionString: lane, connectionTimeoutMillis: 3000 });
  try { await client.connect(); }
  catch { await client.end().catch(() => {}); client = undefined; skipReason = "lane DB constructhub_dev_fs is unreachable on 127.0.0.1:5432"; return; }
  await client.query(`create schema "${schema}"`);
  created = true;
  await client.query(`set search_path to "${schema}"`);
  for (const table of tables) {
    await client.query(`create table "${table}" (like public."${table}" including all)`);
    // LIKE copies serial defaults pointing at public sequences. Replace them with private ones.
    const { rows } = await client.query(`select column_name from information_schema.columns
      where table_schema=$1 and table_name=$2 and column_default like 'nextval(%'`, [schema, table]);
    for (const { column_name: column } of rows) {
      await client.query(`create sequence "${table}_${column}_test_seq"`);
      await client.query(`alter table "${table}" alter column "${column}" set default nextval('"${schema}"."${table}_${column}_test_seq"')`);
    }
  }
  // LIKE does not clone triggers; install the actual current call numbering function/trigger.
  for (const ddl of VOICE_SCHEMA_DDL.filter(sql => sql.includes("voice_calls_assign_no"))) await client.query(ddl);
  const { rows: [owner] } = await client.query("insert into users (email,display_name) values ('caseed-owner@example.com','Demo Account') returning id");
  await client.query("insert into crm_orgs (name,owner_user_id) values ('Aspire Interiors',$1)", [owner.id]);
  await client.query("insert into crm_orgs (name,owner_user_id) values ('Unrelated sample org',$1)", [owner.id]);
  url.searchParams.set("options", `-c TimeZone=UTC -c search_path=${schema}`);
  raw = url.toString();
});

afterAll(async () => {
  if (client) {
    try { if (created) await client.query(`drop schema "${schema}" cascade`); }
    finally { await client.end(); }
  }
});

it("seeds twice without duplicates, with linked CRM rows and honest delivery receipts", async ctx => {
  if (skipReason) { console.warn(`SKIP Call Assistant integration: ${skipReason}`); ctx.skip(); return; }
  const db = client!;
  await seedCallAssistant(raw!);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table] = (await db.query(`select * from "${table}" order by id`)).rows;
    return result;
  };
  const first = await snapshot();
  await seedCallAssistant(raw!);
  expect(await snapshot()).toEqual(first);
  const { rows: calls } = await db.query("select * from voice_calls order by started_at");
  expect(calls).toHaveLength(CALL_ASSISTANT_SAMPLE_COUNT);
  expect(calls.map(c => c.call_no)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  for (const call of calls) {
    expect(CALL_OUTCOMES).toContain(call.outcome);
    expect(call.from_number).toMatch(/^\+194155501\d{2}$/);
    expect(call.started_at.getTime()).toBeGreaterThan(Date.now() - 14 * 86400000);
    expect(call.started_at.getTime()).toBeLessThan(Date.now());
    if (call.outcome !== "hangup") expect(call.transcript.length).toBeGreaterThanOrEqual(3);
  }
  const { rows: linked } = await db.query(`select c.id from voice_calls c
    join crm_customers u on u.id=c.customer_id and u.org_id=c.org_id
    join crm_projects p on p.id=c.project_id and p.customer_id=u.id and p.org_id=c.org_id
    where c.lead_delivered_at is not null`);
  expect(linked).toHaveLength(3);
  const { rows: tasks } = await db.query("select * from voice_call_tasks");
  expect(tasks.filter(t => t.kind === "lead" && t.state === "done")).toHaveLength(3);
  expect(tasks.some(t => t.state === "failed" && t.last_error === "Not sent: texting isn't set up.")).toBe(true);
  expect(tasks.some(t => t.state === "failed" && t.result?.uncertain)).toBe(true);
  expect(tasks.every(t => t.state !== "pending")).toBe(true);
  const { rows: escalations } = await db.query("select * from voice_escalations order by created_at");
  expect(escalations).toHaveLength(2);
  expect(escalations[0].confirmed_at).not.toBeNull();
  expect(escalations[0].closed_at).not.toBeNull();
  expect(escalations[1]).toMatchObject({ sent_count: 2, confirmed_at: null, closed_at: null });
  const flags = calls.find(c => c.outcome === "alerted")!.flags;
  expect(Object.values(flags.ownerEscalationDelivery)[0]).toMatchObject({ status: "failed", channel: "sms", sid: null });
  expect(flags.escalationDetailsDelivery[String(escalations[1].id)]).toMatchObject({ status: "uncertain", revision: expect.any(String), body: expect.any(String), subject: expect.any(String) });
  expect((await db.query("select * from voice_spam")).rows).toHaveLength(2);
  const { rows: [usage] } = await db.query("select sum(calls)::int as calls, sum(spam_calls)::int as spam from voice_usage");
  expect(usage).toEqual({ calls: CALL_ASSISTANT_SAMPLE_COUNT, spam: 2 });
  expect((await db.query(`select c.id from voice_calls c join crm_orgs o on o.id=c.org_id where o.name <> 'Aspire Interiors'`)).rows).toEqual([]);
}, 20000);

it("rolls all writes back when a later fixture fails", async ctx => {
  if (skipReason) { ctx.skip(); return; }
  const db = client!;
  // Reset only this test schema, then force a failure after profile/number/CRM inserts.
  for (const table of tables.filter(t => t !== "users" && t !== "crm_orgs")) await db.query(`truncate "${table}"`);
  await db.query("alter table voice_calls add constraint reject_sample_call check (engine <> 'sample')");
  await expect(seedCallAssistant(raw!)).rejects.toThrow();
  for (const table of tables.filter(t => t !== "users" && t !== "crm_orgs"))
    expect((await db.query(`select count(*)::int as n from "${table}"`)).rows[0].n).toBe(0);
});
