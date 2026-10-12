/** Fictional recording fixtures only. No provider calls, prices, or recording assets.
 * Run after seed-demo.ts; all writes commit together. Stable keys are scoped to the
 * looked-up org, while database-generated IDs keep existing CRM rows collision-free.
 * Dates stay at seed time on rerun, as with the platform fixtures. Rebuild before filming.
 */
import pg from "pg";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { defaultVoiceProfile, parseVoiceProfile } from "../../shared/voice-profile";
import { CALL_ASSISTANT_TIERS } from "../../shared/plans";
import { compileVoiceProfile } from "../../server/voice/prompt-compiler";
import { libpqEnvFromUrl } from "./seed-platform";

export function assertCallAssistantTarget(raw: string): void {
  // Reuse the platform guard, then also reject a production DB hidden behind a safe schema.
  libpqEnvFromUrl(raw);
  const database = decodeURIComponent(new URL(raw).pathname.slice(1));
  if (!/^(constructhub_dev(?:_[a-z0-9_]+)?|constructhub_tut_[a-z0-9_]+)$/.test(database)
      || /(?:prod|production)/i.test(database))
    throw new Error("Call Assistant samples require a development or recording database");
}

export function callAssistantProfile(counties: ReturnType<typeof defaultVoiceProfile>["serviceArea"]["counties"] = []) {
  const p = defaultVoiceProfile({ name: "Aspire Interiors", timezone: "America/New_York", state: "FL",
    phone: "+19415550120", website: "https://aspire-interiors.example" });
  p.company.spokenName = "Aspire Interiors";
  p.company.trade = "interior remodeling contractor";
  p.company.services = [
    { name: "Kitchen remodeling", details: "Cabinet, countertop and layout renovations.", tier: "primary" },
    { name: "Bathroom remodeling", details: "Showers, vanities and tile renovations.", tier: "primary" },
    { name: "Interior painting", details: "Walls and trim as part of a remodel.", tier: "secondary" },
  ];
  // Use the app's county rows, never invented IDs or a parallel FIPS mapping.
  p.serviceArea.counties = counties;
  p.serviceArea.spokenAreas = ["Sarasota", "Bradenton", "Venice"];
  p.persona.presetId = "janice";
  p.persona.assistantName = "Janice";
  p.persona.greeting = "Thanks for calling Aspire Interiors, this is Janice. Calls may be recorded. How can we help today?";
  p.persona.recordingNotice = true;
  p.policies.pricing = "never";
  p.policies.emergencies = { handle: true, definition: "an urgent safety concern at an active remodeling site",
    line: "I'll alert the site lead so they can call you back." };
  p.policies.rules = ["Never quote a price or promise a start date. The team arranges an estimate."];
  p.escalations.rules = [
    { id: "site-urgent", kinds: ["urgent"], channel: "sms", recipientName: "Morgan Ellis",
      recipient: "+19415550121", template: "", enabled: true,
      reminders: { enabled: true, everyMinutes: 120, fromHour: 8, toHour: 18, maxDays: 14, followUpNextDay: true } },
    { id: "office", kinds: ["existing_customer", "scheduling"], channel: "email", recipientName: "Office",
      recipient: "office@aspire-interiors.example", template: "", enabled: true,
      reminders: { enabled: true, everyMinutes: 240, fromHour: 8, toHour: 18, maxDays: 7, followUpNextDay: true } },
  ];
  p.escalations.fallbackToOwner = true;
  p.escalations.callerLine = "I'll pass your message to the team so someone can call you back.";
  p.leadDelivery.crm = { enabled: true, createProject: true, tags: ["call-assistant", "phone"] };
  p.leadDelivery.email = { enabled: true, extraRecipients: ["office@aspire-interiors.example"] };
  p.leadDelivery.sms = { enabled: true, recipients: ["+19415550121"] };
  return parseVoiceProfile(p);
}

// Oldest first, so the schema's call-number trigger follows arrival order.
const samples = [
  [13, "lead_submitted", "Nora Finch", "Kitchen remodeling", "I'd like an estimate for new kitchen cabinets."],
  [11, "voicemail", "Evan Moss", "Existing project callback", "Please call me back about the trim work."],
  [9, "spam", "", "", "This is a recorded offer for business funding."],
  [7, "info", "Lena Brooks", "Office hours", "When does the office open on Monday?"],
  [6, "out_of_area", "Theo Reed", "Bathroom remodeling", "Do you remodel bathrooms in Jacksonville?"],
  [4, "lead_submitted", "Iris Vale", "Bathroom remodeling", "I'd like an estimate to replace my shower and vanity."],
  [3, "hangup", "", "", ""],
  [2, "alerted", "Maya Linden", "Project concern", "I need the site lead to call about a loose cabinet."],
  [1, "spam", "", "", "Your vehicle warranty is about to expire."],
  [0.125, "lead_submitted", "Owen Hartley", "Kitchen remodeling", "We'd like to update the cabinets and countertops."],
] as const;
export const CALL_ASSISTANT_SAMPLE_COUNT = samples.length;

