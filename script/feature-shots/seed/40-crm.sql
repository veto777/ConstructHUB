-- Feature-shot lane seed: the CRM workspace "Summit Roofing Co." (Denver, CO) for sample user 1 (Sam Rivera).
-- Sample data only: every name, email (*.example) and phone (555-01xx) is invented; street addresses are vague.
-- Idempotent: deletes everything under the fixed org id 40000000-0000-4000-8000-000000000001 (and user 1's
-- sample CRM subscription), then inserts. Dates are relative to the day it runs. The app stores UTC in
-- timestamp-without-time-zone columns, so the session runs in UTC; visit times are wall-clock times in
-- America/New_York (the lane box and its browser), converted. JobCam pictures: node script/feature-shots/seed/40-crm-photos.mjs
-- Run: psql "$DATABASE_URL" -f script/feature-shots/seed/40-crm.sql
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() not like 'constructhub_dev_%' then
    raise exception 'refusing to seed %: lane databases (constructhub_dev_*) only', current_database();
  end if;
end $$;
set local timezone = 'UTC';

-- ── wipe ────────────────────────────────────────────────────────────────────
delete from jobcam_media        where org_id = '40000000-0000-4000-8000-000000000001';
delete from jobcam_org_usage   where org_id = '40000000-0000-4000-8000-000000000001';
delete from jobcam_tags         where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_team_activity   where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_activity_log    where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_notifications   where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_client_comments where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_customer_notes  where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_payments        where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_invoices        where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_estimate_events where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_estimate_items  where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_estimates       where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_appointments    where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_jobs            where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_projects        where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_customers       where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_lead_sources    where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_members         where org_id = '40000000-0000-4000-8000-000000000001';
delete from crm_orgs            where id     = '40000000-0000-4000-8000-000000000001';
delete from crm_subscriptions   where user_id = 1 and stripe_customer_id = 'fs40-sample';

-- ── CRM plan for the org owner (sample; no Stripe) ──────────────────────────
-- (user 1 had no crm_subscriptions row in the lane; if one exists it is left alone and this insert is skipped)
insert into crm_subscriptions (user_id, stripe_customer_id, plan, status, billing_interval, current_period_end)
values (1, 'fs40-sample', 'crm_max', 'active', 'month', current_date + 21)
on conflict (user_id) do nothing;

-- ── org + team ──────────────────────────────────────────────────────────────
insert into crm_orgs (id, name, legal_entity_name, owner_user_id, email, phone, website, address_line1, city, state, postal_code, country,
  timezone, license_number, license_state, industry, description, estimate_footer, invoice_footer, default_deposit_bps,
  onboarding_dismissed_at, custom_fields, created_at, updated_at)
values ('40000000-0000-4000-8000-000000000001', 'Summit Roofing Co.', 'Summit Roofing Co. LLC', 1, 'office@summitroofing.example',
  '(303) 555-0140', 'https://summitroofing.example', '100 Sample St', 'Denver', 'CO', '80202', 'US', 'America/Denver', 'SAMPLE-RC-0140', 'CO',
  'Roofing & Gutters', 'Residential and light-commercial roofing, gutters and storm repair across the Denver metro.',
  'Thank you for considering Summit Roofing Co.', 'Thank you for your business.', 3000, now() - interval '200 days',
  '{"sms": {"mode": "dedicated", "fromNumber": "+13035550142"}, "smsEstimates": true, "smsAlerts": true, "voiceNudge": false, "themeColor": "orange"}',
  now() - interval '400 days', now());

