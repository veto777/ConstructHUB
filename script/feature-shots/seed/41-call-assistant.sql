-- Feature-shot sample data: AI Call Assistant (helper D, non-CRM keys). Lane DB only.
-- Targets the sample CRM org 40000000-0000-4000-8000-000000000001 (Summit Roofing Co., from 40-crm.sql) when user 1 belongs to it,
-- else user 1's oldest active membership (what server/crm/tenancy.ts ensureOrgForUser picks).
-- Re-run after the CRM seed changes which org that is. Marker: ids/call_sids start with 'fs-voice-'.
begin;
do $$ begin
  if current_database() not like 'constructhub\_dev\_%' then raise exception 'refusing to run on %', current_database(); end if;
end $$;

insert into call_assistant_subscriptions (user_id, tier, status, billing_interval, current_period_end, stripe_subscription_id)
values (1, 'solo', 'active', 'month', '2026-10-31 23:59', 'fs-voice-sample')
on conflict (user_id) do update set tier = 'solo', status = 'active', billing_interval = 'month',
  current_period_end = '2026-10-31 23:59', stripe_subscription_id = 'fs-voice-sample', updated_at = now();

create temp table fs_org on commit drop as
  select org_id from crm_members where user_id = 1 and status = 'active'
  order by (org_id = '40000000-0000-4000-8000-000000000001') desc, created_at asc limit 1;

delete from voice_calls where call_sid like 'fs-voice-%';
delete from voice_numbers where id like 'fs-voice-%';
delete from voice_profiles where id like 'fs-voice-%' or org_id in (select org_id from fs_org);
delete from voice_usage where stripe_usage_record_id = 'fs-voice-sample';

