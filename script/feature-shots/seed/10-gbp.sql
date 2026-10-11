-- Feature-shot sample data, "gbp" group: Locations (Google Business Profile), Profile Guard + GMB Edit Monitor,
-- Posts & Photos, Ranking Grid, Competitor Intel, Mail Alerts, Domains. Sample data only, for user 1
-- ("Summit Roofing Co."). Lane DBs (constructhub_dev_*) only.
-- Idempotent: every row it inserts uses a fixed id in the 910000 range (or hangs off one, or uses a
-- 'sample-gbp-' marker), and is deleted first. Dates are relative to now() so the data stays fresh.
-- Businesses, people, phones (555-01xx), websites (*.example) and Google ids are fictional.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  -- A feature-shot lane database, or a walkthrough recording database (scripts/tutorials/db.ts: a
  -- constructhub_tut_* schema of the dev database, or such a database) — nothing else, ever.
  IF current_database() NOT LIKE 'constructhub\_dev\_%'
     AND current_schema() NOT LIKE 'constructhub\_tut\_%'
     AND current_database() NOT LIKE 'constructhub\_tut\_%' THEN
    RAISE EXCEPTION 'refusing to seed sample data into %', current_database();
  END IF;
END $$;

-- ===================================================================================================
-- Clean up (children first)
-- ===================================================================================================
DELETE FROM domain_jobs WHERE user_id = 1 AND id::text LIKE '00910000-%';
DELETE FROM mail_alert_messages WHERE id BETWEEN 910001 AND 910099;
DELETE FROM managed_domains WHERE id BETWEEN 910001 AND 910099;
DELETE FROM domain_connections WHERE id BETWEEN 910001 AND 910009;
DELETE FROM competitor_listings WHERE id BETWEEN 910001 AND 910199;
DELETE FROM competitor_scans WHERE id BETWEEN 910001 AND 910009;
DELETE FROM ranking_grid_results WHERE scan_id BETWEEN 910001 AND 910009;
DELETE FROM ranking_grid_scans WHERE id BETWEEN 910001 AND 910009;
DELETE FROM gmb_edit_history WHERE listing_id BETWEEN 910001 AND 910009;
DELETE FROM gmb_listings WHERE id BETWEEN 910001 AND 910009;
DELETE FROM gbp_content_jobs WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM gbp_content_style WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM gbp_guard_changes WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM gbp_guard WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM google_profile_reviews WHERE id BETWEEN 910001 AND 910009;
DELETE FROM gbp_daily_metrics WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM gbp_sync_status WHERE location_id BETWEEN 910001 AND 910003;
DELETE FROM business_locations WHERE id BETWEEN 910001 AND 910003;
DELETE FROM gbp_grants WHERE user_id = 1 AND google_subject = 'sample-gbp-subject-910001';

-- ===================================================================================================
-- Google connection (a sample grant row: no usable token; nothing here can call Google)
-- ===================================================================================================
INSERT INTO gbp_grants (user_id, google_subject, email, scopes, access_token, refresh_token, expires_at, reconnect_required, updated_at)
VALUES (1, 'sample-gbp-subject-910001', 'sam@summitroofing.example', ARRAY['openid','email','profile','https://www.googleapis.com/auth/business.manage'],
        NULL, NULL, now() + interval '3650 days', false, now() - interval '2 hours');

-- ===================================================================================================
-- Locations 910001-910003 (Denver, Aurora, Lakewood), linked to Google
-- ===================================================================================================
INSERT INTO business_locations (id, user_id, business_name, place_id, google_cid, address, city, state, zip_code, country, phone, website,
  description, categories, services, service_areas, hours, opening_date, open_status, social_profiles, tags,
  business_photo_count, customer_photo_count, notification_email, notify_fields, gbp_management_enabled, listings_count,
  review_count, new_review_count, monthly_views, avg_rank, avg_rating, created_at, updated_at,
  gbp_account_name, gbp_location_name, gbp_google_subject, gbp_unlinked_by_user)