-- Sam's membership is dated first so it is user 1's default (oldest) CRM org.
insert into crm_members (id, org_id, user_id, email, role, status, display_name, title, phone, calendar_color, hourly_cost_cents, last_active_at, created_at, sms_consent_at, sms_consent_phone) values
 ('40000000-0001-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'sam@summitroofing.example','owner','active','Sam Rivera','Owner','(303) 555-0141','#f97316',null, now() - interval '5 minutes', '2019-06-01', now() - interval '120 days', '+13035550141'),
 ('40000000-0001-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',null,'jess@summitroofing.example','office','active','Jess Morales','Office manager','(303) 555-0143','#8b5cf6',3200, now() - interval '2 hours', now() - interval '380 days', null, null),
 ('40000000-0001-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',null,'andre@summitroofing.example','sales','active','Andre Kim','Estimator','(303) 555-0144','#0ea5e9',3800, now() - interval '1 day', now() - interval '300 days', null, null),
 ('40000000-0001-4000-8000-000000000004','40000000-0000-4000-8000-000000000001',null,'tyler@summitroofing.example','field','active','Tyler Brooks','Crew lead','(303) 555-0145','#22c55e',4200, now() - interval '3 hours', now() - interval '260 days', null, null),
 ('40000000-0001-4000-8000-000000000005','40000000-0000-4000-8000-000000000001',null,'nina@summitroofing.example','field','active','Nina Patel','Roofer','(303) 555-0146','#eab308',3400, now() - interval '6 hours', now() - interval '150 days', null, null);

insert into crm_lead_sources (id, org_id, name) values
 ('40000000-000c-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Google Business Profile'),
 ('40000000-000c-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','Referral'),
 ('40000000-000c-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','Website form'),
 ('40000000-000c-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','Storm canvass');

-- ── clients ─────────────────────────────────────────────────────────────────
insert into crm_customers (id, org_id, display_name, first_name, last_name, company_name, email, phone, city, state, postal_code,
  lead_source_id, owner_member_id, tags, portal_token, follow_up_cadence_days, last_follow_up_at, created_at, updated_at)
select ('40000000-0002-4000-8000-0000000000' || lpad(n::text, 2, '0')), '40000000-0000-4000-8000-000000000001', dn, fn, ln, co, em, ph, ci, 'CO', zp,
  ('40000000-000c-4000-8000-00000000000' || src), ('40000000-0001-4000-8000-00000000000' || own), tg, 'fs40-portal-' || n,
  cad, case when cad is null then null else now() - (lf || ' days')::interval end,
  now() - (age || ' days')::interval, now() - (age / 3 || ' days')::interval
from (values
 ( 1,'Maria Delgado','Maria','Delgado',null,'maria.delgado@mail.example','(303) 555-0101','Denver','80205',1,3,array['hail claim'],null,null,38),
 ( 2,'Tom Becker','Tom','Becker',null,'tbecker@mail.example','(303) 555-0102','Lakewood','80226',2,3,array['gutters'],null,null,30),
 ( 3,'Priya & Dev Raman','Priya','Raman',null,'raman.family@mail.example','(303) 555-0103','Aurora','80012',1,3,array['re-roof'],null,null,26),
 ( 4,'Grant Holloway','Grant','Holloway',null,'grant.holloway@mail.example','(303) 555-0104','Littleton','80120',3,3,null,7,9,3),
 ( 5,'Elena Vasquez','Elena','Vasquez',null,'elena.v@mail.example','(303) 555-0105','Arvada','80002',1,3,array['leak'],null,null,9),
 ( 6,'Westgate Townhome HOA',null,null,'Westgate Townhome HOA','board@westgatehoa.example','(303) 555-0106','Denver','80219',2,1,array['commercial','hoa'],14,15,21),
 ( 7,'Owen & Kate Lindgren','Owen','Lindgren',null,'lindgren.home@mail.example','(303) 555-0107','Englewood','80110',4,3,array['hail claim'],7,6,12),
 ( 8,'Jasmine Clarke','Jasmine','Clarke',null,'jclarke@mail.example','(303) 555-0108','Wheat Ridge','80033',3,3,array['gutters'],null,null,16),
 ( 9,'Rafael Ortega','Rafael','Ortega',null,'rafael.ortega@mail.example','(303) 555-0109','Thornton','80229',1,3,array['metal roof'],7,2,4),
 (10,'Linda Park','Linda','Park',null,'linda.park@mail.example','(303) 555-0110','Centennial','80122',2,1,array['re-roof'],null,null,52),
 (11,'Marcus Webb','Marcus','Webb',null,'mwebb@mail.example','(303) 555-0111','Golden','80401',3,1,array['repair'],null,null,60),
 (12,'Sofia Nakamura','Sofia','Nakamura',null,'sofia.n@mail.example','(303) 555-0112','Broomfield','80020',1,1,array['ice dams'],null,null,45),
 (13,'Cedar Ridge Apartments',null,null,'Cedar Ridge Apartments','maintenance@cedarridgeapts.example','(303) 555-0113','Westminster','80031',2,1,array['commercial'],14,4,40),
 (14,'Ben & Alicia Foster','Ben','Foster',null,'fosters@mail.example','(303) 555-0114','Highlands Ranch','80129',2,1,array['re-roof'],null,null,75),
 (15,'Hannah Price','Hannah','Price',null,'hannah.price@mail.example','(303) 555-0115','Parker','80134',1,3,array['leak'],null,null,1),
 (16,'Derek Shaw','Derek','Shaw',null,'derek.shaw@mail.example','(303) 555-0116','Castle Rock','80104',4,3,array['hail claim'],null,null,6)
) as t(n, dn, fn, ln, co, em, ph, ci, zp, src, own, tg, cad, lf, age);

-- ── projects (the pipeline) ─────────────────────────────────────────────────
insert into crm_projects (id, org_id, customer_id, number, name, description, status, city, state, postal_code, trades,
  project_manager_member_id, sales_member_id, contract_value_cents, budget_cents, start_date, target_end_date, completed_at,
  stage_changed_at, created_at, updated_at, lat, lng)
select ('40000000-0003-4000-8000-0000000000' || lpad(n::text, 2, '0')), '40000000-0000-4000-8000-000000000001',
  ('40000000-0002-4000-8000-0000000000' || lpad(c::text, 2, '0')), 'P-' || (1040 + n), nm, null, st, ci, 'CO', zp, tr,
  '40000000-0001-4000-8000-000000000004', '40000000-0001-4000-8000-000000000003', val * 100, (val * 62), 
  case when sd is null then null else current_date + sd end, case when sd is null then null else current_date + sd + 4 end,
  case when st in ('complete','invoiced','paid') then now() - (moved || ' days')::interval else null end,
  now() - (moved || ' days')::interval - interval '3 hours', now() - (age || ' days')::interval, now() - (moved || ' days')::interval, la, lo
from (values
 ( 1, 1,'Hail damage roof replacement','in_progress','Denver','80205',array['roofing'],18450,-1,1,38,39.7480,-104.9590),
 ( 2, 2,'Seamless gutters and guards','scheduled','Lakewood','80226',array['gutters'],4860,3,4,30,39.7050,-105.0810),
 ( 3, 3,'Full tear-off, architectural shingles','approved','Aurora','80012',array['roofing'],21300,null,2,26,39.6990,-104.8370),
 ( 4, 4,'Roof inspection and repair','lead','Littleton','80120',array['roofing'],950,null,3,3,null,null),
 ( 5, 5,'Skylight reflash and leak repair','estimating','Arvada','80002',array['roofing'],2740,null,5,9,null,null),
 ( 6, 6,'Building C re-roof','proposal_sent','Denver','80219',array['roofing','gutters'],64800,null,4,21,null,null),
 ( 7, 7,'Storm damage insurance claim','estimating','Englewood','80110',array['roofing'],15900,null,6,12,null,null),
 ( 8, 8,'Seamless gutters, front and back','proposal_sent','Wheat Ridge','80033',array['gutters'],3620,null,7,16,null,null),
 ( 9, 9,'Standing-seam metal roof upgrade','lead','Thornton','80229',array['roofing'],28500,null,2,4,null,null),
 (10,10,'Roof replacement','punch_list','Centennial','80122',array['roofing'],19750,-9,1,52,39.5800,-104.8770),
 (11,11,'Chimney flashing and cricket','complete','Golden','80401',array['roofing'],3180,-20,8,60,39.7550,-105.2210),
 (12,12,'Ice dam prevention and heat cable','invoiced','Broomfield','80020',array['roofing'],2450,-14,10,45,null,null),
 (13,13,'TPO flat roof section, Building 2','waiting_on_trades','Westminster','80031',array['roofing'],38200,-3,6,40,39.8370,-105.0370),
 (14,14,'Roof replacement','paid','Highlands Ranch','80129',array['roofing','gutters'],17600,-30,6,75,null,null),
 (15,15,'Roof leak over the garage','lead','Parker','80134',array['roofing'],1200,null,1,1,null,null),
 (16,16,'Roof and siding hail repair','estimating','Castle Rock','80104',array['roofing','siding'],32400,null,3,6,null,null)
) as t(n, c, nm, st, ci, zp, tr, val, sd, moved, age, la, lo);

-- ── estimates ───────────────────────────────────────────────────────────────
insert into crm_estimates (id, org_id, customer_id, project_id, number, title, status, subtotal_cents, discount_cents, tax_rate_bps, tax_cents,
  total_cents, approved_total_cents, deposit_cents, public_token, sent_at, sent_to_email, first_viewed_at, last_viewed_at, view_count,
  approved_at, signature_name, expires_at, created_by_member_id, created_at, updated_at)
select ('40000000-0004-4000-8000-0000000000' || lpad(p::text, 2, '0')), '40000000-0000-4000-8000-000000000001',
  ('40000000-0002-4000-8000-0000000000' || lpad(p::text, 2, '0')), ('40000000-0003-4000-8000-0000000000' || lpad(p::text, 2, '0')),
  'E-' || (2040 + p), ti, st, val * 100, 0, 0, 0, val * 100, case when st = 'approved' then val * 100 end, val * 30,
  'fs40-est-' || p, case when st <> 'draft' then now() - (sent || ' days')::interval end, em,
  case when st in ('viewed','approved') then now() - (sent || ' days')::interval + interval '2 hours' end,
  case when st in ('viewed','approved') then now() - (sent || ' days')::interval + interval '20 hours' end,
  case when st in ('viewed','approved') then vc else 0 end,
  case when st = 'approved' then now() - (sent || ' days')::interval + interval '1 day' end,
  case when st = 'approved' then sig end, now() + interval '30 days', '40000000-0001-4000-8000-000000000003',
  now() - (sent || ' days')::interval - interval '1 day', now() - (sent || ' days')::interval
from (values
 ( 1,'Hail damage roof replacement','approved',18450,40,'maria.delgado@mail.example',3,'Maria Delgado'),
 ( 2,'Seamless gutters and guards','approved',4860,9,'tbecker@mail.example',2,'Tom Becker'),
 ( 3,'Full tear-off, architectural shingles','approved',21300,3,'raman.family@mail.example',5,'Priya Raman'),
 ( 5,'Skylight reflash and leak repair','draft',2740,1,'elena.v@mail.example',0,null),
 ( 6,'Building C re-roof','viewed',64800,4,'board@westgatehoa.example',6,null),
 ( 7,'Storm damage insurance claim','sent',15900,1,'lindgren.home@mail.example',0,null),
 ( 8,'Seamless gutters, front and back','viewed',3620,7,'jclarke@mail.example',2,null),
 (10,'Roof replacement','approved',19750,48,'linda.park@mail.example',2,'Linda Park'),
 (11,'Chimney flashing and cricket','approved',3180,40,'mwebb@mail.example',1,'Marcus Webb'),
 (12,'Ice dam prevention and heat cable','approved',2450,30,'sofia.n@mail.example',2,'Sofia Nakamura'),
 (13,'TPO flat roof section, Building 2','approved',38200,20,'maintenance@cedarridgeapts.example',4,'Carla Nunez'),
 (14,'Roof replacement','approved',17600,70,'fosters@mail.example',3,'Ben Foster'),
 (16,'Roof and siding hail repair','draft',32400,0,'derek.shaw@mail.example',0,null)
) as t(p, ti, st, val, sent, em, vc, sig);

insert into crm_estimate_events (id, org_id, estimate_id, type, actor, created_at)
select '40000000-000b-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0004-4000-8000-0000000000' || lpad(p::text, 2, '0'), ty, ac, now() - (m || ' minutes')::interval
from (values
 ( 1, 3,'sent','40000000-0001-4000-8000-000000000003', 3*1440+120),
 ( 2, 3,'viewed',null, 3*1440),
 ( 3, 3,'approved',null, 2*1440+300),
 ( 4, 6,'sent','40000000-0001-4000-8000-000000000003', 4*1440),
 ( 5, 6,'viewed',null, 95),
 ( 6, 7,'sent','40000000-0001-4000-8000-000000000003', 1*1440+200),
 ( 7, 8,'sent','40000000-0001-4000-8000-000000000003', 7*1440),
 ( 8, 8,'viewed',null, 1*1440+60),
 ( 9, 2,'approved',null, 8*1440)
) as t(i, p, ty, ac, m);

-- ── invoices + payments ─────────────────────────────────────────────────────
insert into crm_invoices (id, org_id, customer_id, project_id, estimate_id, number, title, status, subtotal_cents, discount_cents, tax_rate_bps,
  tax_cents, total_cents, paid_cents, due_at, public_token, sent_at, sent_to_email, view_count, paid_at, created_at, updated_at)
select '40000000-0005-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0002-4000-8000-0000000000' || lpad(p::text, 2, '0'), '40000000-0003-4000-8000-0000000000' || lpad(p::text, 2, '0'),
  '40000000-0004-4000-8000-0000000000' || lpad(p::text, 2, '0'), 'INV-' || (3040 + i), ti, st, tot * 100, 0, 0, 0, tot * 100, paid * 100,
  now() + (due || ' days')::interval, 'fs40-inv-' || i, now() - (age || ' days')::interval, em, 1,
  case when st = 'paid' then now() - (age - 2 || ' days')::interval end, now() - (age || ' days')::interval, now() - (age || ' days')::interval
from (values
 (1, 1,'Deposit: hail damage roof replacement','paid',5535,5535,-30,32,'maria.delgado@mail.example'),
 (2,10,'Roof replacement','partial',19750,9875,4,10,'linda.park@mail.example'),
 (3,11,'Chimney flashing and cricket','paid',3180,3180,-12,18,'mwebb@mail.example'),
 (4,12,'Ice dam prevention and heat cable','sent',2450,0,9,5,'sofia.n@mail.example'),
 (5,14,'Roof replacement','paid',17600,17600,-20,28,'fosters@mail.example'),
 (6, 3,'Deposit: full tear-off','paid',6390,6390,5,3,'raman.family@mail.example'),
 (7,13,'Progress billing #1: TPO section','sent',19100,0,12,2,'maintenance@cedarridgeapts.example')
) as t(i, p, ti, st, tot, paid, due, age, em);

insert into crm_payments (id, org_id, customer_id, project_id, invoice_id, provider, purpose, amount_cents, currency, method, status, paid_at, created_at, updated_at, settled_cents, refunded_cents)
select '40000000-0006-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0002-4000-8000-0000000000' || lpad(p::text, 2, '0'), '40000000-0003-4000-8000-0000000000' || lpad(p::text, 2, '0'),
  '40000000-0005-4000-8000-0000000000' || lpad(inv::text, 2, '0'), pr, 'invoice', amt * 100, 'usd', me, 'succeeded',
  now() - (m || ' minutes')::interval, now() - (m || ' minutes')::interval, now() - (m || ' minutes')::interval, amt * 100, 0
from (values
 (1, 1,1,'stripe','ach',5535, 30*1440),
 (2,10,2,'stripe','card',9875, 6*1440+200),
 (3,11,3,'manual','check',3180, 16*1440),
 (4,14,5,'stripe','card',17600, 26*1440),
 (5, 3,6,'stripe','card',6390, 2*1440+240)
) as t(i, p, inv, pr, me, amt, m);

-- ── schedule (this week and the next two) ───────────────────────────────────
insert into crm_appointments (id, org_id, project_id, customer_id, title, notes, status, starts_at, ends_at, all_day, arrival_window_minutes,
  dispatched_member_ids, created_by_member_id, created_at, updated_at)
select '40000000-0007-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0003-4000-8000-0000000000' || lpad(p::text, 2, '0'), '40000000-0002-4000-8000-0000000000' || lpad(p::text, 2, '0'),
  ti, null, case when d < 0 then 'completed' else 'scheduled' end,
  ((now() at time zone 'America/New_York')::date + d + st::time) at time zone 'America/New_York', ((now() at time zone 'America/New_York')::date + d + st::time) at time zone 'America/New_York' + (hrs || ' hours')::interval, false, case when hrs <= 2 then 60 end,
  crew, '40000000-0001-4000-8000-000000000002', now() - interval '10 days', now() - interval '2 days'
from (values
 ( 1, 1,'Tear-off and dry-in', -2,'07:30',9, array['40000000-0001-4000-8000-000000000004','40000000-0001-4000-8000-000000000005']),
 ( 2, 1,'Shingle install', 0,'07:30',9, array['40000000-0001-4000-8000-000000000004','40000000-0001-4000-8000-000000000005']),
 ( 3,10,'Punch list walk-through', -1,'15:00',1, array['40000000-0001-4000-8000-000000000004']),
 ( 4, 4,'Roof inspection', 1,'10:00',1, array['40000000-0001-4000-8000-000000000003']),
 ( 5, 9,'Metal roof consultation', 1,'14:00',1, array['40000000-0001-4000-8000-000000000003']),
 ( 6, 2,'Gutter install', 3,'08:00',6, array['40000000-0001-4000-8000-000000000005']),
 ( 7,15,'Leak inspection', 2,'09:00',1, array['40000000-0001-4000-8000-000000000003']),
 ( 8, 7,'Adjuster meeting on site', 2,'13:00',2, array['40000000-0001-4000-8000-000000000003','40000000-0001-4000-8000-000000000001']),
 ( 9, 3,'Material delivery', 4,'08:00',2, array['40000000-0001-4000-8000-000000000004']),
 (10, 3,'Tear-off and install', 5,'07:00',10, array['40000000-0001-4000-8000-000000000004','40000000-0001-4000-8000-000000000005']),
 (11,13,'TPO crew, Building 2', 6,'07:30',9, array['40000000-0001-4000-8000-000000000004','40000000-0001-4000-8000-000000000005']),
 (12,10,'Final punch list fixes', 3,'13:30',3, array['40000000-0001-4000-8000-000000000004']),
 (13, 6,'HOA board walkthrough', 4,'16:00',1, array['40000000-0001-4000-8000-000000000001','40000000-0001-4000-8000-000000000003']),
 (14, 5,'Skylight measure', 2,'15:30',1, array['40000000-0001-4000-8000-000000000003']),
 (15,16,'Hail damage assessment', 8,'10:00',2, array['40000000-0001-4000-8000-000000000003']),
 (16,13,'TPO crew, Building 2 (day 2)', 7,'07:30',9, array['40000000-0001-4000-8000-000000000004','40000000-0001-4000-8000-000000000005']),
 (17, 8,'Gutter measure follow-up', 9,'11:00',1, array['40000000-0001-4000-8000-000000000003']),
 (18,12,'Heat cable check', 11,'09:30',1, array['40000000-0001-4000-8000-000000000005']),
 (19, 1,'Gutter reinstall and cleanup', 1,'08:00',5, array['40000000-0001-4000-8000-000000000005']),
 (20,11,'Warranty photo visit', -4,'11:00',1, array['40000000-0001-4000-8000-000000000004']),
 (21, 2,'Gutter measure', -5,'10:00',1, array['40000000-0001-4000-8000-000000000003']),
 (22,14,'Final inspection', -6,'14:00',1, array['40000000-0001-4000-8000-000000000004'])
) as t(i, p, ti, d, st, hrs, crew);

-- ── team activity (Home feed) ───────────────────────────────────────────────
insert into crm_team_activity (id, org_id, member_id, actor_label, type, title, link, created_at)
select '40000000-000a-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0001-4000-8000-00000000000' || mb, null, ty, ti, lk, now() - (m || ' minutes')::interval
from (values
 (1,2,'appointmentScheduled','scheduled Roof inspection for Grant Holloway','/crm/projects/40000000-0003-4000-8000-000000000004', 50),
 (2,4,'jobcamUploaded','added 4 photos to P-1041 Hail damage roof replacement','/crm/projects/40000000-0003-4000-8000-000000000001/jobcam', 140),
 (3,2,'appointmentScheduled','scheduled Gutter install for Tom Becker','/crm/projects/40000000-0003-4000-8000-000000000002', 26*60),
 (4,3,'appointmentScheduled','scheduled Adjuster meeting on site for Owen & Kate Lindgren','/crm/projects/40000000-0003-4000-8000-000000000007', 29*60),
 (5,1,'projectMoved','moved P-1053 TPO flat roof section to Waiting on Trades','/crm/projects/40000000-0003-4000-8000-000000000013', 3*1440),
 (6,2,'appointmentScheduled','scheduled Material delivery for Priya & Dev Raman','/crm/projects/40000000-0003-4000-8000-000000000003', 2*1440+100)
) as t(i, mb, ty, ti, lk, m);

-- ── client messages (portal thread) and text messages (client timeline) ─────
insert into crm_client_comments (id, org_id, customer_id, body, created_at, read_at, author_member_id)
select '40000000-0009-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0002-4000-8000-0000000000' || lpad(c::text, 2, '0'), b, now() - (m || ' minutes')::interval,
  case when rd then now() - (m || ' minutes')::interval + interval '5 minutes' end,
  case when au is null then null else '40000000-0001-4000-8000-00000000000' || au end
from (values
 ( 1, 1,'Hi! Will the crew need the garage cleared out tomorrow, or just the driveway?', 1500, true, null),
 ( 2, 1,'Just the driveway, Maria. Tyler and the crew arrive at 7:30 and the dumpster goes on the left side. We will tarp the flower beds.', 1480, true, 1),
 ( 3, 1,'Perfect, thank you. Saw the photos from today, the new underlayment looks great.', 240, true, null),
 ( 4, 1,'Glad you like it! Shingles go on today and we expect to finish by Monday afternoon.', 225, true, 4),
 ( 5, 6,'The board reviewed the Building C proposal. Can you price the gutter option separately?', 90, false, null),
 ( 6, 8,'Is the white or the almond gutter color more popular on brick homes?', 1*1440+30, true, null),
 ( 7, 8,'Almond usually blends better with red brick. I added both colors to your estimate so you can pick.', 1*1440, true, 3),
 ( 8, 9,'Do you have photos of a standing-seam roof you installed nearby?', 3*60, false, null),
 ( 9, 3,'We approved and paid the deposit. When is the material delivery?', 2*1440+200, true, null),
 (10, 3,'Thank you! Delivery is set for Wednesday at 8 AM, and the crew starts Thursday.', 2*1440+150, true, 2)
) as t(i, c, b, m, rd, au);

insert into crm_customer_notes (id, org_id, customer_id, author_member_id, body, created_at)
select '40000000-0008-4000-8000-0000000000' || lpad(i::text, 2, '0'), '40000000-0000-4000-8000-000000000001',
  '40000000-0002-4000-8000-0000000000' || lpad(c::text, 2, '0'), '40000000-0001-4000-8000-00000000000' || au, b, now() - (m || ' minutes')::interval
from (values
 (1, 1,2,'Message sent via text to (303) 555-0101: “Hi Maria, this is Jess at Summit Roofing. Your tear-off is confirmed for Thursday, crew arrives 7:30 AM.”', 3*1440+60),
 (2, 1,4,'Message sent via text to (303) 555-0101: “On our way! Tyler and Nina will be there in about 20 minutes.”', 2*1440+40),
 (3, 1,4,'Message sent via text to (303) 555-0101: “Underlayment is down and the roof is dried in for tonight. Photos are in your portal.”', 1320),
 (4, 1,2,'Adjuster approved the supplement for the drip edge and two extra squares. Updated the job budget.', 4*1440),
 (5, 1,4,'Message sent via text to (303) 555-0101: “Shingles going on today. We will text you when we are cleaning up.”', 260),
 (6, 3,2,'Message sent via text to (303) 555-0103: “Your shingles (Charcoal) are scheduled for delivery Wednesday 8 AM. Please keep the driveway clear.”', 1*1440+30),
 (7, 4,3,'Message sent via text to (303) 555-0104: “Hi Grant, Andre from Summit Roofing. See you tomorrow at 10 for the inspection.”', 45),
 (8, 7,3,'Insurance adjuster visit booked; homeowner wants a full replacement quote with Class 4 shingles.', 2*1440)
) as t(i, c, au, b, m);

-- ── JobCam ──────────────────────────────────────────────────────────────────
insert into jobcam_tags (id, org_id, name, color, created_by_member_id) values
 ('40000000-000f-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Before','#64748b','40000000-0001-4000-8000-000000000001'),
 ('40000000-000f-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','Damage','#ef4444','40000000-0001-4000-8000-000000000001'),
 ('40000000-000f-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','Progress','#f59e0b','40000000-0001-4000-8000-000000000001'),
 ('40000000-000f-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','After','#22c55e','40000000-0001-4000-8000-000000000001');

insert into jobcam_media (id, org_id, project_id, customer_id, uploader_member_id, kind, status, file_name, mime, bytes, rendition_bytes,
  r2_key_original, r2_key_display, r2_key_thumb, width, height, captured_at, uploaded_at, device_lat, device_lng, gps_accuracy_m,
  caption, caption_source, tags, starred, client_visible, created_at, updated_at)
select '40000000-000d-4000-8000-0000000000' || n, '40000000-0000-4000-8000-000000000001',
  '40000000-0003-4000-8000-0000000000' || lpad(p::text, 2, '0'), '40000000-0002-4000-8000-0000000000' || lpad(p::text, 2, '0'),
  '40000000-0001-4000-8000-00000000000' || by, 'photo', 'ready', 'IMG_' || (4400 + n::int) || '.jpg', 'image/jpeg', 412000 + n::int * 3100, 160000,
  'jobcam/40000000-0000-4000-8000-000000000001/40000000-000d-4000-8000-0000000000' || n || '/original.jpg',
  'jobcam/40000000-0000-4000-8000-000000000001/40000000-000d-4000-8000-0000000000' || n || '/display.jpg',
  'jobcam/40000000-0000-4000-8000-000000000001/40000000-000d-4000-8000-0000000000' || n || '/thumb.jpg',
  1600, 1200, now() - (m || ' minutes')::interval, now() - (m || ' minutes')::interval + interval '1 minute', la, lo, 6,
  cap, 'user', array[tg], st, cv, now() - (m || ' minutes')::interval, now() - (m || ' minutes')::interval
from (values
 ('01', 1,3,'Front slope before tear-off, missing tabs by the vent','Before',false,true, 6*1440+300, 39.7481,-104.9591),
 ('02', 1,3,'Hail hits marked on the north slope for the adjuster','Damage',true,false, 6*1440+280, 39.7480,-104.9589),
 ('03', 1,4,'Shingles and drip edge delivered, 34 bundles','Progress',false,false, 3*1440+90, 39.7479,-104.9590),
 ('04', 1,4,'Tear-off half done, decking looks solid','Progress',false,true, 2*1440+200, 39.7480,-104.9592),
 ('05', 1,5,'Synthetic underlayment and ice and water shield down','Progress',false,true, 1*1440+620, 39.7481,-104.9590),
 ('06', 1,4,'New Charcoal architectural shingles, ridge cap on','After',true,true, 140, 39.7480,-104.9591),
 ('07',10,5,'New 6-inch seamless gutter on the back side','After',false,true, 9*1440+60, 39.5801,-104.8771),
 ('08',11,4,'Step flashing and counter-flashing redone at the chimney','After',true,true, 20*1440+30, 39.7551,-105.2211),
 ('09',10,4,'Finished roof, front elevation','After',false,true, 9*1440+90, 39.5800,-104.8770),
 ('10', 7,3,'Hail bruising on the south slope, test square','Damage',false,false, 2*1440+30, null, null),
 ('11',13,4,'Existing membrane before the TPO section','Before',false,false, 4*1440+200, 39.8371,-105.0371),
 ('12', 2,3,'Old gutter pulling away at the corner','Before',false,false, 5*1440+45, 39.7051,-105.0811)
) as t(n, p, by, cap, tg, st, cv, m, la, lo);

insert into jobcam_org_usage (org_id, bytes, media_count, photo_count, video_count, storage_tier_gb, updated_at)
select org_id, sum(bytes + rendition_bytes), count(*), count(*), 0, 5, now() from jobcam_media
where org_id = '40000000-0000-4000-8000-000000000001' group by org_id;

commit;