insert into voice_profiles (id, org_id, profile, published_version, published_profile, status, setup_completed_at, created_at, updated_at)
select 'fs-voice-profile', o.org_id, p.j, 3, p.j, 'published', now() - interval '26 days', now() - interval '27 days', now() - interval '2 days'
from fs_org o, (select $J${
  "schemaVersion": 1,
  "company": {
    "name": "Summit Roofing Co.",
    "spokenName": "Summit Roofing",
    "tagline": "Roof replacement, repairs and gutters across the Denver metro.",
    "trade": "licensed roofing contractor",
    "services": [
      { "name": "Roof replacement", "details": "Full tear-off and replacement, asphalt shingle or standing-seam metal.", "tier": "primary" },
      { "name": "Storm and hail damage", "details": "Inspections and insurance-claim roof replacements after hail.", "tier": "primary" },
      { "name": "Roof repair", "details": "Leaks, missing shingles, flashing and vents.", "tier": "primary" },
      { "name": "Gutters", "details": "Seamless gutters, downspouts and gutter guards.", "tier": "secondary" },
      { "name": "Skylights", "details": "Replacement skylights during a re-roof.", "tier": "secondary" }
    ],
    "materials": ["architectural asphalt shingles", "class 4 impact-resistant shingles", "standing-seam metal", "seamless aluminum gutters"],
    "brands": [],
    "declines": [
      { "what": "Commercial flat roofs", "referral": "a commercial roofing company would be the best fit for that" },
      { "what": "Siding-only jobs", "referral": "a siding contractor would be the best fit for that" }
    ],
    "hours": {
      "mon": { "open": true, "from": "07:30", "to": "17:30" },
      "tue": { "open": true, "from": "07:30", "to": "17:30" },
      "wed": { "open": true, "from": "07:30", "to": "17:30" },
      "thu": { "open": true, "from": "07:30", "to": "17:30" },
      "fri": { "open": true, "from": "07:30", "to": "17:30" },
      "sat": { "open": true, "from": "09:00", "to": "13:00" },
      "sun": { "open": false, "from": "09:00", "to": "13:00" }
    },
    "timezone": "America/Denver",
    "officePhone": "+13035550123",
    "website": "https://summitroofing.example",
    "about": "Family-owned roofer serving the Denver metro since 2011, with four install crews."
  },
  "serviceArea": {
    "counties": [
      { "id": 34, "name": "Denver", "stateCode": "CO" },
      { "id": 37, "name": "Jefferson", "stateCode": "CO" },
      { "id": 33, "name": "Arapahoe", "stateCode": "CO" },
      { "id": 32, "name": "Adams", "stateCode": "CO" },
      { "id": 35, "name": "Douglas", "stateCode": "CO" }
    ],
    "spokenAreas": ["Denver", "Lakewood", "Aurora", "Littleton", "Englewood", "Arvada", "Westminster", "Highlands Ranch"],
    "defaultStateCode": "CO",
    "outOfArea": "decline",
    "outOfAreaLine": "I'm sorry, that's outside the area we serve."
  },
  "credibility": {
    "yearsInBusiness": 15,
    "foundedYear": 2011,
    "licenses": ["Licensed and insured in Colorado"],
    "insured": true,
    "bonded": true,
    "warranties": ["10-year workmanship warranty"],
    "awards": [],
    "reviews": "4.8 stars on Google (186 reviews)",
    "certifications": [],
    "memberships": []
  },
  "offers": {
    "financing": { "available": true, "details": "Financing for 12 months on approved credit." },
    "promotions": [{ "name": "Fall gutter special", "details": "Free gutter cleaning with any roof replacement booked before November 30.", "endsOn": "2026-11-30" }],
    "freeEstimate": true,
    "freeEstimateLine": "The inspection and estimate are free, with no obligation.",
    "referralProgram": ""
  },
  "policies": {
    "pricing": "never",
    "priceRanges": [],
    "repairs": "yes",
    "minimumJob": "",
    "emergencies": {
      "handle": true,
      "definition": "an active leak, storm damage or anything unsafe",
      "line": "I'm paging the on-call crew lead now; someone will call you right back."
    },
    "rules": [
      "Never promise a start date; the estimator sets that.",
      "Never quote a price over the phone."
    ]
  },
  "persona": {
    "presetId": "janice",
    "assistantName": "Janice",
    "greeting": "Thanks for calling Summit Roofing, this is Janice. Calls may be recorded. How can we help today?",
    "botAnswer": "Yes, I'm a virtual assistant, and I can get your request to the team.",
    "languages": ["en", "es"],
    "recordingNotice": true,
    "style": { "warmth": 4, "brevity": 4, "formality": 2 }
  },
  "intake": {
    "questions": [
      { "key": "need", "prompt": "What's going on with the roof?", "required": true, "validation": "none", "choices": [], "confirm": false, "neverReadAloud": false, "prefillFrom": "" },
      { "key": "address", "prompt": "What's the street address and city for the property?", "required": true, "validation": "address", "choices": [], "confirm": false, "neverReadAloud": false, "prefillFrom": "" },
      { "key": "first_name", "prompt": "And who am I speaking with? A first name is fine.", "required": true, "validation": "name", "choices": [], "confirm": false, "neverReadAloud": false, "prefillFrom": "crm" },
      { "key": "phone", "prompt": "Is the number you're calling from the best one to reach you?", "required": true, "validation": "phone", "choices": [], "confirm": false, "neverReadAloud": true, "prefillFrom": "caller_id" },
      { "key": "email", "prompt": "What's a good email for the estimate?", "required": false, "validation": "email", "choices": [], "confirm": true, "neverReadAloud": false, "prefillFrom": "crm" },
      { "key": "best_time", "prompt": "When is the best time for someone to call you back?", "required": false, "validation": "none", "choices": [], "confirm": false, "neverReadAloud": false, "prefillFrom": "" }
    ],
    "submitLine": "I've sent your request to the team, and an estimator will call you to set up a free inspection.",
    "submitOnGoodbye": true
  },
  "faq": [
    { "question": "Do you work with insurance on hail damage?", "answer": "Yes. We inspect, document the damage and meet your adjuster on site." },
    { "question": "How soon can someone come out?", "answer": "An estimator will call you back to set that up, usually within one business day." },
    { "question": "Are you licensed and insured?", "answer": "Yes, fully licensed and insured." }
  ],
  "escalations": {
    "rules": [
      { "id": "owner-urgent", "kinds": ["urgent", "human", "complaint", "other"], "channel": "sms", "recipientName": "Sam Rivera", "recipient": "+13035550124", "template": "", "reminders": { "enabled": true, "everyMinutes": 120, "fromHour": 7, "toHour": 20, "maxDays": 14, "followUpNextDay": true }, "enabled": true },
      { "id": "estimates", "kinds": ["estimate_missing", "scheduling"], "channel": "sms", "recipientName": "Maria Delgado", "recipient": "+13035550125", "template": "", "reminders": { "enabled": true, "everyMinutes": 120, "fromHour": 7, "toHour": 20, "maxDays": 14, "followUpNextDay": true }, "enabled": true },
      { "id": "office", "kinds": ["existing_customer", "contract", "payment"], "channel": "email", "recipientName": "Office", "recipient": "office@summitroofing.example", "template": "", "reminders": { "enabled": true, "everyMinutes": 240, "fromHour": 8, "toHour": 18, "maxDays": 7, "followUpNextDay": true }, "enabled": true }
    ],
    "callerLine": "I've passed this straight to the right person and they'll get back to you.",
    "fallbackToOwner": true
  },
  "leadDelivery": {
    "crm": { "enabled": true, "createProject": true, "tags": ["call-assistant", "phone"] },
    "email": { "enabled": true, "extraRecipients": ["leads@summitroofing.example"] },
    "sms": { "enabled": true, "recipients": ["+13035550124"] },
    "notifyOnEveryCall": false
  },
  "appointments": { "enabled": false, "crews": [], "slotMinutes": 90, "bufferMinutes": 30, "leadTimeHours": 20, "confirmBySms": true },
  "advanced": {
    "extraInstructions": "",
    "temperature": 0.3, "maxTurns": 40, "silencePromptSeconds": 12, "silencePromptsBeforeHangup": 2,
    "maxCallSeconds": 900, "greetingDelaySeconds": 3, "spamSensitivity": "normal",
    "vocabulary": ["Lakewood", "Arvada", "Englewood", "Highlands Ranch", "class 4"]
  }
}$J$::jsonb as j) p;