OVERRIDING SYSTEM VALUE VALUES
 (910001, 1, 'Summit Roofing Co.', 'sample-place-summit-denver', NULL, NULL, 'Denver', 'CO', '80202', 'US', '(303) 555-0142', 'https://summitroofing.example',
  'Family-owned roofing contractor serving the Denver metro since 2011. Roof replacement, hail and storm repair, gutters and free inspections. Licensed and insured.',
  ARRAY['Roofing contractor','Gutter cleaning service','Siding contractor'],
  ARRAY['Roof replacement','Roof repair','Hail damage repair','Storm damage inspection','Asphalt shingle roofing','Metal roofing','Flat roof (TPO) installation','Gutter installation','Gutter guards','Skylight installation','Attic ventilation','Insurance claim help','Emergency roof tarping','Siding repair'],
  ARRAY['Denver, CO','Englewood, CO','Wheat Ridge, CO','Arvada, CO','Westminster, CO'],
  '{"Monday":"7:00 AM – 6:00 PM","Tuesday":"7:00 AM – 6:00 PM","Wednesday":"7:00 AM – 6:00 PM","Thursday":"7:00 AM – 6:00 PM","Friday":"7:00 AM – 6:00 PM","Saturday":"8:00 AM – 5:00 PM","Sunday":"Closed"}',
  '2011-04', 'OPEN', '{"facebook":"https://facebook.example/summitroofing","instagram":"https://instagram.example/summitroofing"}', ARRAY['hq'],
  0, 0, 'sam@summitroofing.example', ARRAY['title','phone','website'], true, 0,
  186, 3, 4820, 2.4, 4.8, now() - interval '400 days', now() - interval '1 hour',
  'accounts/9100000001', 'locations/9100010001', 'sample-gbp-subject-910001', false),
 (910002, 1, 'Summit Roofing Co. Aurora', 'sample-place-summit-aurora', NULL, NULL, 'Aurora', 'CO', '80012', 'US', '(720) 555-0167', 'https://summitroofing.example/aurora',
  'Our Aurora crew handles roof replacement, hail repair and gutters across Aurora, Centennial and Parker. Free drone roof inspections.',
  ARRAY['Roofing contractor','Gutter service'],
  ARRAY['Roof replacement','Roof repair','Hail damage repair','Drone roof inspection','Gutter installation','Insurance claim help','Emergency roof tarping','Metal roofing'],
  ARRAY['Aurora, CO','Centennial, CO','Parker, CO'],
  '{"Monday":"7:00 AM – 6:00 PM","Tuesday":"7:00 AM – 6:00 PM","Wednesday":"7:00 AM – 6:00 PM","Thursday":"7:00 AM – 6:00 PM","Friday":"7:00 AM – 6:00 PM","Saturday":"8:00 AM – 4:00 PM","Sunday":"Closed"}',
  '2016-09', 'OPEN', NULL, ARRAY['branch'],
  0, 0, 'sam@summitroofing.example', NULL, true, 0,
  94, 1, 2310, 3.6, 4.7, now() - interval '380 days', now() - interval '1 hour',
  'accounts/9100000001', 'locations/9100010002', 'sample-gbp-subject-910001', false),
 (910003, 1, 'Summit Roofing Co. Lakewood', 'sample-place-summit-lakewood', NULL, NULL, 'Lakewood', 'CO', '80226', 'US', '(303) 555-0185', 'https://summitroofing.example/lakewood',
  'Roofing, gutters and skylights for Lakewood, Golden and the west metro. Same-week estimates.',
  ARRAY['Roofing contractor','Skylight contractor'],
  ARRAY['Roof replacement','Roof repair','Skylight installation','Gutter installation','Hail damage repair','Attic ventilation'],
  ARRAY['Lakewood, CO','Golden, CO','Littleton, CO'],
  '{"Monday":"7:30 AM – 5:30 PM","Tuesday":"7:30 AM – 5:30 PM","Wednesday":"7:30 AM – 5:30 PM","Thursday":"7:30 AM – 5:30 PM","Friday":"7:30 AM – 5:30 PM","Saturday":"Closed","Sunday":"Closed"}',
  '2019-03', 'OPEN', NULL, ARRAY['branch'],
  0, 0, 'sam@summitroofing.example', NULL, true, 0,
  57, 0, 1340, 4.1, 4.9, now() - interval '360 days', now() - interval '1 hour',
  'accounts/9100000001', 'locations/9100010003', 'sample-gbp-subject-910001', false);

-- last_attempt is in the future so the lane's in-process sync scheduler (6-hour cadence) never tries to sync these
-- sample locations (the sample grant has no token; a failed sync would mark it reconnect_required and purge data).
INSERT INTO gbp_sync_status (location_id, kind, last_success, last_attempt, last_error)
SELECT l, k, now() - (interval '1 minute' * (11 + l % 7 * 3 + o)), now() + interval '30 days', NULL
FROM unnest(ARRAY[910001,910002,910003]) l, (VALUES ('profile',0),('reviews',1),('performance',2)) k(k,o);

-- Daily Google performance metrics, ~200 days, weekday-shaped with a gentle spring/summer upswing.
INSERT INTO gbp_daily_metrics (location_id, date, metric, value)
SELECT l.id, d::date, m.metric,
  greatest(0, round(m.base * l.scale
    * (CASE extract(dow FROM d) WHEN 0 THEN 0.55 WHEN 6 THEN 0.75 ELSE 1.0 END)
    * (1.0 + 0.35 * sin((extract(doy FROM d) - 80) / 365.0 * 2 * pi()))
    * (0.75 + ((hashtext(l.id || m.metric || d::date::text) & 1023) / 1023.0) * 0.5)))::bigint