export async function seedCallAssistant(raw: string): Promise<void> {
  assertCallAssistantTarget(raw);
  const db = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    const { rows: [target] } = await db.query("select current_database() as db, current_schema() as schema");
    if (!/^(constructhub_dev(?:_[a-z0-9_]+)?|constructhub_tut_[a-z0-9_]+)$/.test(target.db)
        || /prod/i.test(target.db)
        || (!/^constructhub_tut_[a-z0-9_]+$/.test(target.schema) && !/^constructhub_tut_[a-z0-9_]+$/.test(target.db)))
      throw new Error("Call Assistant samples require an existing recording schema/database");
    const { rows: orgs } = await db.query("select id, owner_user_id from crm_orgs where name = 'Aspire Interiors' for update");
    if (orgs.length !== 1 || !orgs[0].owner_user_id) throw new Error("Expected exactly one Aspire Interiors demo org with an owner; run seed-demo.ts first");
    const org = orgs[0];
    const prefix = `tutorial-call-assistant:${org.id}:`;
    const { rows: counties } = await db.query(`select id, name, state_code as "stateCode" from counties
      where state_code = 'FL' and name in ('Sarasota', 'Manatee') order by name`);
    if (counties.length !== 2 || new Set(counties.map(c => c.name)).size !== 2)
      throw new Error("Seed the verified Florida county catalog before Call Assistant samples (Sarasota and Manatee required)");
    const p = callAssistantProfile(counties);
    const compiled = compileVoiceProfile(p, 1);
    const json = (v: unknown) => JSON.stringify(v);
    // The call SID is our org-scoped idempotency key; an older seed only needs its empty county selection repaired.
    const { rows: existing } = await db.query("select id from voice_calls where call_sid = $1", [prefix + "10"]);
    if (existing.length) {
      // Repair pre-r9 sample profiles on rerun; preserve any county selection the owner already made.
      const { rows: profiles } = await db.query("select id, profile, published_profile, published_version from voice_profiles where org_id=$1 for update", [org.id]);
      for (const row of profiles) {
        const draft = parseVoiceProfile(row.profile);
        const published = row.published_profile ? parseVoiceProfile(row.published_profile) : null;
        const repairDraft = draft.serviceArea.counties.length === 0;
        const repairPublished = published && published.serviceArea.counties.length === 0;
        if (repairDraft) draft.serviceArea.counties = counties;
        if (repairPublished) published.serviceArea.counties = counties;
        if (repairDraft) await db.query("update voice_profiles set profile=$2 where id=$1", [row.id, json(draft)]);
        if (repairPublished) {
          const compiledPublished = compileVoiceProfile(published, row.published_version ?? 1);
          await db.query("update voice_profiles set published_profile=$2, compiled=$3 where id=$1", [row.id, json(published), json(compiledPublished)]);
          await db.query(`update voice_profile_versions set profile=$3, compiled=$4
            where profile_id=$1 and version=$2 and note='Fictional tutorial workspace'`,
          [row.id, row.published_version, json(published), json(compiledPublished)]);
        }
      }
      await db.query("COMMIT"); return;
    }
    const { rows: profiles } = await db.query("select id from voice_profiles where org_id=$1", [org.id]);
    if (profiles.length) throw new Error("Aspire Interiors already has a voice profile; refusing to replace it");
    await db.query(`insert into call_assistant_subscriptions (user_id,tier,status,billing_interval,current_period_end,stripe_subscription_id)
      values ($1,'solo','active','month',now()+interval '30 days',$2)
      on conflict (user_id) do nothing`, [org.owner_user_id, prefix + "subscription"]);
    const { rows: [profile] } = await db.query(`insert into voice_profiles
      (org_id,profile,published_version,published_profile,compiled,status,setup_completed_at)
      values ($1,$2,1,$2,$3,'live',now()) returning id`, [org.id, json(p), json(compiled)]);
    await db.query(`insert into voice_profile_versions (org_id,profile_id,version,profile,compiled,note)
      values ($1,$2,1,$3,$4,'Fictional tutorial workspace')`, [org.id, profile.id, json(p), json(compiled)]);
    const { rows: [number] } = await db.query(`insert into voice_numbers
      (org_id,phone_number,label,location,state,area_code,locality,provider,provider_sid,friendly_name,status,is_test)
      values ($1,'+19415550142','Main office','Sarasota, FL','FL','941','Sarasota','signalwire',$2,'Aspire Interiors — sample','active',false)
      returning id`, [org.id, prefix + "number"]);
    const { rows: [clock] } = await db.query("select now() as now");
    const now = new Date(clock.now).getTime();
    for (const [index, [days, outcome, name, need, said]] of samples.entries()) {
      const start = new Date(now - days * 86400000);
      const missed = outcome === "hangup";
      const duration = missed ? 0 : outcome === "spam" ? 25 : 150;
      const end = new Date(start.getTime() + duration * 1000);
      const phone = `+194155501${String(60 + index).padStart(2, "0")}`;
      const address = name ? `${100 + index} Sample Lantern Lane` : null;
      const reply = outcome === "lead_submitted" ? "I've saved your request. The team will call to arrange an estimate."
        : outcome === "info" ? "The office opens at eight on Monday."
        : outcome === "out_of_area" ? "I'm sorry, Jacksonville is outside our service area."
        : outcome === "spam" ? "Thanks, we are not interested. Goodbye."
        : "I'll pass your callback request to the team.";
      const summary = missed ? "Caller disconnected before the assistant answered. No message left."
        : outcome === "spam" ? "Recorded sales pitch screened as spam."
        : `${name}: ${said} ${outcome === "lead_submitted" ? "Client and project saved in the CRM." : reply}`;
      const transcript = missed ? [] : [{ role: "assistant", text: p.persona.greeting }, { role: "caller", text: said },
        ...(outcome === "lead_submitted" ? [{ role: "assistant", text: "What's your name, property address and callback number?" },
          { role: "caller", text: `${name}, ${address}, Sarasota. Call me on ${phone}.` }] : []), { role: "assistant", text: reply }];
      let customerId: string | null = null, projectId: string | null = null;
      if (outcome === "lead_submitted") {
        const { rows: [customer] } = await db.query(`insert into crm_customers
          (org_id,display_name,email,phone,address_line1,city,state,portal_token,tags,notes,created_at)
          values ($1,$2,$3,$4,$5,'Sarasota','FL',$6,ARRAY['call-assistant','phone'],'Fictional tutorial client',$7) returning id`,
        [org.id, name, `${name.toLowerCase().replaceAll(" ", ".")}@example.com`, phone, address, randomBytes(24).toString("hex"), end]);
        customerId = customer.id;
        const { rows: [project] } = await db.query(`insert into crm_projects
          (org_id,customer_id,name,status,address_line1,city,state,description,created_at)
          values ($1,$2,$3,'lead',$4,'Sarasota','FL','Fictional Call Assistant estimate request',$5) returning id`,
        [org.id, customerId, `${name} — ${need}`, address, end]);
        projectId = project.id;
      }
      const { rows: [call] } = await db.query(`insert into voice_calls
        (org_id,number_id,call_sid,from_number,to_number,engine,persona,profile_version,started_at,answered_at,ended_at,
         duration_seconds,billed_minutes,outcome,caller_name,caller_address,caller_city,service_needed,summary,transcript,
         customer_id,project_id,lead_delivered_at,spam_confidence,spam_reason,created_at,flags)
        values ($1,$2,$3,$4,'+19415550142','sample','janice',1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$5,'{}') returning id`,
      [org.id, number.id, prefix + (index + 1), phone, start, missed ? null : start, end, duration,
        outcome === "spam" || missed ? 0 : Math.ceil(duration / 60), outcome, name || null, address,
        outcome === "out_of_area" ? "Jacksonville" : name ? "Sarasota" : null, need || null, summary, json(transcript),
        customerId, projectId, customerId ? end : null, outcome === "spam" ? 0.99 : null, outcome === "spam" ? "Recorded sales pitch" : null]);
      const task = async (kind: string, key: string, payload: unknown, state: string, result: unknown, error: string | null = null) => {
        await db.query(`insert into voice_call_tasks
          (org_id,call_id,kind,task_key,payload,state,attempts,result,last_error,created_at,updated_at,next_attempt_at,give_up_at,done_at)
          values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9::timestamptz,$9::timestamptz,$9::timestamptz,$9::timestamptz+interval '3 days',$10::timestamptz)`,
        [org.id, call.id, kind, key, json(payload), state, result == null ? null : json(result), error, end, state === "done" ? end : null]);
      };
      if (customerId) {
        await task("lead", "lead", {}, "done", { customerId, projectId, created: true });
        // CRM saved, but the two newer calls illustrate distinct notification failures.
        const uncertain = index === 9;
        const error = index === 5 ? "Not sent: texting isn't set up." : uncertain
          ? "Delivery outcome unknown: carrier acceptance response was lost. Check with the recipient; automatic and bulk retries are blocked." : null;
        const channel = index === 0 ? "email" : "sms";
        const recipient = channel === "email" ? "office@aspire-interiors.example" : "+19415550121";
        await task("notification", `notification:${channel}:${recipient}`, { channel, recipient, userId: null,
          title: `Estimate request — ${name}`, body: summary, link: `/crm/clients/${customerId}` },
        error ? "failed" : "done", uncertain ? { uncertain: true } : error ? null : { channel, recipient, accepted: true }, error);
      }
      if (outcome === "alerted" || outcome === "voicemail") {
        const open = outcome === "alerted";
        const kind = open ? "urgent" : "existing_customer";
        const channel = open ? "sms" : "email";
        const recipient = open ? "+19415550121" : "office@aspire-interiors.example";
        const { rows: [escalation] } = await db.query(`insert into voice_escalations
          (org_id,call_id,kind,rule_id,channel,recipient,recipient_name,body,sent_count,last_sent_at,last_provider_sid,
           confirmed_at,reply_text,created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [org.id, call.id, kind, open ? "site-urgent" : "office", channel, recipient, open ? "Morgan Ellis" : "Office",
          summary, open ? 2 : 1, open ? new Date(end.getTime() + 7200000) : end, open ? prefix + "reminder" : null,
          open ? null : new Date(end.getTime() + 3600000), open ? null : "Confirmed by email link — callback handled", end]);
        const body = `${summary}\nCaller: ${name}\nAddress: ${address}, Sarasota\nCallback: ${phone}`;
        const revision = createHash("sha256").update(json([name, `${address}, Sarasota`, body])).digest("hex");
        const ownerKey = createHash("sha256").update(json([kind, "initial", "sms", "+19415550120"])).digest("hex");
        await db.query("update voice_calls set flags=$2 where id=$1", [call.id, json({ alertedKinds: [kind],
          ownerEscalationDelivery: open ? { [ownerKey]: { status: "failed", kind, channel: "sms", recipient: "+19415550120",
            sid: null, error: "Not sent: texting isn't set up." } } : {},
          escalationDetailsDelivery: { [String(escalation.id)]: { revision, body, subject: `Details added — ${name}`,
            status: open ? "uncertain" : "sent", error: open ? "Delivery uncertain; verify with the carrier before resending." : null } },
        })]);
        // Details uncertainty pauses reminders in the same way as the runtime code.
        if (open) await db.query("update voice_escalations set last_error=$2 where id=$1",
          [escalation.id, "Details update not sent: Delivery uncertain; verify with the carrier before resending."]);
        else await db.query("update voice_escalations set closed_at=$2, close_reason='Handled by the office' where id=$1",
          [escalation.id, new Date(end.getTime() + 7200000)]);
        await task("escalation", `escalation:${kind}`, { kind, summary }, open ? "failed" : "done",
          { escalationId: Number(escalation.id), fallback: false }, open ? "Delivery uncertain; verify with the carrier before resending." : null);
      }
      if (outcome === "spam") await db.query(`insert into voice_spam
        (org_id,phone_number,strikes,calls,last_confidence,last_reason,last_call_id,first_seen_at,last_seen_at)
        values ($1,$2,1,1,0.99,'Recorded sales pitch',$3,$4,$4)`, [org.id, phone, call.id, start]);
    }
    // Derive the usage card from the sample calls, including months straddled by this fortnight.
    // The entitlement comes from the current plan definitions; no prices are copied into fixtures.
    await db.query(`insert into voice_usage
      (org_id,account_user_id,month,calls,minutes,spam_calls,spam_free_calls,spam_free_minutes,included_minutes,stripe_usage_record_id)
      select org_id,$2,to_char(started_at,'YYYY-MM'),count(*)::int,sum(billed_minutes)::int,
        count(*) filter (where outcome='spam')::int,count(*) filter (where outcome='spam')::int,
        coalesce(sum(ceil(duration_seconds/60.0)) filter (where outcome='spam'),0)::int,$3,$4
      from voice_calls where org_id=$1 and starts_with(call_sid,$4) group by org_id,to_char(started_at,'YYYY-MM')`,
    [org.id, org.owner_user_id, CALL_ASSISTANT_TIERS.find(t => t.tier === "solo")!.includedMinutes, prefix]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { await db.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  seedCallAssistant(process.env.DATABASE_URL ?? "").then(() => console.log("Call Assistant tutorial workspace seeded (fictional samples)"))
    .catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