insert into voice_numbers (id, org_id, phone_number, label, location, state, area_code, locality, provider, friendly_name, status, monthly_cents, purchased_at, created_at, updated_at)
select 'fs-voice-num-1', org_id, '+17205550142', 'Main line', 'Denver, CO', 'CO', '720', 'Denver', 'signalwire', '(720) 555-0142', 'active', 0, now() - interval '26 days', now() - interval '26 days', now() from fs_org;

insert into voice_calls (id, org_id, number_id, call_sid, direction, from_number, to_number, engine, persona, profile_version,
  started_at, answered_at, ended_at, duration_seconds, billed_minutes, outcome, caller_name, caller_city, service_needed, summary, transcript, spam_confidence, spam_reason, created_at)
select 'fs-voice-call-' || c.n, o.org_id, 'fs-voice-num-1', 'fs-voice-call-' || c.n, 'inbound', c.frm, '+17205550142', 'sample', 'janice', 3,
  now() - c.ago, now() - c.ago, now() - c.ago + make_interval(secs => c.dur), c.dur, greatest(1, ceil(c.dur / 60.0))::int,
  c.outcome, c.name, c.city, c.need, c.summary,
  jsonb_build_array(
    jsonb_build_object('role','assistant','text','Thanks for calling Summit Roofing, this is Janice. Calls may be recorded. How can we help today?'),
    jsonb_build_object('role','caller','text', c.said),
    jsonb_build_object('role','assistant','text', c.reply)),
  c.spam, case when c.outcome = 'spam' then 'Robocall: recorded sales pitch' end, now() - c.ago