FROM (VALUES (910001, 1.0), (910002, 0.55), (910003, 0.36)) l(id, scale),
     (VALUES ('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 22), ('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 38), ('BUSINESS_IMPRESSIONS_MOBILE_MAPS', 64),
             ('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 81), ('WEBSITE_CLICKS', 7), ('CALL_CLICKS', 5), ('BUSINESS_DIRECTION_REQUESTS', 3)) m(metric, base),
     generate_series(current_date - 200, current_date - 3, interval '1 day') d;

-- (Google reviews for these locations come from 20-reviews.sql.)

-- ===================================================================================================
-- Profile Guard (gbp_guard, gbp_guard_changes)
-- ===================================================================================================
-- last_attempt in the future keeps the lane's Profile Guard worker (every minute) from checking Google with the
-- token-less sample grant, which would invalidate the grant and purge the sample data.
INSERT INTO gbp_guard (location_id, user_id, mode, watched, snapshot, observed, checked_at, last_attempt, last_error, updated_at)
SELECT l.id, 1, l.mode,
  ARRAY['title','phoneNumbers','websiteUri','storefrontAddress','categories','profile.description','regularHours','specialHours','serviceArea','openInfo.openingDate','openInfo.status'],
  jsonb_build_object(
    'title', l.name,
    'phoneNumbers', jsonb_build_object('primaryPhone', l.phone),
    'websiteUri', l.site,
    'storefrontAddress', jsonb_build_object('locality', l.city, 'administrativeArea', 'CO', 'postalCode', l.zip, 'regionCode', 'US'),
    'categories', jsonb_build_object('primaryCategory', jsonb_build_object('name', 'categories/gcid:roofing_contractor'), 'additionalCategories', '[]'::jsonb),
    'profile.description', l.descr,
    'regularHours', NULL, 'specialHours', NULL, 'serviceArea', NULL,
    'openInfo.openingDate', jsonb_build_object('year', l.oy, 'month', l.om),
    'openInfo.status', 'OPEN'),
  '{}'::jsonb, now() - (l.ago * interval '1 minute'), now() + interval '30 days', NULL, now() - interval '20 days'
FROM (VALUES
  (910001, 'notify',   'Summit Roofing Co.',          '(303) 555-0142', 'https://summitroofing.example',          'Denver',   '80202', 'Family-owned roofing contractor serving the Denver metro since 2011. Roof replacement, hail and storm repair, gutters and free inspections. Licensed and insured.', 2011, 4, 6),
  (910002, 'lockdown', 'Summit Roofing Co. Aurora',   '(720) 555-0167', 'https://summitroofing.example/aurora',   'Aurora',   '80012', 'Our Aurora crew handles roof replacement, hail repair and gutters across Aurora, Centennial and Parker. Free drone roof inspections.', 2016, 9, 9),
  (910003, 'notify',   'Summit Roofing Co. Lakewood', '(303) 555-0185', 'https://summitroofing.example/lakewood', 'Lakewood', '80226', 'Roofing, gutters and skylights for Lakewood, Golden and the west metro. Same-week estimates.', 2019, 3, 13)
) l(id, mode, name, phone, site, city, zip, descr, oy, om, ago);

INSERT INTO gbp_guard_changes (id, location_id, user_id, field, old_value, new_value, source, evidence, detected_at, status, resolved_at, reported_at, error)
VALUES
 (910006, 910001, 1, 'websiteUri', '"https://summitroofing.example"', '"https://summit-roofing-deals.example"', 'Google update',
  '{"diffMask":"websiteUri","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"liveValue":"https://summitroofing.example","googleValue":"https://summit-roofing-deals.example","attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '47 minutes', 'pending', NULL, NULL, NULL),
 (910005, 910001, 1, 'categories', '{"primaryCategory":{"name":"categories/gcid:roofing_contractor"},"additionalCategories":[]}', '{"primaryCategory":{"name":"categories/gcid:general_contractor"},"additionalCategories":[]}', 'Google update',
  '{"diffMask":"categories","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '3 hours', 'pending', NULL, NULL, NULL),
 (910004, 910001, 1, 'phoneNumbers', '{"primaryPhone":"(303) 555-0142"}', '{"primaryPhone":"(303) 555-0199"}', 'Google update',
  '{"diffMask":"phoneNumbers","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '4 days 2 hours', 'reverted', now() - interval '4 days 1 hour', now() - interval '4 days', NULL),
 (910003, 910001, 1, 'title', '"Summit Roofing Co."', '"Summit Roofing Co. - Best Roofer Denver"', 'Google update',
  '{"diffMask":"title","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '11 days', 'reverted', now() - interval '11 days' + interval '20 minutes', NULL, NULL),
 (910002, 910001, 1, 'profile.description', '"Family-owned roofing contractor serving the Denver metro. Roof replacement, hail repair and gutters."', '"Family-owned roofing contractor serving the Denver metro since 2011. Roof replacement, hail and storm repair, gutters and free inspections. Licensed and insured."', 'owner-edit-outside-ConstructHUB (inferred; actor unavailable)',
  '{"diffMask":"","pendingMask":"","hasGoogleUpdated":false,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '19 days', 'approved', now() - interval '19 days' + interval '2 hours', NULL, NULL),
 (910001, 910001, 1, 'openInfo.status', '"OPEN"', '"CLOSED_TEMPORARILY"', 'Google update',
  '{"diffMask":"openInfo.status","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '26 days', 'reverted', now() - interval '26 days' + interval '15 minutes', now() - interval '26 days' + interval '1 hour', NULL),
 (910007, 910002, 1, 'websiteUri', '"https://summitroofing.example/aurora"', '"https://summitroofing.example"', 'Google update',
  '{"diffMask":"websiteUri","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '6 days', 'reverted', now() - interval '6 days' + interval '15 minutes', NULL, NULL),
 (910008, 910003, 1, 'phoneNumbers', '{"primaryPhone":"(303) 555-0185"}', '{"primaryPhone":"(303) 555-0111"}', 'Google update',
  '{"diffMask":"phoneNumbers","pendingMask":"","hasGoogleUpdated":true,"hasPendingEdits":false,"attribution":"Google does not identify the editor or distinguish public suggestions from other Google updates."}',
  now() - interval '1 day 5 hours', 'pending', NULL, NULL, NULL);

-- GMB Edit Monitor (on-demand checks): gmb_listings + gmb_edit_history
INSERT INTO gmb_listings (id, user_id, place_id, business_name, address, phone, website, category, hours, photo_count, rating, review_count, is_monitoring, last_checked_at, created_at)
OVERRIDING SYSTEM VALUE VALUES
 (910001, 1, 'sample-place-summit-denver',   'Summit Roofing Co.',          'Denver, CO 80202',   '(303) 555-0142', 'https://summitroofing.example',          'Roofing contractor', 'Mon–Fri 7 AM–6 PM, Sat 8 AM–5 PM', 148, '4.8', 186, true, now() - interval '3 hours', now() - interval '30 days'),
 (910002, 1, 'sample-place-summit-aurora',   'Summit Roofing Co. Aurora',   'Aurora, CO 80012',   '(720) 555-0167', 'https://summitroofing.example/aurora',   'Roofing contractor', 'Mon–Fri 7 AM–6 PM, Sat 8 AM–4 PM', 71, '4.7', 94, true, now() - interval '3 hours', now() - interval '31 days'),
 (910003, 1, 'sample-place-summit-lakewood', 'Summit Roofing Co. Lakewood', 'Lakewood, CO 80226', '(303) 555-0185', 'https://summitroofing.example/lakewood', 'Roofing contractor', 'Mon–Fri 7:30 AM–5:30 PM', 39, '4.9', 57, true, now() - interval '1 day', now() - interval '32 days'),
 (910004, 1, 'sample-place-clearpeak',        'Clearpeak Exteriors',          'Denver, CO 80216',   '(303) 555-0123', 'https://clearpeakexteriors.example',      'Roofing contractor', 'Mon–Sat 7 AM–7 PM', 212, '4.6', 311, false, now() - interval '8 days', now() - interval '45 days');

INSERT INTO gmb_edit_history (id, listing_id, field_changed, old_value, new_value, detected_at)
OVERRIDING SYSTEM VALUE VALUES
 (910001, 910001, 'website',     'https://summitroofing.example', 'https://summit-roofing-deals.example', now() - interval '3 hours'),
 (910002, 910001, 'category',    'Roofing contractor', 'General contractor', now() - interval '3 hours'),
 (910003, 910001, 'reviewCount', '179', '186', now() - interval '3 hours'),
 (910004, 910001, 'photoCount',  '141', '148', now() - interval '6 days'),
 (910005, 910001, 'phone',       '(303) 555-0142', '(303) 555-0199', now() - interval '4 days'),
 (910006, 910001, 'hours',       'Mon–Fri 7 AM–6 PM', 'Mon–Fri 7 AM–6 PM, Sat 8 AM–5 PM', now() - interval '15 days'),
 (910007, 910001, 'rating',      '4.7', '4.8', now() - interval '22 days'),
 (910008, 910002, 'website',     'https://summitroofing.example/aurora', 'https://summitroofing.example', now() - interval '6 days'),
 (910009, 910002, 'reviewCount', '90', '94', now() - interval '3 hours'),
 (910010, 910004, 'businessName','Clearpeak Exteriors', 'Clearpeak Exteriors - Roofing & Hail Repair Denver', now() - interval '8 days');

-- ===================================================================================================
-- Posts & Photos (gbp_content_jobs, gbp_content_style)
-- ===================================================================================================
INSERT INTO gbp_content_style (user_id, location_id, summary, updated_at) VALUES
 (1, 910001, 'Friendly, plain-spoken and local. Lead with the homeowner benefit, mention the Denver neighborhood when we know it, keep posts under 120 words, one clear call to action (free inspection or call). No exclamation-mark stacks, no hype, no prices.', now() - interval '12 days');

INSERT INTO gbp_content_jobs (id, user_id, location_id, request_key, item_index, kind, payload, target, due_at, status, google_name, google_status, error, attempts, started_at, created_at, schedule, source)
SELECT 910000 + j.n, 1, 910001, 'sample-gbp-req-' || j.batch, j.idx, j.kind,
  CASE WHEN j.kind = 'post'
    THEN jsonb_build_object('languageCode','en','topicType','STANDARD','summary', j.txt, 'callToAction', jsonb_build_object('actionType','CALL'))
    ELSE jsonb_build_object('mediaFormat','PHOTO','sourceUrl','r2:sample/' || j.n || '.jpg','locationAssociation', jsonb_build_object('category', j.cat), 'description', j.txt) END,
  '{"account":"accounts/9100000001","location":"locations/9100010001","subject":"sample-gbp-subject-910001"}',
  now() + j.due, j.status, NULL, CASE WHEN j.status = 'published' AND j.kind = 'post' THEN 'LIVE' END, NULL,
  CASE WHEN j.status = 'published' THEN 1 ELSE 0 END, CASE WHEN j.status = 'published' THEN now() + j.due END,
  now() - interval '24 days', '{"everyMinutes":1440,"businessHours":true,"timezone":"America/Denver","openHour":9,"closeHour":17,"weekdays":[1,2,3,4,5]}', 'manual'
FROM (VALUES
  (1,  'a', 0, 'post',  NULL,       interval '-21 days', 'published', 'Hail season recap: our crews inspected over 300 Denver roofs this summer. If the June storms hit your street, book a free inspection before the snow flies. Call (303) 555-0142.'),
  (2,  'a', 1, 'post',  NULL,       interval '-17 days', 'published', 'Is your attic ready for winter? Poor ventilation causes ice dams on Denver roofs. We check intake and exhaust vents with every free roof inspection.'),
  (3,  'b', 0, 'photo', 'AT_WORK',  interval '-14 days', 'published', 'Tear-off and new architectural shingles on a ranch home in Wheat Ridge, finished in one day.'),
  (4,  'b', 1, 'photo', 'AT_WORK',  interval '-13 days', 'published', 'Crew installing seamless 6-inch gutters and leaf guards in Arvada.'),
  (5,  'b', 2, 'photo', 'EXTERIOR', interval '-12 days', 'published', 'Standing-seam metal roof in charcoal gray on a Denver Highlands home.'),
  (6,  'a', 2, 'post',  NULL,       interval '-10 days', 'published', 'Meet Tom, our Englewood project lead with 15 years on Colorado roofs. Every Summit job has one lead from estimate to final walkthrough.'),
  (7,  'c', 0, 'post',  NULL,       interval '-6 days',  'published', 'Insurance adjuster coming out? We meet them on the roof and document every hail strike with photos, at no cost to you.'),
  (8,  'd', 0, 'photo', 'AT_WORK',  interval '-3 days',  'published', 'Emergency tarp after last week''s windstorm in Westminster, on site within three hours.'),
  (9,  'c', 1, 'post',  NULL,       interval '1 day 2 hours',  'queued', 'Fall gutter clean-out slots are open for October. Clear gutters keep meltwater off your fascia and out of your basement. Call to book.'),
  (10, 'd', 1, 'photo', 'TEAMS',    interval '2 days 4 hours', 'queued', 'The Summit Roofing Denver crew after finishing our 500th roof of the year.'),
  (11, 'c', 2, 'post',  NULL,       interval '4 days 1 hour',  'queued', 'Thinking about solar? A new roof first saves you from pulling panels later. Ask us about solar-ready roof replacement.'),
  (12, 'd', 2, 'photo', 'EXTERIOR', interval '6 days 3 hours', 'queued', 'Before and after: cedar shake to impact-resistant Class 4 shingles in Littleton.'),
  (13, 'c', 3, 'post',  NULL,       interval '8 days 2 hours', 'queued', 'Snow is coming. Our free 21-point roof check looks at flashing, vents, gutters and attic insulation before winter.')
) j(n, batch, idx, kind, cat, due, status, txt);

-- ===================================================================================================
-- Ranking Grid: scans 910001-910003, results computed from distance to the center (rank 1 near the shop)
-- ===================================================================================================
INSERT INTO ranking_grid_scans (id, user_id, business_name, place_id, address, lat, lon, grid_size, grid_distance, keyword, status, average_rank, created_at)
OVERRIDING SYSTEM VALUE VALUES
 (910001, 1, 'Summit Roofing Co.',        'sample-place-summit-denver', 'Denver, CO 80202', '39.7392', '-104.9903', 7, '1', 'roofing contractor', 'completed', NULL, now() - interval '2 days 3 hours'),
 (910002, 1, 'Summit Roofing Co.',        'sample-place-summit-denver', 'Denver, CO 80202', '39.7392', '-104.9903', 5, '1', 'roof repair',        'completed', NULL, now() - interval '9 days'),
 (910003, 1, 'Summit Roofing Co. Aurora', 'sample-place-summit-aurora', 'Aurora, CO 80012', '39.7294', '-104.8319', 5, '1.5', 'hail damage roof repair', 'completed', NULL, now() - interval '16 days');

WITH s AS (SELECT * FROM (VALUES (910001, 39.7392, -104.9903, 7, 1.0, 1.15), (910002, 39.7392, -104.9903, 5, 1.0, 1.6), (910003, 39.7294, -104.8319, 5, 1.5, 2.3)) v(id, lat, lon, size, mi, k)),
cells AS (
  SELECT s.id AS scan_id, r AS grid_row, c AS grid_col,
    s.lat + ((s.size / 2) - r) * s.mi / 69.0 AS lat,
    s.lon + (c - (s.size / 2)) * s.mi / 53.0 AS lon,
    sqrt(power(r - s.size / 2, 2) + power(c - s.size / 2, 2)) * s.mi AS dist, s.k,
    (hashtext(s.id || '-' || r || '-' || c) & 7) AS jitter
  FROM s, generate_series(0, s.size - 1) r, generate_series(0, s.size - 1) c),
ranked AS (
  SELECT *, CASE WHEN round(1 + power(dist, 1.6) * k + (jitter - 2) * 0.6) > 20 THEN NULL
                 ELSE greatest(1, round(1 + power(dist, 1.6) * k + (jitter - 2) * 0.6))::int END AS rank FROM cells)
INSERT INTO ranking_grid_results (id, scan_id, grid_row, grid_col, lat, lon, rank, total_results, top_competitors, checked_at)
OVERRIDING SYSTEM VALUE
SELECT (scan_id - 910000) * 1000 + 910000000 + grid_row * 20 + grid_col, scan_id, grid_row, grid_col, round(lat::numeric, 6)::text, round(lon::numeric, 6)::text,
  rank, 20,
  jsonb_build_array(
    jsonb_build_object('name', CASE WHEN rank = 1 THEN 'Summit Roofing Co.' ELSE (ARRAY['Clearpeak Exteriors','Cobalt Ridge Roofing','Larkspur Roof & Siding','Quarry Peak Exteriors'])[1 + (jitter % 4)] END, 'address', 'Denver, CO', 'rank', 1),
    jsonb_build_object('name', (ARRAY['Front Range Gutters','Halcyon Roof Pros','Brightpine Roofing','Northgate Storm Restoration'])[1 + ((jitter + 1) % 4)], 'address', 'Denver, CO', 'rank', 2),
    jsonb_build_object('name', CASE WHEN rank = 3 THEN 'Summit Roofing Co.' ELSE (ARRAY['Cobalt Ridge Roofing','Larkspur Roof & Siding','Clearpeak Exteriors','Halcyon Roof Pros'])[1 + ((jitter + 2) % 4)] END, 'address', 'Denver, CO', 'rank', 3)),
  (SELECT created_at FROM ranking_grid_scans WHERE id = scan_id) + interval '2 minutes'
FROM ranked;

UPDATE ranking_grid_scans s SET average_rank = (SELECT to_char(avg(rank), 'FM990.0') FROM ranking_grid_results r WHERE r.scan_id = s.id AND r.rank IS NOT NULL)
WHERE s.id BETWEEN 910001 AND 910003;

-- ===================================================================================================
-- Competitor Intel: market scans 910001-910002 with fictional competitors
-- ===================================================================================================
INSERT INTO competitor_scans (id, user_id, industry, location, lat, lon, radius, status, total_found, created_at, error_message)
OVERRIDING SYSTEM VALUE VALUES
 -- 910001 is always inside the current calendar month (UTC), even on the 1st-3rd, so the
 -- "N of M used this month" line under the form counts at least the newest scan in the list.
 (910001, 1, 'Roofing Contractor', 'Denver, CO', '39.7392', '-104.9903', 25, 'completed', 12,
   greatest(now() - interval '3 days', (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '5 minutes'), NULL),
 (910002, 1, 'Gutter Service',     'Aurora, CO', '39.7294', '-104.8319', 15, 'completed', 8,  now() - interval '18 days', NULL);

-- The usage line reads the monthly meter (server/growth-quotas.ts quotaKey: quota:user:<id>:competitorScans:<YYYY-MM>,
-- UTC), not the scan rows, so set this month's count to the scans the list shows for this month.
INSERT INTO growth_budgets (key, period, used)
SELECT 'quota:user:1:competitorScans:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), '0', count(*)::int
FROM competitor_scans
WHERE user_id = 1 AND status = 'completed'
  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
ON CONFLICT (key, period) DO UPDATE SET used = EXCLUDED.used;

INSERT INTO competitor_listings (id, scan_id, user_id, place_id, business_name, address, phone, website, rating, review_count, category, is_new, bs_score, bs_reasons, review_analysis, rank_history, last_checked_at, first_seen_at)
OVERRIDING SYSTEM VALUE
SELECT 910000 + n, scan, 1, 'sample-place-comp-' || n, name, addr, phone, site, rating, reviews, cat, is_new, NULL, NULL,
  jsonb_build_object('totalAnalyzed', tot, 'goodReviews', good, 'badReviews', tot - good, 'reviewsLookingAi', ai, 'reviewsGeneric', gen,
    'reviewsWithPhotos', ph, 'reviewsWithRealNames', rn, 'blockedProfiles', bl, 'oldestReviewAge', age,
    'aiSuspectReviews', CASE WHEN ai >= 5 THEN '[{"author":"J. Smith","rating":5,"text":"Absolutely amazing service from start to finish, highly recommend to anyone looking for a roofer!"},{"author":"K. Lee","rating":5,"text":"Absolutely amazing service, professional team, highly recommend to anyone!"}]'::jsonb ELSE '[]'::jsonb END,
    'genericReviews', CASE WHEN gen >= 6 THEN '[{"author":"R. Allen","text":"Great job."},{"author":"D. Moore","text":"Good company, would use again."}]'::jsonb ELSE '[]'::jsonb END),
  NULL, now() - interval '3 days', now() - (first_seen * interval '1 day')
FROM (VALUES
  (1,  910001, 'Clearpeak Exteriors',                       'Denver, CO 80216',      '(303) 555-0123', 'https://clearpeakexteriors.example',    '4.6', 311, 'Roofing contractor', false, 20, 16, 2, 4, 9, 17, 1, '6 years',  120),
  (2,  910001, 'Cobalt Ridge Roofing',                     'Englewood, CO 80110',   '(303) 555-0131', 'https://cobaltridge.example',          '4.9', 142, 'Roofing contractor', false, 20, 19, 3, 5, 6, 18, 0, '4 years',  120),
  (3,  910001, 'Best Cheap Roofers Near Me Denver',        NULL,                    '(720) 555-0108', 'https://cheaproofersdenver.example',  '5.0', 87,  'Roofing contractor', true,  20, 20, 12, 14, 1, 9, 6, '5 months', 21),
  (4,  910001, 'Front Range Gutters',                      'Wheat Ridge, CO 80033', '(303) 555-0154', 'https://frontrangegutters.example',    '4.7', 203, 'Gutter cleaning service', false, 20, 17, 1, 5, 7, 18, 1, '8 years', 120),
  (5,  910001, 'Larkspur Roof & Siding',                   'Lakewood, CO 80226',    '(303) 555-0172', 'https://larkspurroof.example',         '4.5', 96,  'Siding contractor', false, 20, 16, 2, 6, 5, 16, 2, '5 years',  120),
  (6,  910001, 'Halcyon Roof Pros',                        'Arvada, CO 80002',      '(720) 555-0115', 'https://halcyonroofpros.example',      '4.8', 64,  'Roofing contractor', true,  20, 18, 6, 9, 3, 13, 3, '1 year',   12),
  (7,  910001, 'Quarry Peak Exteriors',                    'Littleton, CO 80120',   '(303) 555-0193', 'https://quarrypeak.example',           '4.4', 178, 'Roofing contractor', false, 20, 15, 1, 5, 6, 18, 1, '9 years',  120),
  (8,  910001, 'Brightpine Roofing',                       'Westminster, CO 80031', '(303) 555-0137', 'https://brightpineroofing.example',    '4.7', 121, 'Roofing contractor', false, 20, 18, 2, 7, 4, 17, 1, '7 years',  120),
  (9,  910001, 'Northgate Storm Restoration',              'Thornton, CO 80229',    '(720) 555-0146', 'https://northgatestorm.example',       '4.9', 233, 'Roofing contractor', false, 20, 20, 7, 10, 2, 12, 4, '2 years', 120),
  (10, 910001, 'Granite Line Roofing',                     'Denver, CO 80211',      '(303) 555-0161', 'https://granitelineroofing.example',   '4.3', 58,  'Roofing contractor', false, 20, 14, 1, 6, 4, 17, 2, '6 years',  120),
  (11, 910001, 'Top Rated #1 Affordable Roofing Denver',   'Denver, CO 80204',      '(720) 555-0189', 'https://toprated-roofing.example',     '5.0', 41,  'Roofing contractor', true,  20, 20, 9, 13, 0, 8, 7, '3 months', 9),
  (12, 910001, 'Aspen Hollow Roofing',                     'Centennial, CO 80112',  '(303) 555-0178', 'https://aspenhollowroofing.example',   '4.6', 77,  'Roofing contractor', false, 20, 17, 2, 6, 5, 17, 1, '5 years',  120),
  (21, 910002, 'Front Range Gutters',                      'Aurora, CO 80014',      '(303) 555-0154', 'https://frontrangegutters.example',    '4.7', 203, 'Gutter cleaning service', false, 20, 17, 1, 5, 7, 18, 1, '8 years', 120),
  (22, 910002, 'Clearflow Gutter Co.',                     'Aurora, CO 80012',      '(720) 555-0121', 'https://clearflowgutter.example',      '4.8', 89,  'Gutter service', false, 20, 19, 2, 6, 5, 17, 1, '6 years', 120),
  (23, 910002, 'Rainline Seamless Gutters',                'Centennial, CO 80015',  '(303) 555-0132', 'https://rainline.example',             '4.5', 54,  'Gutter service', false, 20, 16, 1, 7, 3, 16, 2, '4 years', 120),
  (24, 910002, 'Best Gutter Cleaning Near Me Aurora',      NULL,                    '(720) 555-0102', 'https://guttercleaningaurora.example', '5.0', 33,  'Gutter cleaning service', true, 20, 20, 10, 13, 0, 8, 6, '4 months', 16),
  (25, 910002, 'Clearpeak Exteriors',                       'Aurora, CO 80011',      '(303) 555-0123', 'https://clearpeakexteriors.example',    '4.6', 311, 'Roofing contractor', false, 20, 16, 2, 4, 9, 17, 1, '6 years', 120),
  (26, 910002, 'Cherry Creek Gutter Guys',                 'Aurora, CO 80013',      '(720) 555-0158', 'https://ccgutterguys.example',         '4.4', 47,  'Gutter service', false, 20, 15, 1, 6, 4, 16, 2, '3 years', 120),
  (27, 910002, 'Summit Roofing Co. Aurora',                'Aurora, CO 80012',      '(720) 555-0167', 'https://summitroofing.example/aurora', '4.7', 94,  'Roofing contractor', false, 20, 18, 1, 4, 8, 19, 0, '8 years', 120),
  (28, 910002, 'Hailstone Gutter & Roof',                  'Parker, CO 80134',      '(303) 555-0119', 'https://hailstonegutter.example',      '4.6', 72,  'Gutter service', false, 20, 17, 2, 6, 5, 17, 1, '5 years', 120)
) v(n, scan, name, addr, phone, site, rating, reviews, cat, is_new, tot, good, ai, gen, ph, rn, bl, age, first_seen);

-- ===================================================================================================
-- Domains: registrar connections, managed domains, DNS change previews
-- ===================================================================================================
INSERT INTO domain_connections (id, user_id, provider, label, credentials, created_at) VALUES
 (910001, 1, 'porkbun', 'Summit main account', 'sample-not-a-credential', now() - interval '70 days'),
 (910002, 1, 'namecom', 'Marketing domains',   'sample-not-a-credential', now() - interval '40 days');

INSERT INTO managed_domains (id, user_id, connection_id, domain, location_id, registrar, state, observed, checked_at, next_check)
SELECT 910000 + n, 1, conn, dom, loc, reg,
  jsonb_build_object('expires', (now() + exp)::text, 'autoRenew', ar, 'nameservers', to_jsonb(ns)),
  NULL, now() - chk, now() + interval '20 hours'
FROM (VALUES
  (1, 910001, 'summitroofing.example',          910001, 'porkbun', interval '214 days', true,  ARRAY['ns1.dnshost.example','ns2.dnshost.example'], interval '42 minutes'),
  (2, 910001, 'summitroofing-aurora.example',   910002, 'porkbun', interval '301 days', true,  ARRAY['ns1.dnshost.example','ns2.dnshost.example'], interval '42 minutes'),
  (3, 910001, 'summitroofing-lakewood.example', 910003, 'porkbun', interval '118 days', true,  ARRAY['ns1.dnshost.example','ns2.dnshost.example'], interval '43 minutes'),
  (4, 910002, 'denverhailrepair.example',       910001, 'namecom', interval '26 days',  false, ARRAY['ns1.namehost.example','ns2.namehost.example'], interval '2 hours'),
  (5, 910002, 'summitgutters.example',          910001, 'namecom', interval '163 days', true,  ARRAY['ns1.namehost.example','ns2.namehost.example'], interval '2 hours'),
  (6, 910002, 'freeroofinspectiondenver.example', NULL, 'namecom', interval '57 days',  true,  ARRAY['ns1.namehost.example','ns2.namehost.example'], interval '2 hours'),
  (7, NULL,   'summitroofing-careers.example',  910001, 'manual',  interval '340 days', true,  ARRAY['ns1.dnshost.example','ns2.dnshost.example'], interval '5 hours'),
  (8, NULL,   'aurorahailclaims.example',       910002, 'manual',  interval '12 days',  false, ARRAY['ns1.parkedns.example','ns2.parkedns.example'], interval '5 hours')
) v(n, conn, dom, loc, reg, exp, ar, ns, chk);

INSERT INTO domain_jobs (id, user_id, domain_id, connection_id, kind, status, payload, before_state, after_state, result, error, created_at, updated_at, run_at, expires_at, attempts)
VALUES
 ('00910000-0000-4000-8000-000000000001', 1, 910001, 910001, 'change', 'ready',
  '{"kind":"create","record":{"type":"TXT","name":"@","content":"google-site-verification=sample-910001","ttl":600}}',
  '{"nameservers":["ns1.dnshost.example","ns2.dnshost.example"],"records":[{"type":"A","name":"@","content":"192.0.2.10","ttl":600},{"type":"CNAME","name":"www","content":"summitroofing.example","ttl":600}]}',
  '{"nameservers":["ns1.dnshost.example","ns2.dnshost.example"],"records":[{"type":"A","name":"@","content":"192.0.2.10","ttl":600},{"type":"CNAME","name":"www","content":"summitroofing.example","ttl":600},{"type":"TXT","name":"@","content":"google-site-verification=sample-910001","ttl":600}]}',
  NULL, NULL, now() - interval '25 minutes', now() - interval '24 minutes', now() - interval '25 minutes', now() + interval '23 hours', 1),
 ('00910000-0000-4000-8000-000000000002', 1, 910004, 910002, 'change', 'verifying',
  '{"kind":"update","record":{"type":"A","name":"@","content":"198.51.100.24","ttl":600}}',
  '{"nameservers":["ns1.namehost.example","ns2.namehost.example"],"records":[{"type":"A","name":"@","content":"203.0.113.80","ttl":3600}]}',
  '{"nameservers":["ns1.namehost.example","ns2.namehost.example"],"records":[{"type":"A","name":"@","content":"198.51.100.24","ttl":600}]}',
  NULL, NULL, now() - interval '3 hours', now() - interval '2 hours', now() - interval '3 hours', NULL, 1),
 ('00910000-0000-4000-8000-000000000003', 1, 910002, 910001, 'change', 'verified',
  '{"kind":"create","record":{"type":"CNAME","name":"www","content":"summitroofing-aurora.example","ttl":600}}',
  '{"nameservers":["ns1.dnshost.example","ns2.dnshost.example"],"records":[{"type":"A","name":"@","content":"192.0.2.10","ttl":600}]}',
  '{"nameservers":["ns1.dnshost.example","ns2.dnshost.example"],"records":[{"type":"A","name":"@","content":"192.0.2.10","ttl":600},{"type":"CNAME","name":"www","content":"summitroofing-aurora.example","ttl":600}]}',
  NULL, NULL, now() - interval '5 days', now() - interval '5 days', now() - interval '5 days', NULL, 1);

-- ===================================================================================================
-- Mail alerts: forwarded provider messages (sender addresses are the app's recognized provider senders)
-- ===================================================================================================
INSERT INTO mail_alert_messages (id, user_id, dedupe, source, category, severity, sender, subject, body, confirmation_code, confirmation_link, domain_id, location_id, read_at, received_at, expires_at)
SELECT 910000 + n, 1, 'sample-gbp-mail-' || n, 'forwarding', cat, sev, sender, subj, body, NULL, NULL, dom, loc,
  CASE WHEN rd THEN now() - ago + ((n * 13 % 47) || ' seconds')::interval + interval '20 minutes' END,
  now() - ago + ((n * 13 % 47) || ' seconds')::interval, now() - ago + interval '30 days'
FROM (VALUES
  (1,  'gbp', 'critical', 'businessprofile-noreply@google.com', 'Someone suggested changes to Summit Roofing Co.', 'A user suggested an edit to your Business Profile: Website. Review the suggested change in your Business Profile.', NULL::bigint, 910001::bigint, interval '48 minutes', false),
  (2,  'gbp', 'warning',  'businessprofile-noreply@google.com', 'Your Business Profile category was updated: Summit Roofing Co.', 'Google updated the primary category on your Business Profile based on information from users and other sources.', NULL, NULL, interval '3 hours', false),
  (3,  'registrar', 'critical', 'support@namehost.example', 'Domain denverhailrepair.example expires in 26 days', 'Auto-renew is off for denverhailrepair.example. Renew before the expiry date to keep the site and email working.', 910004, NULL, interval '9 hours', false),
  (4,  'gsc', 'warning', 'sc-noreply@google.com', 'New Page indexing issue detected for site summitroofing.example', 'Search Console has identified that some pages on your site are not being indexed due to the following new reason: Redirect error.', 910001, 910001, interval '1 day 2 hours', true),
  (5,  'gbp', 'info',    'businessprofile-noreply@google.com', 'You have a new review on Summit Roofing Co.', 'Maria Delgado left a 5-star review. Reply to let customers know you value their feedback.', NULL, 910001, interval '2 days', true),
  (6,  'ads', 'warning', 'ads-noreply@google.com', 'Your campaign "Denver Roof Repair - Search" is limited by budget', 'Your campaign could get more clicks with a higher daily budget. Review recommendations in your account.', NULL, NULL, interval '3 days', true),
  (7,  'cloudflare', 'info', 'noreply@notify.cloudflare.com', 'SSL/TLS certificate renewed for summitroofing-aurora.example', 'The edge certificate for summitroofing-aurora.example was renewed successfully.', 910002, 910002, interval '4 days', true),
  (8,  'gbp', 'warning', 'businessprofile-noreply@google.com', 'Action needed: verify Summit Roofing Co. Lakewood', 'To keep your Business Profile visible, confirm your business information. Sign in to review.', NULL, 910003, interval '6 days', true),
  (9,  'registrar', 'warning', 'support@namehost.example', 'Domain aurorahailclaims.example expires in 12 days', 'Auto-renew is off. Renew to avoid losing this domain.', 910008, NULL, interval '8 days', false),
  (10, 'gsc', 'info', 'sc-noreply@google.com', 'Monthly Search performance for summitroofing.example', 'Your site got 1,240 clicks from Google Search last month, up 18% from the month before.', 910001, 910001, interval '10 days', true),
  (11, 'gbp', 'info', 'businessprofile-noreply@google.com', 'Your September performance report for Summit Roofing Co. Aurora', '2,310 people viewed your Business Profile in September. 312 people called or requested directions.', NULL, 910002, interval '11 days', true)
) v(n, cat, sev, sender, subj, body, dom, loc, ago, rd);

COMMIT;