from fs_org o, (values
  (1, '+13035550161', interval '3 hours',  212, 'lead_submitted', 'Maria Delgado', 'Lakewood',  'Hail damage inspection',  'Hail last week dented gutters and knocked granules off the shingles. Wants an inspection before calling insurance. Lead sent to the CRM.', 'We had that hail storm and I think the roof took a beating.', 'I can set that up. What is the address of the property?', null::numeric),
  (2, '+13035550162', interval '7 hours',  148, 'lead_submitted', 'Tom Becker',    'Aurora',    'Full roof replacement',    'Roof is 22 years old, asking about a full replacement and financing. Lead sent to the CRM.', 'Our roof is over twenty years old and we want a quote to replace it.', 'Happy to help. An estimator does a free inspection first. What is the address?', null),
  (3, '+13035550163', interval '1 day 2 hours', 96, 'alerted', 'Priya Natarajan', 'Denver', 'Active leak', 'Water coming through the ceiling during rain. Paged the on-call crew lead by text.', 'Water is dripping through my bedroom ceiling right now.', 'I am paging the on-call crew lead now; someone will call you right back.', null),
  (4, '+13035550164', interval '1 day 6 hours', 41, 'spam', null, null, null, 'Recorded sales pitch for business loans. Not counted against minutes.', 'This is an important message about your business funding.', 'Thanks, we are not interested. Goodbye.', 0.97),
  (5, '+13035550165', interval '2 days 1 hour', 175, 'lead_submitted', 'Grace Whitman', 'Littleton', 'Gutters and guards', 'Wants seamless gutters and guards on a two-story house. Lead sent to the CRM.', 'I need new gutters, the old ones are pulling off the fascia.', 'We can do seamless gutters and guards. What is the address?', null),
  (6, '+13035550166', interval '3 days 4 hours', 63, 'info', 'Dale Ortiz', 'Arvada', 'Hours question', 'Asked about Saturday hours and whether the inspection is free. Answered from the profile.', 'Are you open Saturday and is the inspection free?', 'Yes, Saturday 9 to 1, and the inspection and estimate are free.', null),
  (7, '+13035550167', interval '4 days 2 hours', 88, 'out_of_area', 'Kim Larsen', 'Colorado Springs', 'Roof repair', 'Property is outside the service area. Declined politely.', 'I am down in Colorado Springs, do you come out here?', 'I am sorry, that is outside the area we serve.', null),
  (8, '+13035550168', interval '5 days 3 hours', 231, 'lead_submitted', 'Andre Wallace', 'Englewood', 'Skylight and re-roof', 'Re-roof with two replacement skylights; insurance claim already open. Lead sent to the CRM.', 'Insurance approved a new roof and I want the skylights replaced too.', 'We can handle both. What is the address and your claim timing?', null),
  (9, '+13035550169', interval '6 days 5 hours', 37, 'spam', null, null, null, 'Extended-warranty robocall. Not counted against minutes.', 'Your vehicle warranty is about to expire.', 'Thanks, we are not interested. Goodbye.', 0.99),
  (10,'+13035550170', interval '8 days 1 hour', 158, 'lead_submitted', 'Helen Park', 'Westminster', 'Missing shingles', 'Wind took off shingles on the north side. Wants a repair quote. Lead sent to the CRM.', 'The wind ripped some shingles off the back of the house.', 'We do repairs. What is the address and is anything leaking?', null),
  (11,'+13035550171', interval '11 days 3 hours', 120, 'voicemail', 'Luis Romero', 'Denver', 'Callback request', 'Caller asked for a callback about an existing job. Office notified by email.', 'I want to talk to someone about the job you did last month.', 'I will pass that to the office and they will call you back.', null),
  (12,'+13035550172', interval '14 days 2 hours', 194, 'lead_submitted', 'Nina Foster', 'Highlands Ranch', 'Metal roof', 'Interested in standing-seam metal for a ranch house. Lead sent to the CRM.', 'I am thinking about a metal roof. Do you install those?', 'Yes, standing-seam metal. What is the address?', null)
) as c(n, frm, ago, dur, outcome, name, city, need, summary, said, reply, spam);

insert into voice_usage (org_id, account_user_id, month, calls, minutes, spam_calls, blocked_calls, included_minutes, spam_free_calls, spam_free_minutes, stripe_usage_record_id, updated_at)
select org_id, 1, to_char(now() at time zone 'UTC', 'YYYY-MM'), 10, 24, 2, 0, 1000, 2, 2, 'fs-voice-sample', now() from fs_org
on conflict (org_id, month) do update set calls = excluded.calls, minutes = excluded.minutes, spam_calls = excluded.spam_calls,
  blocked_calls = excluded.blocked_calls, included_minutes = excluded.included_minutes, spam_free_calls = excluded.spam_free_calls,
  spam_free_minutes = excluded.spam_free_minutes, stripe_usage_record_id = excluded.stripe_usage_record_id, updated_at = now();
commit;
