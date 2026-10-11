-- Feature-shot sample data, "seo" group: the SEO Suite (dashboard, rank tracker + history + tags + competitors,
-- keywords explorer, site explorer, backlinks, local grid, alerts, action plan, AI visibility, keyword watch,
-- mentions, directories, service-area planner, reports, usage). Sample data only, for user 1 ("Summit Roofing Co.",
-- Denver). Lane DBs (constructhub_dev_*) and tutorial schemas (constructhub_tut_*) only.
-- Idempotent: every row it inserts uses a fixed id in the 910000 range, hangs off site ids 910001-910003, or carries a
-- 'sample'/'00910000-' marker, and is deleted first. Dates are relative to now() so the data stays fresh.
-- Businesses, people, domains (*.example), phones and ids are fictional. The Site audit page reads the Site Scan
-- crawls of summitroofing.example that 60-sitescan (the siteScan group) seeded; nothing here calls a data provider.
-- seo_report_cache keys are sha1(kind + "\n" + JSON.stringify(parts)) exactly as server/seo/reports.ts cacheKey()
-- makes them (pgcrypto is not installed, so they were computed with node and are pasted below with their inputs).
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'constructhub\_dev\_%' AND current_schema() NOT LIKE 'constructhub\_tut\_%' THEN
    RAISE EXCEPTION 'refusing to seed sample data into %.%', current_database(), current_schema();
  END IF;
END $$;

-- ===================================================================================================
-- Helpers (pg_temp: gone with the session)
-- ===================================================================================================
CREATE FUNCTION pg_temp.h(t text) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT abs(hashtext(t)::bigint) $$;
-- Check day k: 0 = yesterday, 1 = a week before, ... (weekly runs).
CREATE FUNCTION pg_temp.wk(k int) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT current_date - 1 - 7 * k $$;
CREATE FUNCTION pg_temp.iso(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
CREATE FUNCTION pg_temp.ym(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM') $$;
-- Typical share of clicks by organic position (server/seo/rank-history.ts CLICK_SHARE), for traffic estimates.
CREATE FUNCTION pg_temp.ctr(p int) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN 0 WHEN p = 1 THEN 0.28 WHEN p = 2 THEN 0.15 WHEN p = 3 THEN 0.11 WHEN p = 4 THEN 0.08 WHEN p = 5 THEN 0.07
              WHEN p = 6 THEN 0.05 WHEN p = 7 THEN 0.04 WHEN p = 8 THEN 0.03 WHEN p = 9 THEN 0.025 WHEN p = 10 THEN 0.02 WHEN p <= 20 THEN 0.01 ELSE 0.004 END $$;
CREATE FUNCTION pg_temp.topic(tag text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tag WHEN 'roofing' THEN 'roofing-contractor' WHEN 'roof replacement' THEN 'roof-replacement' WHEN 'roof repair' THEN 'roof-repair'
                  WHEN 'hail repair' THEN 'hail-damage-roof-repair' WHEN 'gutters' THEN 'gutter-installation' WHEN 'metal roofing' THEN 'metal-roofing'
                  WHEN 'roof inspection' THEN 'roof-inspection' WHEN 'skylights' THEN 'skylights' WHEN 'commercial' THEN 'commercial-roofing'
                  WHEN 'siding' THEN 'siding' ELSE 'roofing' END $$;

-- The other businesses seen in results (fictional; 11-12 are directory-like sites).
CREATE TEMP TABLE rival (i int, domain text, name text, rating numeric, reviews int, authority int) ON COMMIT DROP;
INSERT INTO rival VALUES
 (1, 'clearpeakexteriors.example', 'Clearpeak Exteriors', 4.6, 311, 31), (2, 'cobaltridge.example', 'Cobalt Ridge Roofing', 4.9, 142, 27),
 (3, 'frontrangegutters.example', 'Front Range Gutters', 4.7, 203, 24), (4, 'northgatestorm.example', 'Northgate Storm Restoration', 4.9, 233, 29),
 (5, 'brightpineroofing.example', 'Brightpine Roofing', 4.7, 121, 22), (6, 'halcyonroofpros.example', 'Halcyon Roof Pros', 4.8, 64, 17),
 (7, 'larkspurroof.example', 'Larkspur Roof & Siding', 4.5, 96, 19), (8, 'quarrypeak.example', 'Quarry Peak Exteriors', 4.4, 178, 23),
 (9, 'granitelineroofing.example', 'Granite Line Roofing', 4.3, 58, 15), (10, 'aspenhollowroofing.example', 'Aspen Hollow Roofing', 4.6, 77, 18),
 (11, 'denverhomeguide.example', 'Denver Home Guide', NULL, NULL, 46), (12, 'coloradoroofingreviews.example', 'Colorado Roofing Reviews', NULL, NULL, 38);

-- The first page of results at one check: our site at `pos` (when in the ten), the rest from the pool, stable per keyword
-- (rotated by the keyword, one step from check 6 back so older checks differ a little). Rivals share one page per topic,
-- so keywords of one service overlap (the rank tracker's "searches with the same results").
CREATE FUNCTION pg_temp.serp_top(site text, stitle text, kw text, tag text, pos int, k int) RETURNS jsonb LANGUAGE sql AS $$
  WITH s AS (SELECT p FROM generate_series(1, 10) p),
  f AS (
    SELECT s.p,
      CASE WHEN s.p = pos THEN site ELSE r.domain END AS domain,
      CASE WHEN s.p = pos THEN 'https://' || site || '/' || CASE WHEN tag = 'roofing' OR tag = 'brand' THEN '' ELSE pg_temp.topic(tag) END
           ELSE 'https://' || r.domain || '/' || CASE WHEN s.p <= 7 THEN pg_temp.topic(tag) ELSE pg_temp.topic(tag) || '/' || replace(kw, ' ', '-') END END AS url,
      CASE WHEN s.p = pos THEN stitle ELSE r.name || ' | ' || initcap(replace(pg_temp.topic(tag), '-', ' ')) END AS title
    FROM s LEFT JOIN rival r ON r.i = 1 + ((pg_temp.h(kw || 'pool') + s.p - CASE WHEN pos IS NOT NULL AND pos < s.p THEN 1 ELSE 0 END + CASE WHEN k >= 6 THEN 1 ELSE 0 END) % 12))
  SELECT jsonb_agg(jsonb_build_object('position', p, 'domain', domain, 'url', url, 'title', title) ORDER BY p) FROM f $$;
-- The Google map pack at one check: three businesses, ours at `lp` when it is in it.
CREATE FUNCTION pg_temp.local_pack(bname text, site text, kw text, lp int) RETURNS jsonb LANGUAGE sql AS $$
  WITH s AS (SELECT p FROM generate_series(1, 3) p)
  SELECT jsonb_agg(jsonb_build_object('position', p, 'title', CASE WHEN p = lp THEN bname ELSE r.name END, 'domain', CASE WHEN p = lp THEN site ELSE r.domain END) ORDER BY p)
  FROM s LEFT JOIN rival r ON r.i = 1 + ((pg_temp.h(kw || 'lp') + p - CASE WHEN lp IS NOT NULL AND lp < p THEN 1 ELSE 0 END) % 10) $$;
-- Where each followed competitor stood in that first page (null = not in the ten).
CREATE FUNCTION pg_temp.rivals(top jsonb, followed text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(f, (SELECT (e->>'position')::int FROM jsonb_array_elements(top) e WHERE e->>'domain' = f)) FROM unnest(followed) f $$;

-- ===================================================================================================
-- Clean up (children first)
-- ===================================================================================================
CREATE TEMP TABLE months (off int, m text) ON COMMIT DROP;
INSERT INTO months SELECT o, pg_temp.ym(now() - (o || ' months')::interval) FROM generate_series(0, 3) o;

DELETE FROM seo_report_cache WHERE user_id = 1 AND key IN (
  '77d9fb2206448e6c22e8b53c817cb56831491747', '3c8365feacf405470c9baf87c1c563110ebbfdd8', 'ef578333163579c2eb1306345273c48ab0cd3bee',
  '7049579001f1c37377be3c990466a4b9428e5e48', '726e5b317906ec750c899726846ff6ceacb74e41', '5ffe4e4e5961cde1908b58106a8f17306e9d0ff2',
  '5b6b4cf51f7101b7449de52522d76d5ea1217557', '29b7766f5a072718c010509539ce91983be2df2d', 'a0a9376980790b00db24b15d36624057e2197582');
DELETE FROM seo_mention_checks WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_mention_verdicts WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_keyword_snapshots WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_ai_checks WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_ai_tracked WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_tasks WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_alerts WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_grid_owed WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_grid_watches WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_grid_scans WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_site_competitors WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_backlink_snapshots WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_rank_checks WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_rank_runs WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_keywords WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_report_schedules WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_report_deliveries WHERE site_id BETWEEN 910001 AND 910003;
DELETE FROM seo_sites WHERE id BETWEEN 910001 AND 910003;
DELETE FROM seo_domain_reports WHERE id BETWEEN 910001 AND 910009;
DELETE FROM seo_report_recipients WHERE user_id = 1 AND email IN ('sam@summitroofing.example', 'maria@summitroofing.example');
DELETE FROM seo_reservations WHERE user_id = 1 AND id::text LIKE '00910000-%';
DELETE FROM seo_credit_ledger WHERE user_id = 1 AND stripe_object_id = 'cs_sample_seo_910001';
DELETE FROM seo_credit_purchases WHERE user_id = 1 AND stripe_session_id = 'cs_sample_seo_910001';
DELETE FROM seo_credit_usage WHERE user_id = 1 AND month IN (SELECT m FROM months);
DELETE FROM seo_credit_wallets WHERE user_id = 1;
DELETE FROM seo_api_usage WHERE user_id = 1 AND month IN (SELECT m FROM months);

-- ===================================================================================================
-- Sites 910001-910003 (weekly checks, both devices, top 30; the lane's SEO worker is off, and every next_* is ahead)
-- ===================================================================================================
INSERT INTO seo_sites (id, user_id, domain, location_code, language_code, devices, serp_depth, next_rank_check_at, next_backlinks_at, last_rank_check_at, last_backlinks_at,
  created_at, grid_pin, kw_watch, next_kw_snapshot_at, business_name, alerts_enabled, rank_frequency, group_name, mention_name, mention_places, alert_drop, starred, planner,
  mention_watch, next_mention_at)
VALUES
 (910001, 1, 'summitroofing.example', 2840, 'en', 'both', 30, pg_temp.wk(0) + interval '6 days 6 hours', current_date + interval '27 days', pg_temp.wk(0) + interval '6 hours 14 minutes', current_date - interval '2 days' + interval '3 hours',
  now() - interval '101 days',
  '{"name":"Summit Roofing Co.","address":"Denver, CO 80202","lat":39.7392,"lng":-104.9903,"cid":"9100010001","domain":"summitroofing.example"}',
  true, current_date + interval '27 days', 'Summit Roofing Co.', true, 'weekly', 'Summit Roofing', 'Summit Roofing Co.',
  ARRAY['Denver', 'Aurora', 'Lakewood', 'Arvada', 'Westminster', 'Littleton', 'Englewood', 'Wheat Ridge'], 3, true,
  '{"services":["roof replacement","roof repair","hail damage roof repair","gutter installation","metal roofing","roof inspection"],"towns":["denver","aurora","lakewood","arvada","westminster","littleton","englewood","wheat ridge"]}',
  true, current_date + interval '28 days'),
 (910002, 1, 'denverhailrepair.example', 2840, 'en', 'both', 30, pg_temp.wk(0) + interval '6 days 7 hours', current_date + interval '19 days', pg_temp.wk(0) + interval '6 hours 41 minutes', current_date - interval '11 days' + interval '3 hours',
  now() - interval '66 days', NULL, false, NULL, 'Denver Hail Repair', true, 'weekly', NULL, NULL, NULL, 3, false, NULL, false, NULL),
 (910003, 1, 'summitgutters.example', 2840, 'en', 'both', 30, pg_temp.wk(0) + interval '6 days 7 hours', current_date + interval '22 days', pg_temp.wk(0) + interval '6 hours 52 minutes', current_date - interval '8 days' + interval '3 hours',
  now() - interval '59 days', NULL, false, NULL, 'Summit Gutters', true, 'weekly', 'Summit Roofing', NULL, NULL, 3, false, NULL, false, NULL);

INSERT INTO seo_site_competitors (site_id, domain, created_at) VALUES
 (910001, 'clearpeakexteriors.example', now() - interval '95 days'), (910001, 'cobaltridge.example', now() - interval '95 days'),
 (910001, 'frontrangegutters.example', now() - interval '80 days'), (910001, 'northgatestorm.example', now() - interval '41 days'),
 (910002, 'northgatestorm.example', now() - interval '60 days'), (910002, 'clearpeakexteriors.example', now() - interval '60 days'),
 (910003, 'frontrangegutters.example', now() - interval '55 days');

-- ===================================================================================================
-- Tracked keywords (start_pos / end_pos: where the keyword stood 10 weeks ago and now; over 30 = not in the results)
-- ===================================================================================================
CREATE TEMP TABLE kw (n int, site_id int, keyword text, tags text[], vol int, cpc numeric, kd int, loc int, locname text, start_pos int, end_pos int, path text, local boolean, intent text) ON COMMIT DROP;
INSERT INTO kw VALUES
 (1,  910001, 'roof replacement denver',                 ARRAY['roof replacement','denver'],   1900, 18.40, 42, 1014044, 'Denver, Colorado',     9,  3, '/roof-replacement-denver', true, 'commercial'),
 (2,  910001, 'roofing contractor denver',               ARRAY['roofing','denver'],            2400, 21.10, 48, 1014044, 'Denver, Colorado',    14,  5, '/', true, 'commercial'),
 (3,  910001, 'roofing companies denver',                ARRAY['roofing','denver'],            2900, 19.80, 51, 1014044, 'Denver, Colorado',    18,  7, '/', true, 'commercial'),
 (4,  910001, 'roof repair denver',                      ARRAY['roof repair','denver'],        1600, 16.20, 39, 1014044, 'Denver, Colorado',     7,  4, '/roof-repair', true, 'commercial'),
 (5,  910001, 'hail damage roof repair denver',          ARRAY['hail repair','denver'],         880, 14.90, 33, 1014044, 'Denver, Colorado',    12,  2, '/hail-damage-roof-repair', true, 'transactional'),
 (6,  910001, 'emergency roof repair denver',            ARRAY['roof repair','denver'],         390, 17.60, 31, 1014044, 'Denver, Colorado',    11,  6, '/emergency-roof-repair', true, 'transactional'),
 (7,  910001, 'metal roofing denver',                    ARRAY['metal roofing','denver'],       720, 12.30, 37, 1014044, 'Denver, Colorado',    22,  9, '/metal-roofing', false, 'commercial'),
 (8,  910001, 'roof inspection denver',                  ARRAY['roof inspection','denver'],     480,  9.70, 28, 1014044, 'Denver, Colorado',    16,  8, '/free-roof-inspection', true, 'commercial'),
 (9,  910001, 'free roof inspection denver',             ARRAY['roof inspection','denver'],     210,  8.90, 24, 1014044, 'Denver, Colorado',     6,  1, '/free-roof-inspection', false, 'transactional'),
 (10, 910001, 'gutter installation denver',              ARRAY['gutters','denver'],            1300, 11.40, 35, 1014044, 'Denver, Colorado',    19, 11, '/gutters', true, 'commercial'),
 (11, 910001, 'gutter guards denver',                    ARRAY['gutters','denver'],             590,  9.20, 29, 1014044, 'Denver, Colorado',    25, 14, '/gutters/gutter-guards', false, 'commercial'),
 (12, 910001, 'skylight installation denver',            ARRAY['skylights','denver'],           320, 10.10, 26, 1014044, 'Denver, Colorado',    13,  9, '/skylights', false, 'commercial'),
 (13, 910001, 'roof replacement cost denver',            ARRAY['roof replacement','denver'],   1000, 13.50, 44, 1014044, 'Denver, Colorado',    27, 12, '/blog/roof-replacement-cost-denver', false, 'informational'),
 (14, 910001, 'how much does a new roof cost in colorado', ARRAY['roof replacement'],          1600,  9.80, 46, 2840,    'United States',       35, 17, '/blog/roof-replacement-cost-denver', false, 'informational'),
 (15, 910001, 'class 4 shingles colorado',               ARRAY['roof replacement'],             260,  6.40, 22, 2840,    'United States',        8,  3, '/blog/class-4-impact-resistant-shingles', false, 'informational'),
 (16, 910001, 'roofing contractor aurora co',            ARRAY['roofing','aurora'],             590, 19.90, 40, 1014029, 'Aurora, Colorado',    17,  6, '/service-areas/aurora', true, 'commercial'),
 (17, 910001, 'roof replacement aurora co',              ARRAY['roof replacement','aurora'],    390, 17.80, 38, 1014029, 'Aurora, Colorado',    21,  8, '/service-areas/aurora', true, 'commercial'),
 (18, 910001, 'hail damage roof repair aurora',          ARRAY['hail repair','aurora'],         260, 14.20, 30, 1014029, 'Aurora, Colorado',    15,  4, '/service-areas/aurora', true, 'transactional'),
 (19, 910001, 'roofing contractor lakewood co',          ARRAY['roofing','lakewood'],           480, 18.70, 37, 1014221, 'Lakewood, Colorado',  12,  5, '/service-areas/lakewood', true, 'commercial'),
 (20, 910001, 'roof repair lakewood co',                 ARRAY['roof repair','lakewood'],       320, 15.30, 33, 1014221, 'Lakewood, Colorado',   9,  7, '/service-areas/lakewood', true, 'commercial'),
 (21, 910001, 'roofing contractor arvada',               ARRAY['roofing','arvada'],             390, 18.10, 36, 1014032, 'Arvada, Colorado',    23, 10, '/service-areas/arvada', true, 'commercial'),
 (22, 910001, 'roof replacement arvada',                 ARRAY['roof replacement','arvada'],    210, 16.90, 34, 1014032, 'Arvada, Colorado',    29, 13, '/service-areas/arvada', true, 'commercial'),
 (23, 910001, 'roofing contractor westminster co',       ARRAY['roofing','westminster'],        320, 17.40, 35, 1014399, 'Westminster, Colorado', 33, 15, '/service-areas/westminster', true, 'commercial'),
 (24, 910001, 'roofing contractor littleton co',         ARRAY['roofing','littleton'],          390, 18.00, 36, 1014225, 'Littleton, Colorado', 36, 19, '/service-areas/littleton', true, 'commercial'),
 (25, 910001, 'roofer englewood co',                     ARRAY['roofing','englewood'],          170, 16.10, 30, 1014139, 'Englewood, Colorado', 10, 11, '/service-areas/englewood', true, 'commercial'),
 (26, 910001, 'storm damage roof repair denver',         ARRAY['hail repair','denver'],         480, 15.80, 34, 1014044, 'Denver, Colorado',    14,  7, '/hail-damage-roof-repair', true, 'transactional'),
 (27, 910001, 'roof leak repair denver',                 ARRAY['roof repair','denver'],         720, 14.60, 36, 1014044, 'Denver, Colorado',     8, 12, '/roof-repair', true, 'transactional'),
 (28, 910001, 'flat roof repair denver',                 ARRAY['roof repair','denver'],         390, 13.90, 32, 1014044, 'Denver, Colorado',    20,  9, '/commercial-flat-roofing', false, 'commercial'),
 (29, 910001, 'tpo roofing denver',                      ARRAY['commercial','denver'],          170, 11.20, 27, 1014044, 'Denver, Colorado',    31, 16, '/commercial-flat-roofing', false, 'commercial'),
 (30, 910001, 'commercial roofing denver',               ARRAY['commercial','denver'],          880, 24.30, 55, 1014044, 'Denver, Colorado',    38, 24, '/commercial-flat-roofing', false, 'commercial'),
 (31, 910001, 'roof insurance claim help colorado',      ARRAY['hail repair'],                  210, 12.80, 29, 2840,    'United States',       11,  4, '/insurance-claims', false, 'informational'),
 (32, 910001, 'roof tarping service denver',             ARRAY['roof repair','denver'],         110,  9.40, 19, 1014044, 'Denver, Colorado',     5,  2, '/emergency-roof-repair', true, 'transactional'),
 (33, 910001, 'attic ventilation denver',                ARRAY['roof repair','denver'],         260,  7.90, 23, 1014044, 'Denver, Colorado',    24, 13, '/blog/attic-ventilation-ice-dams', false, 'informational'),
 (34, 910001, 'ice dam prevention colorado',             ARRAY['roof repair'],                  320,  6.10, 21, 2840,    'United States',       40, 15, '/blog/attic-ventilation-ice-dams', false, 'informational'),
 (35, 910001, 'siding contractor denver',                ARRAY['siding','denver'],             1000, 20.40, 47, 1014044, 'Denver, Colorado',    30, 18, '/siding', true, 'commercial'),
 (36, 910001, 'fiber cement siding denver',              ARRAY['siding','denver'],              390, 15.70, 41, 1014044, 'Denver, Colorado',    26, 14, '/siding', false, 'commercial'),
 (37, 910001, 'roof replacement near me',                ARRAY['roof replacement'],            6600, 22.60, 58, 1014044, 'Denver, Colorado',    19,  9, '/roof-replacement-denver', true, 'commercial'),
 (38, 910001, 'roofers near me',                         ARRAY['roofing'],                    14800, 20.90, 62, 1014044, 'Denver, Colorado',    16,  8, '/', true, 'commercial'),
 (39, 910001, 'best roofing company denver',             ARRAY['roofing','denver'],             480, 19.30, 45, 1014044, 'Denver, Colorado',    21,  6, '/', true, 'commercial'),
 (40, 910001, 'summit roofing denver',                   ARRAY['brand'],                        170,  2.10,  5, 1014044, 'Denver, Colorado',     1,  1, '/', true, 'navigational'),
 -- denverhailrepair.example (a storm-season microsite)
 (41, 910002, 'hail damage roof denver',                 ARRAY['hail repair','denver'],         720, 15.10, 36, 1014044, 'Denver, Colorado',    24, 11, '/', true, 'commercial'),
 (42, 910002, 'hail damage roof inspection denver',      ARRAY['hail repair','denver'],         260, 12.40, 27, 1014044, 'Denver, Colorado',    18,  6, '/inspection', true, 'transactional'),
 (43, 910002, 'hail storm roof repair aurora',           ARRAY['hail repair','aurora'],         210, 14.00, 29, 1014029, 'Aurora, Colorado',    27, 13, '/aurora', true, 'transactional'),
 (44, 910002, 'roof hail damage insurance claim colorado', ARRAY['hail repair'],                390, 11.90, 31, 2840,    'United States',       22,  9, '/insurance-claims', false, 'informational'),
 (45, 910002, 'impact resistant shingles denver',        ARRAY['roof replacement','denver'],    170, 10.20, 24, 1014044, 'Denver, Colorado',    33, 17, '/impact-resistant-shingles', false, 'commercial'),
 (46, 910002, 'how to spot hail damage on a roof',       ARRAY['hail repair'],                 2400,  4.30, 38, 2840,    'United States',       35, 21, '/blog/how-to-spot-hail-damage', false, 'informational'),
 (47, 910002, 'emergency roof tarp denver',              ARRAY['roof repair','denver'],         140,  9.10, 18, 1014044, 'Denver, Colorado',    16,  5, '/emergency-tarping', true, 'transactional'),
 (48, 910002, 'hail damage repair lakewood co',          ARRAY['hail repair','lakewood'],       110, 13.60, 25, 1014221, 'Lakewood, Colorado',  29, 14, '/lakewood', true, 'transactional'),
 -- summitgutters.example
 (49, 910003, 'seamless gutters denver',                 ARRAY['gutters','denver'],             590, 10.80, 31, 1014044, 'Denver, Colorado',    26, 12, '/', true, 'commercial'),
 (50, 910003, 'gutter cleaning denver',                  ARRAY['gutters','denver'],            1300,  8.60, 30, 1014044, 'Denver, Colorado',    31, 16, '/gutter-cleaning', true, 'commercial'),
 (51, 910003, 'gutter repair aurora co',                 ARRAY['gutters','aurora'],             210,  9.90, 26, 1014029, 'Aurora, Colorado',    22,  9, '/aurora', true, 'commercial'),
 (52, 910003, 'gutter guards arvada',                    ARRAY['gutters','arvada'],             140,  9.30, 24, 1014032, 'Arvada, Colorado',    28, 15, '/gutter-guards', true, 'commercial'),
 (53, 910003, 'downspout repair denver',                 ARRAY['gutters','denver'],             170,  7.40, 20, 1014044, 'Denver, Colorado',    19,  8, '/gutter-repair', true, 'transactional'),
 (54, 910003, 'gutter installation denver',              ARRAY['gutters','denver'],            1300, 11.40, 35, 1014044, 'Denver, Colorado',    34, 20, '/', true, 'commercial');

-- A healthy account: most of the Denver keywords sit a little higher than the first draft above.
UPDATE kw SET end_pos = greatest(2, end_pos - 2) WHERE site_id = 910001 AND end_pos BETWEEN 5 AND 14;

INSERT INTO seo_keywords (id, site_id, user_id, keyword, tags, search_volume, cpc, difficulty, volume_checked_at, created_at, location_code, location_name)
SELECT 910000 + n, site_id, 1, keyword, tags, vol, cpc, kd, now() - interval '9 days',
  CASE WHEN n <= 40 THEN now() - interval '100 days' ELSE now() - interval '58 days' END - (n || ' minutes')::interval, loc, locname
FROM kw;

-- ===================================================================================================
-- Rank runs (one weekly run per site per check day; the newest run of site 1 came back three lookups short)
-- ===================================================================================================
CREATE TEMP TABLE site_n (site_id int, n int, domain text, bname text, stitle text, followed text[]) ON COMMIT DROP;
INSERT INTO site_n SELECT s.id, (SELECT count(*) FROM kw WHERE kw.site_id = s.id), s.domain, s.business_name,
  CASE s.id WHEN 910001 THEN 'Summit Roofing Co. | Denver Roofing Contractor' WHEN 910002 THEN 'Denver Hail Repair | Storm Damage Roofing' ELSE 'Summit Gutters | Seamless Gutters Denver' END,
  (SELECT array_agg(domain ORDER BY created_at) FROM seo_site_competitors c WHERE c.site_id = s.id)
FROM seo_sites s WHERE s.id BETWEEN 910001 AND 910003;

INSERT INTO seo_rank_runs (id, site_id, user_id, trigger, status, tasks, total, checked, cost_usd, error, created_at, started_at, finished_at, failed, posted, partial, alerts_due)
SELECT (('0091000' || (s.site_id - 910000) || '-0000-4000-8000-0000000000' || lpad(w.k::text, 2, '0'))::uuid), s.site_id, 1,
  CASE WHEN s.site_id = 910001 AND w.k = 3 THEN 'manual' ELSE 'weekly' END, 'done', '[]'::jsonb,
  s.n * 2, s.n * 2 - CASE WHEN s.site_id = 910001 AND w.k = 0 THEN 3 ELSE 0 END, round(s.n * 2 * 0.0006, 6), NULL,
  pg_temp.wk(w.k) + interval '6 hours' + (s.site_id - 910000) * interval '13 minutes', pg_temp.wk(w.k) + interval '6 hours 1 minute' + (s.site_id - 910000) * interval '13 minutes',
  pg_temp.wk(w.k) + interval '6 hours 14 minutes' + (s.site_id - 910000) * interval '13 minutes',
  CASE WHEN s.site_id = 910001 AND w.k = 0 THEN 3 ELSE 0 END, s.n * 2, s.site_id = 910001 AND w.k = 0, false
FROM site_n s, generate_series(0, 10) w(k);

-- ===================================================================================================
-- Rank checks: 11 weekly checks x 2 devices per keyword, trending from start_pos to end_pos with a little noise;
-- the first page of results and the map pack saved with each (competitors, SERP groups, competing pages read them).
-- ===================================================================================================
INSERT INTO seo_rank_checks (keyword_id, site_id, run_id, checked_on, device, position, url, serp_features, local_position, local_pack, serp_top, rivals, created_at)
SELECT 910000 + k.n, k.site_id, (('0091000' || (k.site_id - 910000) || '-0000-4000-8000-0000000000' || lpad(w.k::text, 2, '0'))::uuid), pg_temp.wk(w.k), d.device,
  p.pos,
  CASE WHEN p.pos IS NULL THEN NULL
       -- Two keywords for which Google alternated between two pages of the site (the rank tracker's "competing pages").
       WHEN k.n = 13 AND w.k % 2 = 1 THEN 'https://' || s.domain || '/roof-replacement-denver'
       WHEN k.n = 27 AND w.k IN (2, 3, 6) THEN 'https://' || s.domain || '/emergency-roof-repair'
       ELSE 'https://' || s.domain || k.path END,
  CASE WHEN k.local THEN '["organic","local_pack","people_also_ask"]'::jsonb WHEN k.intent = 'informational' THEN '["organic","people_also_ask","ai_overview","video"]'::jsonb ELSE '["organic","people_also_ask","images"]'::jsonb END,
  lp.lp,
  CASE WHEN k.local THEN pg_temp.local_pack(s.bname, s.domain, k.keyword, lp.lp) END,
  t.top,
  pg_temp.rivals(t.top, s.followed),
  pg_temp.wk(w.k) + interval '6 hours 3 minutes' + (k.n || ' seconds')::interval
FROM kw k
JOIN site_n s ON s.site_id = k.site_id
CROSS JOIN generate_series(0, 10) w(k)
CROSS JOIN (VALUES ('desktop'), ('mobile')) d(device)
CROSS JOIN LATERAL (
  SELECT CASE WHEN x > 30 THEN NULL ELSE x END AS pos FROM (
    SELECT greatest(1, round(k.end_pos + (k.start_pos - k.end_pos) * w.k / 10.0
      + ((pg_temp.h(k.keyword || d.device || w.k) % 5) - 2) * 0.6
      + CASE WHEN d.device = 'mobile' THEN ((pg_temp.h(k.keyword || w.k) % 3) - 1) ELSE 0 END)::int) AS x) r) p
CROSS JOIN LATERAL (
  SELECT CASE WHEN NOT k.local OR p.pos IS NULL THEN NULL
              WHEN p.pos <= 10 THEN 1 + (pg_temp.h(k.keyword || 'map' || (w.k / 3)) % 3)::int
              WHEN p.pos <= 14 AND pg_temp.h(k.keyword || 'map2' || w.k) % 2 = 0 THEN 3 END AS lp) lp
CROSS JOIN LATERAL (SELECT pg_temp.serp_top(s.domain, s.stitle, k.keyword, k.tags[1], p.pos, w.k) AS top) t
-- The newest run of site 1 came back three lookups short: the last three keywords have no mobile check that day.
WHERE NOT (k.site_id = 910001 AND w.k = 0 AND d.device = 'mobile' AND k.n >= 38);

-- ===================================================================================================
-- Backlink snapshots (monthly; the newest names the links lost since the one before)
-- ===================================================================================================
CREATE TEMP TABLE bl (n int, domain text, path text, anchor text, dofollow boolean, drank int, spam int, first_days int, is_new boolean, to_path text) ON COMMIT DROP;
INSERT INTO bl VALUES
 (1,  'denverhomeguide.example',          '/best-roofers-denver-2026',            'Summit Roofing Co.',                 true,  46, 2, 540, false, '/'),
 (2,  'coloradocontractorsassoc.example', '/members/summit-roofing',              'summitroofing.example',              true,  41, 1, 900, false, '/'),
 (3,  'coloradoroofingreviews.example',   '/reviews/summit-roofing-denver',       'Summit Roofing reviews',             true,  38, 3, 410, false, '/'),
 (4,  'frontrangeliving.example',         '/home/hail-season-checklist',          'free roof inspection',               true,  36, 2, 61,  true,  '/free-roof-inspection'),
 (5,  'hailreportcolorado.example',       '/2026/june-storm-denver-metro',        'Summit Roofing',                     true,  34, 1, 118, false, '/hail-damage-roof-repair'),
 (6,  'rockymountainbuilders.example',    '/partners',                            'roofing partner',                    true,  33, 2, 720, false, '/'),
 (7,  'wheatridgechamber.example',        '/directory/home-services',             'Summit Roofing Co.',                 true,  31, 0, 650, false, '/'),
 (8,  'denverhoa-news.example',           '/vendors/roofing',                     'Summit Roofing Co.',                 true,  31, 1, 380, false, '/'),
 (9,  'milehighremodelers.example',       '/blog/roof-or-solar-first',            'solar-ready roof replacement',       true,  29, 2, 95,  false, '/blog/solar-ready-roof-replacement'),
 (10, 'auroraneighbors.example',          '/recommended/roofers',                 'summitroofing.example/aurora',       false, 27, 4, 300, false, '/service-areas/aurora'),
 (11, 'coloradohomeowner.example',        '/guides/roof-insurance-claims',        'insurance claim help',               true,  27, 1, 44,  true,  '/insurance-claims'),
 (12, 'lakewoodliving.example',           '/business/summit-roofing-lakewood',    'Summit Roofing Co. Lakewood',        true,  25, 2, 290, false, '/service-areas/lakewood'),
 (13, 'arvadatoday.example',              '/local/after-the-hail',                'Summit Roofing',                     true,  24, 1, 130, false, '/hail-damage-roof-repair'),
 (14, 'denverrealtygroup.example',        '/sellers/pre-listing-roof-inspection', 'pre-listing roof inspection',        true,  24, 3, 210, false, '/free-roof-inspection'),
 (15, 'coloradoinsuranceadjusters.example', '/resources/contractors',            'Summit Roofing Co.',                 false, 23, 2, 500, false, '/insurance-claims'),
 (16, 'frontrangegutters.example',        '/partners',                            'roofing partner: Summit Roofing',    true,  24, 1, 420, false, '/'),
 (17, 'westminsterbiz.example',           '/members',                             'Summit Roofing',                     true,  21, 2, 240, false, '/service-areas/westminster'),
 (18, 'highlandsranchliving.example',     '/articles/metal-roofs-in-colorado',    'metal roofing Denver',               true,  21, 1, 160, false, '/metal-roofing'),
 (19, 'denverweatherwatch.example',       '/hail-season-2026',                    'how to check your roof for hail damage', true, 20, 0, 102, false, '/blog/how-to-spot-hail-damage'),
 (20, 'littletoncommunity.example',       '/sponsors',                            'Summit Roofing Co.',                 false, 19, 3, 365, false, '/'),
 (21, 'englewoodhomes.example',           '/service-providers',                   'summitroofing.example',              true,  18, 2, 198, false, '/service-areas/englewood'),
 (22, 'coloradoskylights.example',        '/installers',                          'skylight installation Denver',       true,  18, 1, 310, false, '/skylights'),
 (23, 'denvergreenbuilding.example',      '/directory/roofing',                   'Summit Roofing Co.',                 true,  17, 2, 275, false, '/'),
 (24, 'thorntonvoice.example',            '/storm-recovery-resources',            'emergency roof tarping',             true,  16, 1, 88,  false, '/emergency-roof-repair'),
 (25, 'parkerparents.example',            '/local-deals/fall-gutter-cleaning',    'gutter clean-out',                   false, 15, 4, 26,  true,  '/gutters'),
 (26, 'centennialhomeguide.example',      '/roofing-contractors',                 'Summit Roofing',                     true,  15, 2, 350, false, '/'),
 (27, 'coloradoattics.example',           '/ventilation-partners',                'attic ventilation',                  true,  14, 1, 150, false, '/blog/attic-ventilation-ice-dams'),
 (28, 'denversmallbiz.example',           '/spotlight/summit-roofing',            'Summit Roofing Co. spotlight',       true,  13, 0, 72,  false, '/'),
 (29, 'goldenhomeowners.example',         '/recommended',                         'roofer',                             false, 12, 5, 180, false, '/'),
 (30, 'coloradoroofsupply.example',       '/certified-installers',                'Summit Roofing Co.',                 true,  12, 1, 460, false, '/'),
 (31, 'brightonbulletin.example',         '/business-briefs',                     'Summit Roofing',                     true,  11, 2, 33,  true,  '/'),
 (32, 'denverhomeshow.example',           '/exhibitors/2026',                     'Summit Roofing Co.',                 true,  11, 1, 230, false, '/'),
 (33, 'coloradoconstructionjobs.example', '/employers/summit-roofing',            'careers at Summit Roofing',          false, 10, 3, 120, false, '/'),
 (34, 'wheatridgelife.example',           '/after-the-storm',                     'Summit Roofing',                     true,  9,  2, 115, false, '/hail-damage-roof-repair'),
 (35, 'denverdiyforum.example',           '/threads/who-did-your-roof',           'summitroofing.example',              false, 9,  6, 58,  false, '/'),
 (36, 'commercecityconnect.example',      '/directory',                           'Summit Roofing Co.',                 true,  8,  2, 340, false, '/');

CREATE FUNCTION pg_temp.backlinks(upto int, cut int, taken date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object(
      'domainFrom', domain, 'urlFrom', 'https://' || domain || path, 'urlTo', 'https://summitroofing.example' || to_path, 'anchor', anchor, 'dofollow', dofollow,
      'rank', drank * 10 + (pg_temp.h(domain) % 9)::int, 'domainRank', drank, 'spamScore', spam,
      'firstSeen', to_char(taken - first_days, 'YYYY-MM-DD') || ' 00:00:00 +00:00', 'lastSeen', to_char(taken - (pg_temp.h(domain || 'seen') % 6)::int, 'YYYY-MM-DD') || ' 00:00:00 +00:00',
      'isNew', is_new AND first_days <= cut, 'isLost', false) ORDER BY drank DESC, n)
  FROM bl WHERE first_days <= upto AND (n <> 8 OR upto > 400) $$;

INSERT INTO seo_backlink_snapshots (id, site_id, user_id, taken_on, summary, backlinks, cost_usd, created_at, changes, alerts_done)
VALUES
 (910001, 910001, 1, current_date - 63,
  '{"target":"summitroofing.example","rank":219,"backlinks":1012,"referringDomains":193,"referringPages":871,"brokenBacklinks":11,"newBacklinks":48,"lostBacklinks":19,"newReferringDomains":12,"lostReferringDomains":5,"spamScore":5}',
  pg_temp.backlinks(99999, 30, current_date - 63), 0.0152, current_date - 63 + interval '4 hours', NULL, true),
 (910002, 910001, 1, current_date - 32,
  '{"target":"summitroofing.example","rank":226,"backlinks":1097,"referringDomains":201,"referringPages":934,"brokenBacklinks":12,"newBacklinks":57,"lostBacklinks":21,"newReferringDomains":14,"lostReferringDomains":6,"spamScore":4}',
  pg_temp.backlinks(99999, 30, current_date - 32), 0.0171,  current_date - 32 + interval '4 hours',
  jsonb_build_object('since', to_char(current_date - 63, 'YYYY-MM-DD'), 'lostTotal', 3, 'lost', jsonb_build_array(
    jsonb_build_object('domain', 'denverbargainroofs.example', 'authority', 9, 'spam', 61, 'from', 'https://denverbargainroofs.example/competitors', 'to', 'https://summitroofing.example/', 'anchor', 'summit roofing', 'lastSeen', to_char(current_date - 50, 'YYYY-MM-DD'), 'follow', false),
    jsonb_build_object('domain', 'oldcolfaxnews.example', 'authority', 14, 'spam', 3, 'from', 'https://oldcolfaxnews.example/2024/roof-repairs', 'to', 'https://summitroofing.example/roof-repair', 'anchor', 'roof repairs', 'lastSeen', to_char(current_date - 44, 'YYYY-MM-DD'), 'follow', true))), true),
 (910003, 910001, 1, current_date - 2,
  '{"target":"summitroofing.example","rank":238,"backlinks":1184,"referringDomains":212,"referringPages":1016,"brokenBacklinks":14,"newBacklinks":61,"lostBacklinks":23,"newReferringDomains":17,"lostReferringDomains":6,"spamScore":4}',
  pg_temp.backlinks(99999, 30, current_date - 2), 0.0176, current_date - 2 + interval '4 hours',
  jsonb_build_object('since', to_char(current_date - 32, 'YYYY-MM-DD'), 'lostTotal', 6, 'lost', jsonb_build_array(
    jsonb_build_object('domain', 'denverhoa-news.example', 'authority', 31, 'spam', 1, 'from', 'https://denverhoa-news.example/vendors/roofing', 'to', 'https://summitroofing.example/', 'anchor', 'Summit Roofing Co.', 'lastSeen', to_char(current_date - 9, 'YYYY-MM-DD'), 'follow', true),
    jsonb_build_object('domain', 'coloradocontractorsassoc.example', 'authority', 41, 'spam', 1, 'from', 'https://coloradocontractorsassoc.example/news/2025-storm-season', 'to', 'https://summitroofing.example/hail-damage-roof-repair', 'anchor', 'hail damage repair', 'lastSeen', to_char(current_date - 14, 'YYYY-MM-DD'), 'follow', true),
    jsonb_build_object('domain', 'metrodenvercoupons.example', 'authority', 12, 'spam', 38, 'from', 'https://metrodenvercoupons.example/roofing', 'to', 'https://summitroofing.example/', 'anchor', 'roofing deals denver', 'lastSeen', to_char(current_date - 20, 'YYYY-MM-DD'), 'follow', false),
    jsonb_build_object('domain', 'fivepointsforum.example', 'authority', 8, 'spam', 22, 'from', 'https://fivepointsforum.example/t/roofers', 'to', 'https://summitroofing.example/', 'anchor', 'summitroofing.example', 'lastSeen', to_char(current_date - 25, 'YYYY-MM-DD'), 'follow', false))), true),
 (910004, 910002, 1, current_date - 11,
  '{"target":"denverhailrepair.example","rank":94,"backlinks":186,"referringDomains":41,"referringPages":163,"brokenBacklinks":3,"newBacklinks":22,"lostBacklinks":4,"newReferringDomains":7,"lostReferringDomains":1,"spamScore":6}',
  (SELECT jsonb_agg(jsonb_build_object('domainFrom', domain, 'urlFrom', 'https://' || domain || path, 'urlTo', 'https://denverhailrepair.example/', 'anchor', 'Denver Hail Repair', 'dofollow', dofollow, 'rank', drank * 7, 'domainRank', drank - 4, 'spamScore', spam, 'firstSeen', to_char(current_date - first_days / 3, 'YYYY-MM-DD') || ' 00:00:00 +00:00', 'lastSeen', to_char(current_date - 12, 'YYYY-MM-DD') || ' 00:00:00 +00:00', 'isNew', first_days / 3 <= 30, 'isLost', false) ORDER BY drank DESC) FROM bl WHERE n % 3 = 0),
  0.0149, current_date - 11 + interval '4 hours', NULL, true),
 (910005, 910003, 1, current_date - 8,
  '{"target":"summitgutters.example","rank":71,"backlinks":97,"referringDomains":28,"referringPages":84,"brokenBacklinks":1,"newBacklinks":9,"lostBacklinks":2,"newReferringDomains":3,"lostReferringDomains":0,"spamScore":3}',
  (SELECT jsonb_agg(jsonb_build_object('domainFrom', domain, 'urlFrom', 'https://' || domain || path, 'urlTo', 'https://summitgutters.example/', 'anchor', 'Summit Gutters', 'dofollow', dofollow, 'rank', drank * 6, 'domainRank', drank - 5, 'spamScore', spam, 'firstSeen', to_char(current_date - first_days / 4, 'YYYY-MM-DD') || ' 00:00:00 +00:00', 'lastSeen', to_char(current_date - 9, 'YYYY-MM-DD') || ' 00:00:00 +00:00', 'isNew', first_days / 4 <= 30, 'isLost', false) ORDER BY drank DESC) FROM bl WHERE n % 4 = 1),
  0.0149, current_date - 8 + interval '4 hours', NULL, true);

-- ===================================================================================================
-- Site Explorer reports (seo_domain_reports): the three sites and three competitors looked up recently
-- ===================================================================================================
-- Extra organic keywords of summitroofing.example beyond the tracked ones (the report keeps the top 100 by traffic).
CREATE TEMP TABLE xkw (keyword text, position int, vol int, cpc numeric, kd int, intent text, path text) ON COMMIT DROP;
INSERT INTO xkw VALUES
 ('roofing contractor wheat ridge co', 4, 210, 17.90, 33, 'commercial', '/service-areas/wheat-ridge'), ('hail damage roof repair lakewood', 5, 140, 13.80, 28, 'transactional', '/service-areas/lakewood'),
 ('roof replacement englewood co', 7, 110, 16.40, 31, 'commercial', '/service-areas/englewood'), ('impact resistant shingles denver', 6, 170, 10.20, 24, 'commercial', '/blog/class-4-impact-resistant-shingles'),
 ('solar ready roof replacement', 9, 320, 8.70, 27, 'informational', '/blog/solar-ready-roof-replacement'), ('roof replacement financing colorado', 11, 260, 11.30, 35, 'commercial', '/financing'),
 ('how long does a roof last in colorado', 3, 880, 3.20, 30, 'informational', '/blog/how-long-does-a-roof-last-colorado'), ('signs you need a new roof', 14, 2900, 4.10, 45, 'informational', '/blog/signs-you-need-a-new-roof'),
 ('roofing warranty colorado', 8, 170, 7.60, 26, 'informational', '/warranty'), ('gutter installation arvada', 12, 140, 10.90, 29, 'commercial', '/service-areas/arvada'),
 ('skylight repair denver', 10, 210, 9.40, 25, 'commercial', '/skylights'), ('roof snow removal denver', 15, 390, 8.10, 22, 'transactional', '/blog/roof-snow-removal-denver'),
 ('standing seam metal roof cost', 18, 1300, 6.90, 41, 'informational', '/metal-roofing'), ('roofing contractor golden co', 13, 170, 17.10, 32, 'commercial', '/service-areas/golden'),
 ('insurance adjuster roof inspection', 6, 480, 5.40, 29, 'informational', '/insurance-claims'), ('roof hail damage photos', 9, 720, 2.10, 24, 'informational', '/blog/how-to-spot-hail-damage'),
 ('summit roofing reviews', 1, 90, 1.80, 4, 'navigational', '/reviews'), ('summit roofing co aurora', 1, 70, 1.60, 3, 'navigational', '/service-areas/aurora'),
 ('tpo roof installation colorado', 16, 140, 12.60, 30, 'commercial', '/commercial-flat-roofing'), ('roof ventilation denver', 11, 170, 7.20, 21, 'informational', '/blog/attic-ventilation-ice-dams');

-- One report, assembled from the pieces the explorer would parse. `kws` are ExplorerKeyword rows; the totals and the
-- two years of history are scaled from them.
CREATE FUNCTION pg_temp.report(domain text, fetched timestamptz, authority int, backlinks int, rd int, traffic numeric, vpv numeric, kwtotal int, pagestotal int,
                               kws jsonb, pages jsonb, comps jsonb, refdoms jsonb, anchors jsonb, paid jsonb, seed text) RETURNS jsonb LANGUAGE sql AS $$
  WITH k AS (SELECT (e->>'position')::int AS p, (e->>'traffic')::numeric AS t, e->>'intent' AS i FROM jsonb_array_elements(kws) e),
  n AS (SELECT count(*)::numeric AS c FROM k),
  pos AS (SELECT round(kwtotal * count(*) FILTER (WHERE p <= 3) / n.c)::int AS top3, round(kwtotal * count(*) FILTER (WHERE p <= 10) / n.c)::int AS top10,
                 round(kwtotal * count(*) FILTER (WHERE p <= 20) / n.c)::int AS top20, round(kwtotal * count(*) FILTER (WHERE p <= 50) / n.c)::int AS top50 FROM k, n GROUP BY n.c),
  hist AS (
    SELECT i, pg_temp.ym(fetched - ((23 - i) || ' months')::interval) AS month,
      ((0.55 + 0.45 * i / 23.0) * (1 + 0.18 * sin((extract(month FROM fetched - ((23 - i) || ' months')::interval) - 4) / 12.0 * 2 * pi())) * (0.94 + (pg_temp.h(seed || 'h' || i) % 13) / 100.0))::numeric AS g,
      ((0.6 + 0.4 * i / 23.0) * (0.97 + (pg_temp.h(seed || 'k' || i) % 7) / 100.0))::numeric AS gk
    FROM generate_series(0, 23) i),
  lh AS (
    SELECT i, pg_temp.ym(fetched - ((11 - i) || ' months')::interval) AS month, ((0.78 + 0.22 * i / 11.0) * (0.985 + (pg_temp.h(seed || 'l' || i) % 4) / 100.0))::numeric AS g FROM generate_series(0, 11) i)
  SELECT jsonb_build_object(
    'domain', domain, 'locationCode', 2840, 'languageCode', 'en', 'fetchedAt', pg_temp.iso(fetched),
    'organic', jsonb_build_object('keywords', kwtotal, 'traffic', round(traffic, 1), 'trafficValue', round(traffic * vpv, 2),
      'positions', jsonb_build_object('top3', pos.top3, 'top10', pos.top10, 'top20', pos.top20, 'top50', pos.top50, 'top100', kwtotal),
      'isNew', round(kwtotal * 0.07)::int, 'isUp', round(kwtotal * 0.21)::int, 'isDown', round(kwtotal * 0.12)::int, 'isLost', round(kwtotal * 0.04)::int),
    'paid', paid,
    'links', jsonb_build_object('authority', authority, 'backlinks', backlinks, 'referringDomains', rd, 'followedDomains', round(rd * 0.81)::int, 'nofollowDomains', rd - round(rd * 0.81)::int,
      'referringIps', round(rd * 0.9)::int, 'brokenBacklinks', round(backlinks * 0.012)::int, 'spamScore', 4, 'firstSeen', to_char(fetched - interval '6 years 2 months', 'YYYY-MM-DD'),
      'tlds', jsonb_build_array(jsonb_build_object('tld', 'com', 'links', round(backlinks * 0.69)::int), jsonb_build_object('tld', 'org', 'links', round(backlinks * 0.13)::int),
        jsonb_build_object('tld', 'net', 'links', round(backlinks * 0.08)::int), jsonb_build_object('tld', 'us', 'links', round(backlinks * 0.05)::int),
        jsonb_build_object('tld', 'example', 'links', round(backlinks * 0.037)::int), jsonb_build_object('tld', 'info', 'links', round(backlinks * 0.013)::int))),
    'history', (SELECT jsonb_agg(jsonb_build_object('month', month, 'traffic', round(traffic * g, 1), 'keywords', round(kwtotal * gk)::int,
        'top3', round(pos.top3 * gk)::int, 'top10', round(pos.top10 * gk)::int, 'trafficValue', round(traffic * g * vpv, 2)) ORDER BY i) FROM hist),
    'linkHistory', (SELECT jsonb_agg(jsonb_build_object('month', month, 'backlinks', round(backlinks * g)::int, 'referringDomains', round(rd * g)::int,
        'newBacklinks', round(backlinks * (0.025 + (pg_temp.h(seed || 'nb' || i) % 20) / 1000.0))::int, 'lostBacklinks', round(backlinks * (0.008 + (pg_temp.h(seed || 'lb' || i) % 12) / 1000.0))::int,
        'authority', authority - ((11 - i) / 4)) ORDER BY i) FROM lh),
    'keywords', kws, 'keywordsTotal', kwtotal,
    'intents', (SELECT jsonb_agg(jsonb_build_object('intent', x.i, 'keywords', (SELECT count(*) FROM k WHERE k.i = x.i), 'traffic', (SELECT round(coalesce(sum(t), 0), 1) FROM k WHERE k.i = x.i)))
                FROM unnest(ARRAY['informational', 'navigational', 'commercial', 'transactional']) x(i)),
    'pages', pages, 'pagesTotal', pagestotal, 'competitors', comps, 'referringDomains', refdoms, 'anchors', anchors, 'missing', '[]'::jsonb)
  FROM pos $$;

-- Keyword rows for a site from a list of (keyword, position, volume, cpc, difficulty, intent, path).
CREATE FUNCTION pg_temp.kwrows(domain text, rows_ jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('keyword', e->>'keyword', 'position', (e->>'position')::int, 'volume', (e->>'vol')::int,
    'traffic', round((e->>'vol')::int * pg_temp.ctr((e->>'position')::int), 1), 'trafficValue', round((e->>'vol')::int * pg_temp.ctr((e->>'position')::int) * (e->>'cpc')::numeric, 2),
    'cpc', (e->>'cpc')::numeric, 'difficulty', (e->>'kd')::int, 'intent', e->>'intent', 'url', 'https://' || domain || (e->>'path')) ORDER BY (e->>'vol')::int * pg_temp.ctr((e->>'position')::int) DESC)
  FROM jsonb_array_elements(rows_) e $$;
-- Pages from keyword rows: traffic and keywords per address.
CREATE FUNCTION pg_temp.pagerows(kws jsonb, pagestotal int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('url', url, 'traffic', round(t, 1), 'keywords', round(c * pagestotal / 11.0)::int, 'trafficValue', round(tv, 2), 'top10', t10) ORDER BY t DESC)
  FROM (SELECT url, sum(t) AS t, count(*) AS c, sum(tv) AS tv, count(*) FILTER (WHERE p <= 10) AS t10
        FROM (SELECT e->>'url' AS url, (e->>'traffic')::numeric AS t, (e->>'trafficValue')::numeric AS tv, (e->>'position')::int AS p FROM jsonb_array_elements(kws) e) x GROUP BY url) y $$;
-- Generated keyword rows for a competitor: services x towns, positions from the seed.
CREATE FUNCTION pg_temp.genkws(domain text, seed text, scale numeric, n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('keyword', s.svc || ' ' || t.town, 'position', 1 + (pg_temp.h(seed || s.svc || t.town) % 28)::int, 'vol', round(s.v * t.w * scale)::int, 'cpc', s.cpc, 'kd', s.kd,
    'intent', CASE WHEN s.svc LIKE '%cost%' THEN 'informational' WHEN s.svc LIKE 'emergency%' THEN 'transactional' ELSE 'commercial' END, 'path', '/' || replace(s.svc, ' ', '-') || CASE WHEN t.town = 'denver' THEN '' ELSE '/' || replace(t.town, ' ', '-') END))
  FROM (SELECT * FROM (VALUES ('roofing contractor', 2400, 21.10, 48), ('roof replacement', 1900, 18.40, 42), ('roof repair', 1600, 16.20, 39), ('hail damage roof repair', 880, 14.90, 33),
                               ('gutter installation', 1300, 11.40, 35), ('metal roofing', 720, 12.30, 37), ('roof replacement cost', 1000, 13.50, 44), ('emergency roof repair', 390, 17.60, 31),
                               ('siding contractor', 1000, 20.40, 47), ('roof inspection', 480, 9.70, 28)) v(svc, v, cpc, kd)) s,
       (SELECT * FROM (VALUES ('denver', 1.0), ('aurora', 0.45), ('lakewood', 0.35), ('arvada', 0.3), ('littleton', 0.3), ('westminster', 0.28)) w(town, w)) t
  WHERE pg_temp.h(seed || 'keep' || s.svc || t.town) % 60 < n $$;

INSERT INTO seo_domain_reports (id, user_id, domain, location_code, language_code, report, cost_usd, created_at)
SELECT 910001, 1, 'summitroofing.example', 2840, 'en',
  pg_temp.report('summitroofing.example', now() - interval '2 days 5 hours', 24, 1184, 212, 3140, 2.35, 143, 38, kws,
    pg_temp.pagerows(kws, 38),
    (SELECT jsonb_agg(jsonb_build_object('domain', r.domain, 'commonKeywords', c.ck, 'avgPosition', c.ap, 'traffic', c.tr, 'keywords', c.kw) ORDER BY c.ck DESC) FROM rival r
      JOIN (VALUES (1, 61, 7.4, 4820, 312), (4, 48, 6.1, 5310, 287), (2, 44, 9.8, 2140, 196), (5, 39, 11.2, 1660, 171), (8, 33, 12.6, 1930, 203), (3, 29, 10.4, 1480, 142), (7, 24, 14.1, 980, 118), (10, 19, 15.3, 740, 97)) c(i, ck, ap, tr, kw) ON c.i = r.i),
    (SELECT jsonb_agg(jsonb_build_object('domain', domain, 'authority', drank, 'backlinks', 1 + (pg_temp.h(domain || 'bl') % 9)::int, 'firstSeen', to_char(current_date - first_days, 'YYYY-MM-DD'), 'spamScore', spam, 'followed', dofollow) ORDER BY drank DESC) FROM bl WHERE n <= 20),
    '[{"anchor":"Summit Roofing Co.","backlinks":412,"referringDomains":97,"firstSeen":"2020-08-14"},{"anchor":"summitroofing.example","backlinks":188,"referringDomains":61,"firstSeen":"2020-09-02"},{"anchor":"Summit Roofing","backlinks":121,"referringDomains":38,"firstSeen":"2021-01-19"},{"anchor":"roofing contractor denver","backlinks":64,"referringDomains":14,"firstSeen":"2022-05-11"},{"anchor":"free roof inspection","backlinks":51,"referringDomains":12,"firstSeen":"2023-03-27"},{"anchor":"hail damage repair","backlinks":44,"referringDomains":11,"firstSeen":"2023-06-30"},{"anchor":"here","backlinks":39,"referringDomains":16,"firstSeen":"2021-04-08"},{"anchor":"Summit Roofing Co. Aurora","backlinks":27,"referringDomains":8,"firstSeen":"2022-10-15"},{"anchor":"roof replacement denver","backlinks":22,"referringDomains":7,"firstSeen":"2024-02-20"},{"anchor":"metal roofing Denver","backlinks":14,"referringDomains":5,"firstSeen":"2024-07-09"},{"anchor":"insurance claim help","backlinks":11,"referringDomains":4,"firstSeen":"2025-01-13"},{"anchor":"website","backlinks":9,"referringDomains":6,"firstSeen":"2021-11-02"}]'::jsonb,
    '{"keywords":18,"traffic":265,"trafficValue":3980.5,"positions":{"top3":11,"top10":18,"top20":18,"top50":18,"top100":18},"isNew":2,"isUp":3,"isDown":1,"isLost":0}'::jsonb, 'summit'),
  0.2914, now() - interval '2 days 5 hours'
FROM (SELECT pg_temp.kwrows('summitroofing.example',
        (SELECT jsonb_agg(jsonb_build_object('keyword', keyword, 'position', end_pos, 'vol', vol, 'cpc', cpc, 'kd', kd, 'intent', intent, 'path', path)) FROM kw WHERE site_id = 910001 AND end_pos <= 30)
        || (SELECT jsonb_agg(jsonb_build_object('keyword', keyword, 'position', position, 'vol', vol, 'cpc', cpc, 'kd', kd, 'intent', intent, 'path', path)) FROM xkw)) AS kws) x;

INSERT INTO seo_domain_reports (id, user_id, domain, location_code, language_code, report, cost_usd, created_at)
SELECT 910000 + d.n, 1, d.domain, 2840, 'en',
  pg_temp.report(d.domain, now() - d.ago, d.authority, d.backlinks, d.rd, d.traffic, d.vpv, d.kwtotal, d.pagestotal, k.kws, pg_temp.pagerows(k.kws, d.pagestotal),
    (SELECT jsonb_agg(jsonb_build_object('domain', r.domain, 'commonKeywords', 12 + (pg_temp.h(d.domain || r.domain) % 40)::int, 'avgPosition', 5 + round((pg_temp.h(r.domain || d.domain) % 90) / 10.0, 1), 'traffic', r.authority * 110 + (pg_temp.h(r.domain) % 500)::int, 'keywords', r.authority * 8) ORDER BY 12 + (pg_temp.h(d.domain || r.domain) % 40) DESC)
       FROM rival r WHERE r.domain <> d.domain AND r.i <= 10 AND pg_temp.h(d.domain || 'c' || r.domain) % 10 < 7),
    (SELECT jsonb_agg(jsonb_build_object('domain', domain, 'authority', greatest(5, drank - 6), 'backlinks', 1 + (pg_temp.h(domain || d.domain) % 6)::int, 'firstSeen', to_char(current_date - first_days - 40, 'YYYY-MM-DD'), 'spamScore', spam, 'followed', dofollow) ORDER BY drank DESC) FROM bl WHERE pg_temp.h(d.domain || domain) % 3 = 0),
    jsonb_build_array(jsonb_build_object('anchor', d.bname, 'backlinks', round(d.backlinks * 0.33)::int, 'referringDomains', round(d.rd * 0.4)::int, 'firstSeen', '2021-03-10'),
      jsonb_build_object('anchor', d.domain, 'backlinks', round(d.backlinks * 0.17)::int, 'referringDomains', round(d.rd * 0.25)::int, 'firstSeen', '2021-05-02'),
      jsonb_build_object('anchor', 'here', 'backlinks', round(d.backlinks * 0.06)::int, 'referringDomains', round(d.rd * 0.1)::int, 'firstSeen', '2022-01-14'),
      jsonb_build_object('anchor', 'roofing contractor', 'backlinks', round(d.backlinks * 0.04)::int, 'referringDomains', round(d.rd * 0.06)::int, 'firstSeen', '2023-02-21'),
      jsonb_build_object('anchor', 'website', 'backlinks', round(d.backlinks * 0.03)::int, 'referringDomains', round(d.rd * 0.05)::int, 'firstSeen', '2022-08-08')),
    CASE WHEN d.paidkw > 0 THEN jsonb_build_object('keywords', d.paidkw, 'traffic', d.paidkw * 14, 'trafficValue', d.paidkw * 190.5, 'positions', jsonb_build_object('top3', d.paidkw / 2, 'top10', d.paidkw, 'top20', d.paidkw, 'top50', d.paidkw, 'top100', d.paidkw), 'isNew', 1, 'isUp', 2, 'isDown', 1, 'isLost', 0)
         ELSE '{"keywords":0,"traffic":0,"trafficValue":0,"positions":{"top3":0,"top10":0,"top20":0,"top50":0,"top100":0},"isNew":0,"isUp":0,"isDown":0,"isLost":0}'::jsonb END, d.domain),
  d.cost, now() - d.ago
FROM (VALUES
  (2, 'denverhailrepair.example',     'Denver Hail Repair',   interval '11 days 2 hours', 9,  186,  41,  420::numeric,  2.1::numeric, 61,  14, 0,  0.2866::numeric, 0.55::numeric),
  (3, 'summitgutters.example',        'Summit Gutters',       interval '8 days 3 hours',  7,  97,   28,  310::numeric,  1.9::numeric, 48,  11, 0,  0.2802::numeric, 0.45::numeric),
  (4, 'clearpeakexteriors.example',   'Clearpeak Exteriors',  interval '4 days 1 hour',   31, 2210, 388, 4820::numeric, 2.5::numeric, 312, 54, 31, 0.3011::numeric, 1.3::numeric),
  (5, 'cobaltridge.example',          'Cobalt Ridge Roofing', interval '6 days 4 hours',  27, 1540, 276, 2140::numeric, 2.3::numeric, 196, 36, 12, 0.2958::numeric, 0.9::numeric),
  (6, 'frontrangegutters.example',    'Front Range Gutters',  interval '13 days 6 hours', 24, 1310, 241, 1480::numeric, 2.0::numeric, 142, 29, 0,  0.2890::numeric, 0.8::numeric)
) d(n, domain, bname, ago, authority, backlinks, rd, traffic, vpv, kwtotal, pagestotal, paidkw, cost, scale)
CROSS JOIN LATERAL (SELECT pg_temp.kwrows(d.domain, pg_temp.genkws(d.domain, d.domain, d.scale, CASE WHEN d.n <= 3 THEN 22 ELSE 48 END)) AS kws) k;

-- ===================================================================================================
-- Local grid: two finished scans around the Denver pin (rank 1 near the shop, fading outwards) and one weekly watch
-- ===================================================================================================
CREATE TEMP TABLE gscan (id int, keyword text, size int, spacing numeric, k numeric, ago interval, cost numeric) ON COMMIT DROP;
INSERT INTO gscan VALUES (910001, 'roofing contractor denver', 7, 2, 0.27, interval '3 days 2 hours', 0.098), (910002, 'roof repair near me', 5, 2, 0.6, interval '17 days 5 hours', 0.05);
CREATE TEMP TABLE gpoint AS
  SELECT g.id AS scan_id, r AS row_, c AS col_,
    round((39.7392 + ((g.size - 1) / 2.0 - r) * g.spacing / 69.0)::numeric, 6) AS lat,
    round((-104.9903 + (c - (g.size - 1) / 2.0) * g.spacing / (69.172 * cos(39.7392 * pi() / 180)))::numeric, 6) AS lng,
    CASE WHEN round(1 + power(sqrt(power(r - (g.size - 1) / 2.0, 2) + power(c - (g.size - 1) / 2.0, 2)) * g.spacing, 1.5) * g.k + ((pg_temp.h(g.id || ':' || r || ':' || c) % 7) - 3) * 0.5) > 20 THEN NULL
         ELSE greatest(1, round(1 + power(sqrt(power(r - (g.size - 1) / 2.0, 2) + power(c - (g.size - 1) / 2.0, 2)) * g.spacing, 1.5) * g.k + ((pg_temp.h(g.id || ':' || r || ':' || c) % 7) - 3) * 0.5))::int END AS rank_,
    (pg_temp.h(g.id || 'j' || r || c) % 6)::int AS jit
  FROM gscan g, generate_series(0, 6) r, generate_series(0, 6) c WHERE r < g.size AND c < g.size;
-- The first three businesses at a point: ours at its rank when it is in them, the rest from the pool.
CREATE FUNCTION pg_temp.gtop(rank_ int, jit int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('name', CASE WHEN p = rank_ THEN 'Summit Roofing Co.' ELSE r.name END, 'rank', p) ORDER BY p)
  FROM generate_series(1, 3) p LEFT JOIN rival r ON r.i = 1 + ((jit + p - CASE WHEN rank_ IS NOT NULL AND rank_ < p THEN 1 ELSE 0 END) % 8) $$;
INSERT INTO seo_grid_scans (id, user_id, site_id, keyword, size, spacing, scan, status, error, avg_rank, points, checked, found, top3, cost_usd, created_at)
SELECT g.id, 1, 910001, g.keyword, g.size, g.spacing,
  jsonb_build_object('keyword', g.keyword, 'size', g.size, 'spacing', g.spacing, 'center', '{"lat":39.7392,"lng":-104.9903,"name":"Summit Roofing Co.","cid":"9100010001"}'::jsonb,
    'points', (SELECT jsonb_agg(jsonb_build_object('row', row_, 'col', col_, 'lat', lat, 'lng', lng, 'rank', rank_, 'top', pg_temp.gtop(rank_, jit)) || CASE WHEN rank_ IS NULL THEN '{}'::jsonb ELSE '{"by":"id"}'::jsonb END ORDER BY row_, col_) FROM gpoint p WHERE p.scan_id = g.id),
    'rivals', (SELECT jsonb_agg(x ORDER BY (x->>'top3')::int DESC, (x->>'found')::int DESC) FROM (
        SELECT jsonb_build_object('name', 'Summit Roofing Co.', 'ours', true, 'domain', 'summitroofing.example', 'cid', '9100010001', 'rating', 4.8, 'reviews', 186,
          'top3', count(*) FILTER (WHERE rank_ <= 3), 'found', count(*) FILTER (WHERE rank_ IS NOT NULL), 'avgRank', round(avg(rank_), 1)) AS x FROM gpoint p WHERE p.scan_id = g.id
        UNION ALL
        SELECT jsonb_build_object('name', r.name, 'ours', false, 'domain', r.domain, 'cid', (9100020000 + r.i)::text, 'rating', r.rating, 'reviews', r.reviews,
          'top3', (SELECT count(*) FROM gpoint p, jsonb_array_elements(pg_temp.gtop(p.rank_, p.jit)) e WHERE p.scan_id = g.id AND e->>'name' = r.name),
          'found', g.size * g.size - (pg_temp.h(g.id || r.domain) % 5)::int,
          'avgRank', round(3.5 + r.i * 0.9 + (pg_temp.h(r.domain || g.id) % 10) / 10.0, 1)) FROM rival r WHERE r.i <= 8) z),
    'summary', (SELECT jsonb_build_object('points', count(*), 'checked', count(*), 'found', count(*) FILTER (WHERE rank_ IS NOT NULL), 'top3', count(*) FILTER (WHERE rank_ <= 3),
        'avgRank', round(avg(coalesce(rank_, 21)), 1), 'unsure', 0) FROM gpoint p WHERE p.scan_id = g.id),
    'fetchedAt', pg_temp.iso(now() - g.ago + interval '2 minutes')),
  'done', NULL,
  (SELECT round(avg(coalesce(rank_, 21)), 1) FROM gpoint p WHERE p.scan_id = g.id), g.size * g.size, g.size * g.size,
  (SELECT count(*) FROM gpoint p WHERE p.scan_id = g.id AND rank_ IS NOT NULL), (SELECT count(*) FROM gpoint p WHERE p.scan_id = g.id AND rank_ <= 3), g.cost, now() - g.ago
FROM gscan g;
INSERT INTO seo_grid_watches (id, user_id, site_id, keyword, size, spacing, every, next_at, created_at, anchor_at, run_scan_id, alert_scan_id)
VALUES (910001, 1, 910001, 'roofing contractor denver', 7, 2, 'weekly', now() + interval '3 days 22 hours', now() - interval '31 days', now() - interval '31 days', 910001, 910001);

-- ===================================================================================================
-- Alerts: what moved between checks (rank drops and gains, links, grid, keyword watch, mentions)
-- ===================================================================================================
INSERT INTO seo_alerts (id, user_id, site_id, kind, source, title, items, read_at, created_at, notified_at)
VALUES
 (910001, 1, 910001, 'rank_gain', 'run:00910001-0000-4000-8000-000000000000', '4 rankings improved for summitroofing.example',
  jsonb_build_array(
    jsonb_build_object('keywordId', 910005, 'keyword', 'hail damage roof repair denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'improved', 'from', 6, 'to', 2, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910039, 'keyword', 'best roofing company denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'improved', 'from', 10, 'to', 6, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910023, 'keyword', 'roofing contractor westminster co', 'device', 'mobile', 'location', 'Westminster, Colorado', 'what', 'new', 'from', NULL, 'to', 16, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910016, 'keyword', 'roofing contractor aurora co', 'device', 'desktop', 'location', 'Aurora, Colorado', 'what', 'entered_map_pack', 'from', NULL, 'to', 3, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD'))),
  NULL, pg_temp.wk(0) + interval '6 hours 15 minutes', pg_temp.wk(0) + interval '6 hours 16 minutes'),
 (910002, 1, 910001, 'rank_drop', 'run:00910001-0000-4000-8000-000000000000', '2 rankings fell for summitroofing.example (from a check that did not finish: 77 of 80 lookups came back)',
  jsonb_build_array(
    jsonb_build_object('keywordId', 910027, 'keyword', 'roof leak repair denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'dropped', 'from', 8, 'to', 12, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910025, 'keyword', 'roofer englewood co', 'device', 'mobile', 'location', 'Englewood, Colorado', 'what', 'left_map_pack', 'from', 3, 'to', NULL, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD'))),
  NULL, pg_temp.wk(0) + interval '6 hours 15 minutes', pg_temp.wk(0) + interval '6 hours 16 minutes'),
 (910003, 1, 910001, 'links_lost', to_char(current_date - 2, 'YYYY-MM-DD'), 'summitroofing.example lost links from 2 strong sites',
  jsonb_build_array(jsonb_build_object('from', 201, 'to', 212, 'since', to_char(current_date - 32, 'YYYY-MM-DD'), 'backlinksFrom', 1097, 'backlinksTo', 1184, 'lostShown', 2, 'lostTotal', 6, 'lost', jsonb_build_array(
    jsonb_build_object('domain', 'coloradocontractorsassoc.example', 'authority', 41, 'spam', 1, 'follow', true, 'from', 'https://coloradocontractorsassoc.example/news/2025-storm-season', 'to', 'https://summitroofing.example/hail-damage-roof-repair', 'lastSeen', to_char(current_date - 14, 'YYYY-MM-DD')),
    jsonb_build_object('domain', 'denverhoa-news.example', 'authority', 31, 'spam', 1, 'follow', true, 'from', 'https://denverhoa-news.example/vendors/roofing', 'to', 'https://summitroofing.example/', 'lastSeen', to_char(current_date - 9, 'YYYY-MM-DD'))))),
  NULL, current_date - 2 + interval '4 hours 2 minutes', current_date - 2 + interval '4 hours 3 minutes'),
 (910004, 1, 910001, 'links_gained', to_char(current_date - 32, 'YYYY-MM-DD'), 'summitroofing.example gained 8 linking sites',
  jsonb_build_array(jsonb_build_object('from', 193, 'to', 201, 'since', to_char(current_date - 63, 'YYYY-MM-DD'), 'backlinksFrom', 1012, 'backlinksTo', 1097, 'lost', '[]'::jsonb, 'lostShown', 0, 'lostTotal', NULL)),
  current_date - 30 + interval '15 hours', current_date - 32 + interval '4 hours 2 minutes', current_date - 32 + interval '4 hours 3 minutes'),
 (910005, 1, 910001, 'grid_up', 'grid:910001', 'Local grid for "roofing contractor denver": in the top three at more points',
  (SELECT jsonb_build_array(jsonb_build_object('keyword', 'roofing contractor denver', 'size', 7, 'top3', top3, 'checked', 49, 'wasTop3', top3 - 5, 'wasChecked', 49, 'score', avg_rank, 'wasScore', avg_rank + 1.7, 'scanId', 910001, 'wasScanId', 910002)) FROM seo_grid_scans WHERE id = 910001),
  now() - interval '2 days 20 hours', now() - interval '3 days 1 hour 50 minutes', now() - interval '3 days 1 hour 49 minutes'),
 (910006, 1, 910001, 'kw_new', 'kwsnap:910002', 'summitroofing.example ranks for 7 new searches',
  jsonb_build_array(jsonb_build_object('since', to_char(current_date - 33, 'YYYY-MM-DD'), 'snapshotId', 910002, 'beforeId', 910001, 'more', 2, 'keywords', jsonb_build_array(
    jsonb_build_object('keyword', 'solar ready roof replacement', 'position', 9, 'volume', 320), jsonb_build_object('keyword', 'roof snow removal denver', 'position', 15, 'volume', 390),
    jsonb_build_object('keyword', 'roofing warranty colorado', 'position', 8, 'volume', 170), jsonb_build_object('keyword', 'skylight repair denver', 'position', 10, 'volume', 210),
    jsonb_build_object('keyword', 'roofing contractor golden co', 'position', 13, 'volume', 170)))),
  now() - interval '2 days 19 hours', current_date - 3 + interval '5 hours', current_date - 3 + interval '5 hours 1 minute'),
 (910007, 1, 910001, 'mention_new', 'mention:910001', '3 new pages mention "Summit Roofing Co." without linking',
  jsonb_build_array(jsonb_build_object('name', 'Summit Roofing Co.', 'since', to_char(current_date - 33, 'YYYY-MM-DD'), 'siteId', 910001, 'checkId', 910001, 'pages', jsonb_build_array(
    jsonb_build_object('domain', 'frontrangeliving.example', 'title', 'The best Denver roofers of 2026, according to homeowners', 'url', 'https://frontrangeliving.example/best-denver-roofers-2026'),
    jsonb_build_object('domain', 'lakewoodliving.example', 'title', 'After the hail: who Lakewood neighbors called', 'url', 'https://lakewoodliving.example/after-the-hail'),
    jsonb_build_object('domain', 'denverdiyforum.example', 'title', 'Who did your roof? (Denver metro thread)', 'url', 'https://denverdiyforum.example/threads/who-did-your-roof-2026')))),
  NULL, current_date - 2 + interval '5 hours 30 minutes', current_date - 2 + interval '5 hours 31 minutes'),
 (910008, 1, 910001, 'rank_gain', 'run:00910001-0000-4000-8000-000000000002', '3 rankings improved for summitroofing.example',
  jsonb_build_array(
    jsonb_build_object('keywordId', 910001, 'keyword', 'roof replacement denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'improved', 'from', 7, 'to', 4, 'on', to_char(pg_temp.wk(2), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(3), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910019, 'keyword', 'roofing contractor lakewood co', 'device', 'desktop', 'location', 'Lakewood, Colorado', 'what', 'improved', 'from', 9, 'to', 6, 'on', to_char(pg_temp.wk(2), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(3), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910034, 'keyword', 'ice dam prevention colorado', 'device', 'desktop', 'location', NULL, 'what', 'new', 'from', NULL, 'to', 19, 'on', to_char(pg_temp.wk(2), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(3), 'YYYY-MM-DD'))),
  pg_temp.wk(2) + interval '9 hours', pg_temp.wk(2) + interval '6 hours 15 minutes', pg_temp.wk(2) + interval '6 hours 16 minutes'),
 (910009, 1, 910001, 'rank_drop', 'run:00910001-0000-4000-8000-000000000004', '1 ranking fell for summitroofing.example',
  jsonb_build_array(jsonb_build_object('keywordId', 910010, 'keyword', 'gutter installation denver', 'device', 'mobile', 'location', 'Denver, Colorado', 'what', 'dropped', 'from', 11, 'to', 15, 'on', to_char(pg_temp.wk(4), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(5), 'YYYY-MM-DD'))),
  pg_temp.wk(4) + interval '10 hours', pg_temp.wk(4) + interval '6 hours 15 minutes', pg_temp.wk(4) + interval '6 hours 16 minutes'),
 (910010, 1, 910002, 'rank_gain', 'run:00910002-0000-4000-8000-000000000000', '2 rankings improved for denverhailrepair.example',
  jsonb_build_array(
    jsonb_build_object('keywordId', 910042, 'keyword', 'hail damage roof inspection denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'improved', 'from', 9, 'to', 6, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD')),
    jsonb_build_object('keywordId', 910047, 'keyword', 'emergency roof tarp denver', 'device', 'desktop', 'location', 'Denver, Colorado', 'what', 'improved', 'from', 8, 'to', 5, 'on', to_char(pg_temp.wk(0), 'YYYY-MM-DD'), 'since', to_char(pg_temp.wk(1), 'YYYY-MM-DD'))),
  NULL, pg_temp.wk(0) + interval '6 hours 28 minutes', pg_temp.wk(0) + interval '6 hours 29 minutes');

-- ===================================================================================================
-- Usage: the ledger (what each lookup cost the customer), this month's included data, a prepaid pack
-- ===================================================================================================
INSERT INTO seo_credit_purchases (id, user_id, cents, stripe_session_id, stripe_payment_intent, created_at)
VALUES (910001, 1, 2500, 'cs_sample_seo_910001', 'pi_sample_seo_910001', now() - interval '41 days');
INSERT INTO seo_credit_ledger (user_id, purchase_id, kind, wallet_delta, stripe_object_id, stripe_payment_intent, created_at)
VALUES (1, 910001, 'purchase', 2500, 'cs_sample_seo_910001', 'pi_sample_seo_910001', now() - interval '41 days');

CREATE TEMP TABLE res (n int, ago interval, label text, est numeric, actual numeric, cents int, wallet int) ON COMMIT DROP;
INSERT INTO res VALUES
 (1,  interval '2 days 5 hours',   'Site Explorer report — summitroofing.example', 0.36, 0.2914, 117, 0),
 (2,  interval '2 days 4 hours',   'Backlink snapshot — summitroofing.example (monthly)', 0.0776, 0.0176, 7, 0),
 (3,  interval '3 days 2 hours',   'Local grid — "roofing contractor denver", 7 × 7 points', 0.1225, 0.098, 39, 0),
 (4,  interval '3 days 5 hours',   'Keyword snapshot — summitroofing.example', 0.05, 0.0412, 16, 0),
 (5,  interval '4 days 1 hour',    'Site Explorer report — clearpeakexteriors.example', 0.36, 0.3011, 120, 0),
 (6,  interval '4 days 3 hours',   'Directories — summitroofing.example, clearpeakexteriors.example, cobaltridge.example, frontrangegutters.example', 0.1152, 0.0884, 35, 0),
 (7,  interval '5 days 6 hours',   'Keyword overview — roof replacement denver', 0.065, 0.051, 20, 0),
 (8,  interval '5 days 6 hours',   'Keyword overview — roofing contractor denver', 0.065, 0.049, 20, 0),
 (9,  interval '6 days 4 hours',   'Site Explorer report — cobaltridge.example', 0.36, 0.2958, 118, 0),
 (10, interval '7 days 23 hours',  'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (11, interval '8 days 3 hours',   'Site Explorer report — summitgutters.example', 0.36, 0.2802, 112, 0),
 (12, interval '8 days 4 hours',   'Backlink snapshot — summitgutters.example (refresh)', 0.0776, 0.0149, 6, 0),
 (13, interval '9 days 2 hours',   'Service-area planner — summitroofing.example (6 × 8)', 0.0496, 0.0388, 16, 0),
 (14, interval '9 days 7 hours',   'Search volumes — 40 keywords for summitroofing.example', 0.09, 0.075, 30, 0),
 (15, interval '10 days 1 hour',   'Content explorer — "hail damage roof repair"', 0.03, 0.0245, 10, 0),
 (16, interval '10 days 2 hours',  'AI visibility — "Which Denver roofers offer free roof inspections?" (ChatGPT, Google Gemini, Perplexity) for summitroofing.example', 0.125, 0.069, 28, 0),
 (17, interval '11 days 2 hours',  'Site Explorer report — denverhailrepair.example', 0.36, 0.2866, 115, 0),
 (18, interval '13 days 6 hours',  'Site Explorer report — frontrangegutters.example', 0.36, 0.289, 116, 0),
 (19, interval '14 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (20, interval '17 days 5 hours',  'Local grid — "roof repair near me", 5 × 5 points', 0.0625, 0.05, 20, 0),
 (21, interval '21 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (22, interval '23 days 4 hours',  'Mentions — "Summit Roofing Co."', 0.0576, 0.0471, 19, 0),
 (23, interval '28 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (24, interval '32 days 4 hours',  'Backlink snapshot — summitroofing.example (monthly)', 0.0776, 0.0171, 7, 7),
 (25, interval '35 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 18),
 (26, interval '38 days 2 hours',  'AI visibility — "Who are the best roofing companies in Denver? Name specific businesses." (ChatGPT, Google Gemini, Perplexity) for summitroofing.example', 0.125, 0.071, 28, 28),
 (27, interval '40 days 5 hours',  'Competitor gap — summitroofing.example vs clearpeakexteriors.example', 0.025, 0.0213, 9, 9),
 (28, interval '42 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (29, interval '44 days 1 hour',   'Site Explorer report — summitroofing.example', 0.36, 0.2871, 115, 0),
 (30, interval '49 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (31, interval '56 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (32, interval '63 days 4 hours',  'Backlink snapshot — summitroofing.example (monthly)', 0.0776, 0.0152, 6, 0),
 (33, interval '63 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (34, interval '70 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0),
 (35, interval '77 days 23 hours', 'Rank check — 40 keywords for summitroofing.example (automatic)', 0.048, 0.0462, 18, 0);
INSERT INTO seo_reservations (id, user_id, month, estimate_usd, credit, actual_usd, customer_usd, settled_at, created_at, label, reconciled, refunded_cents)
SELECT ('00910000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 1, pg_temp.ym(now() - ago), est,
  jsonb_build_object('userId', 1, 'month', pg_temp.ym(now() - ago), 'fromIncluded', cents - wallet, 'fromWallet', wallet, 'allowanceCents', 6000, 'allowanceOnly', label LIKE '%(automatic)%' OR label LIKE '%(monthly)%'),
  actual, cents / 100.0, now() - ago + interval '40 seconds', now() - ago, label, true, 0
FROM res;
INSERT INTO seo_credit_usage (user_id, month, included_cents, wallet_cents, requests, updated_at)
SELECT 1, pg_temp.ym(now() - ago), sum(cents - wallet), sum(wallet), count(*), max(now() - ago) FROM res GROUP BY 2
ON CONFLICT (user_id, month) DO UPDATE SET included_cents = excluded.included_cents, wallet_cents = excluded.wallet_cents, requests = excluded.requests;
INSERT INTO seo_credit_wallets (user_id, balance_cents, updated_at) SELECT 1, 2500 - sum(wallet), now() - interval '32 days' FROM res;
INSERT INTO seo_api_usage (user_id, month, cost_usd, requests, updated_at)
SELECT 1, pg_temp.ym(now() - ago), sum(actual), count(*), max(now() - ago) FROM res GROUP BY 2;

-- ===================================================================================================
-- Saved lookups (seo_report_cache): directories, mentions, service-area planner, keyword overviews, content explorer.
-- Keys = sha1(kind + "\n" + JSON.stringify(parts)), server/seo/reports.ts cacheKey(); inputs noted on each row.
-- ===================================================================================================
-- directories: ["summitroofing.example",["clearpeakexteriors.example","cobaltridge.example","frontrangegutters.example"]]
INSERT INTO seo_report_cache (user_id, key, kind, data, cost_usd, created_at)
SELECT 1, '77d9fb2206448e6c22e8b53c817cb56831491747', 'directories',
  jsonb_build_object('sites', '["summitroofing.example","clearpeakexteriors.example","cobaltridge.example","frontrangegutters.example"]'::jsonb, 'missing', '[]'::jsonb, 'fetchedAt', pg_temp.iso(now() - interval '3 hours'),
    'rows', (SELECT jsonb_agg(jsonb_build_object('domain', d, 'name', nm, 'kind', k, 'links', jsonb_build_array(a, b, c, e)) ORDER BY o) FROM (VALUES
      (1, 'yelp.com', 'Yelp', 'reviews', 2, 3, 1, 1), (2, 'bbb.org', 'Better Business Bureau', 'reviews', 1, 1, 1, 0), (3, 'trustpilot.com', 'Trustpilot', 'reviews', 0, 1, 0, 0), (4, 'birdeye.com', 'Birdeye', 'reviews', 0, 1, 0, 1),
      (5, 'angi.com', 'Angi', 'trade', 1, 2, 1, 1), (6, 'homeadvisor.com', 'HomeAdvisor', 'trade', 1, 2, 0, 1), (7, 'houzz.com', 'Houzz', 'trade', 0, 1, 1, 0), (8, 'thumbtack.com', 'Thumbtack', 'trade', 0, 1, 0, 1),
      (9, 'porch.com', 'Porch', 'trade', 1, 1, 0, 0), (10, 'buildzoom.com', 'BuildZoom', 'trade', 1, 1, 1, 0), (11, 'guildquality.com', 'GuildQuality', 'trade', 0, 1, 0, 0), (12, 'bestpickreports.com', 'Best Pick Reports', 'trade', 0, 1, 0, 0),
      (13, 'expertise.com', 'Expertise', 'trade', 1, 1, 0, 0), (14, 'nextdoor.com', 'Nextdoor', 'maps', 2, 1, 1, 1), (15, 'mapquest.com', 'MapQuest', 'maps', 1, 1, 1, 1), (16, 'foursquare.com', 'Foursquare', 'maps', 0, 1, 0, 0),
      (17, 'yellowpages.com', 'Yellow Pages', 'business', 1, 1, 1, 1), (18, 'superpages.com', 'Superpages', 'business', 0, 1, 1, 0), (19, 'manta.com', 'Manta', 'business', 1, 1, 0, 1), (20, 'chamberofcommerce.com', 'ChamberofCommerce.com', 'business', 1, 0, 0, 0),
      (21, 'alignable.com', 'Alignable', 'business', 0, 1, 0, 0), (22, 'facebook.com', 'Facebook', 'social', 3, 4, 2, 2), (23, 'instagram.com', 'Instagram', 'social', 1, 2, 1, 0), (24, 'linkedin.com', 'LinkedIn', 'social', 1, 1, 1, 1),
      (25, 'youtube.com', 'YouTube', 'social', 0, 2, 0, 1), (26, 'pinterest.com', 'Pinterest', 'social', 0, 1, 0, 0)) v(o, d, nm, k, a, b, c, e))),
  0.0884, now() - interval '3 hours';

-- mentions: ["summitroofing.example","summit roofing co."]
INSERT INTO seo_report_cache (user_id, key, kind, data, cost_usd, created_at)
SELECT 1, 'ef578333163579c2eb1306345273c48ab0cd3bee', 'mentions',
  jsonb_build_object('name', 'Summit Roofing Co.', 'domain', 'summitroofing.example', 'total', 37, 'linksChecked', true, 'linksCheckedAt', pg_temp.iso(now() - interval '23 hours'), 'fetchedAt', pg_temp.iso(now() - interval '23 hours 1 minute'),
    'rows', (SELECT jsonb_agg(jsonb_build_object('url', u, 'domain', d, 'title', t, 'snippet', s, 'published', CASE WHEN p IS NULL THEN NULL ELSE to_char(current_date - p, 'YYYY-MM-DD') END, 'authority', a, 'linksToYou', l) ORDER BY a DESC) FROM (VALUES
      ('https://denverhomeguide.example/best-roofers-denver-2026', 'denverhomeguide.example', 'The 10 best roofers in Denver (2026)', 'Summit Roofing Co. tops our list again this year: free drone inspections, Class 4 shingle options and a crew that meets the adjuster on the roof. Denver, Aurora and Lakewood.', 48, 46, true),
      ('https://frontrangeliving.example/best-denver-roofers-2026', 'frontrangeliving.example', 'The best Denver roofers of 2026, according to homeowners', 'Readers named Summit Roofing Co. most often for hail repair in Denver and Arvada, followed by Cobalt Ridge Roofing and Clearpeak Exteriors.', 12, 36, false),
      ('https://coloradoroofingreviews.example/reviews/summit-roofing-denver', 'coloradoroofingreviews.example', 'Summit Roofing Co. reviews – Denver, CO', '4.8 stars from 186 reviews. Homeowners mention punctual crews, clean job sites and help with insurance paperwork.', 95, 38, true),
      ('https://hailreportcolorado.example/2026/june-storm-denver-metro', 'hailreportcolorado.example', 'June 2026 hail: what the Denver metro storm left behind', 'Contractors such as Summit Roofing Co. reported inspecting more than 300 roofs in Denver and Westminster in the two weeks after the storm.', 118, 34, true),
      ('https://lakewoodliving.example/after-the-hail', 'lakewoodliving.example', 'After the hail: who Lakewood neighbors called', 'Several Lakewood readers recommended Summit Roofing Co. for same-week estimates and emergency tarping.', 9, 25, false),
      ('https://auroraneighbors.example/recommended/roofers', 'auroraneighbors.example', 'Recommended roofers in Aurora', 'Summit Roofing Co. (Aurora branch) – hail repair, gutters, drone inspections. Recommended by 14 neighbors.', 200, 27, true),
      ('https://denverdiyforum.example/threads/who-did-your-roof-2026', 'denverdiyforum.example', 'Who did your roof? (Denver metro thread)', 'We went with Summit Roofing Co. after the June storm. They handled the claim and the roof was done in a day. Highlands area.', 6, 9, false),
      ('https://milehighremodelers.example/blog/roof-or-solar-first', 'milehighremodelers.example', 'Roof or solar first? Ask a roofer before you sign', 'Tom Becker of Summit Roofing Co. explains why a new roof should go on before panels and what a solar-ready roof includes.', 95, 29, true),
      ('https://coloradohomeowner.example/guides/roof-insurance-claims', 'coloradohomeowner.example', 'Roof insurance claims in Colorado: a homeowner guide', 'Summit Roofing Co. walked us through what a public adjuster does and when you need one.', 44, 27, true),
      ('https://arvadatoday.example/local/after-the-hail', 'arvadatoday.example', 'Arvada after the hail: a roofing season like no other', 'Crews from Summit Roofing Co. and Brightpine Roofing have been on Arvada rooftops since early June.', 130, 24, true),
      ('https://westminsterbiz.example/members', 'westminsterbiz.example', 'Westminster business members', 'Summit Roofing Co. · Roofing contractor · Member since 2024', NULL, 21, true),
      ('https://parkerparents.example/local-deals/fall-gutter-cleaning', 'parkerparents.example', 'Fall gutter clean-out deals around Parker', 'Summit Roofing Co. is offering gutter clean-outs through October for Parker and Centennial homes.', 26, 15, false),
      ('https://summitroofingtx.example/about', 'summitroofingtx.example', 'About Summit Roofing Co. – Austin', 'Summit Roofing Co. has served the Austin area since 2009. Not affiliated with other companies of the same name.', 410, 19, false),
      ('https://highlandsranchliving.example/articles/metal-roofs-in-colorado', 'highlandsranchliving.example', 'Are metal roofs worth it in Colorado?', 'We asked Summit Roofing Co. about standing-seam metal roofs, hail and cost per square in Denver.', 160, 21, true)) v(u, d, t, s, p, a, l))),
  0.0471, now() - interval '23 hours 1 minute';

-- planner: ["summitroofing.example",2840,"en",[services],[towns]] (the lists as saved on seo_sites.planner)
INSERT INTO seo_report_cache (user_id, key, kind, data, cost_usd, created_at)
SELECT 1, '7049579001f1c37377be3c990466a4b9428e5e48', 'planner',
  (WITH svc AS (SELECT * FROM (VALUES (1, 'roof replacement', 1900, 42, 18.40, '/roof-replacement-denver'), (2, 'roof repair', 1600, 39, 16.20, '/roof-repair'), (3, 'hail damage roof repair', 880, 33, 14.90, '/hail-damage-roof-repair'),
      (4, 'gutter installation', 1300, 35, 11.40, '/gutters'), (5, 'metal roofing', 720, 37, 12.30, '/metal-roofing'), (6, 'roof inspection', 480, 28, 9.70, '/free-roof-inspection')) s(o, svc, v, kd, cpc, path)),
   town AS (SELECT * FROM (VALUES (1, 'denver', 1.0, NULL), (2, 'aurora', 0.45, '/service-areas/aurora'), (3, 'lakewood', 0.35, '/service-areas/lakewood'), (4, 'arvada', 0.3, '/service-areas/arvada'),
      (5, 'westminster', 0.28, '/service-areas/westminster'), (6, 'littleton', 0.3, '/service-areas/littleton'), (7, 'englewood', 0.18, '/service-areas/englewood'), (8, 'wheat ridge', 0.15, '/service-areas/wheat-ridge')) t(o, town, w, tpath)),
   cell AS (
     SELECT s.o AS so, t.o AS tao, s.svc, t.town, s.svc || ' ' || t.town AS keyword,
       CASE WHEN pg_temp.h(s.svc || t.town || 'v') % 10 = 0 AND t.w < 0.3 THEN NULL ELSE round(s.v * t.w * (0.8 + (pg_temp.h(s.svc || t.town) % 40) / 100.0) / 10) * 10 END AS volume,
       s.kd - round(6 * (1 - t.w))::int AS difficulty, round(s.cpc * (0.85 + t.w * 0.15), 2) AS cpc,
       CASE WHEN pg_temp.h(s.svc || t.town || 'p') % 10 < 3 THEN NULL WHEN pg_temp.h(s.svc || t.town || 'p') % 10 < 6 THEN 1 + (pg_temp.h(s.svc || t.town || 'q') % 3)::int ELSE 4 + (pg_temp.h(s.svc || t.town || 'q') % 15)::int END AS position,
       CASE WHEN t.o = 1 THEN s.path WHEN t.o <= 4 THEN t.tpath WHEN s.o IN (1, 2) THEN t.tpath ELSE '/' END AS path
     FROM svc s, town t)
   SELECT jsonb_build_object('domain', 'summitroofing.example', 'locationCode', 2840, 'languageCode', 'en', 'fetchedAt', pg_temp.iso(now() - interval '9 days 2 hours'),
     'services', (SELECT jsonb_agg(svc ORDER BY o) FROM svc), 'towns', (SELECT jsonb_agg(town ORDER BY o) FROM town),
     'cells', (SELECT jsonb_agg(jsonb_build_object('service', svc, 'town', town, 'keyword', keyword, 'volume', volume, 'difficulty', CASE WHEN volume IS NULL THEN NULL ELSE difficulty END, 'cpc', CASE WHEN volume IS NULL THEN NULL ELSE cpc END,
        'position', position, 'url', CASE WHEN position IS NULL THEN NULL ELSE 'https://summitroofing.example' || path END, 'home', position IS NOT NULL AND path = '/') ORDER BY so, tao) FROM cell),
     'summary', (SELECT jsonb_build_object('cells', count(*), 'gaps', count(*) FILTER (WHERE position IS NULL AND volume > 0), 'gapVolume', coalesce(sum(volume) FILTER (WHERE position IS NULL), 0),
        'weak', count(*) FILTER (WHERE position > 3), 'strong', count(*) FILTER (WHERE position <= 3), 'unknown', count(*) FILTER (WHERE position IS NULL AND volume IS NULL)) FROM cell),
     'missing', '[]'::jsonb)),
  0.0388, now() - interval '2 hours';

-- keyword-overview: [keyword, 2840, "en"]
CREATE FUNCTION pg_temp.overview(kw text, vol int, cpc numeric, kd int, intent text, ourpos int, ourpath text, seed text, fetched timestamptz) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('keyword', kw, 'locationCode', 2840, 'languageCode', 'en', 'fetchedAt', pg_temp.iso(fetched), 'volume', vol, 'cpc', cpc, 'difficulty', kd, 'intent', intent, 'competition', 'HIGH',
    'bidLow', round(cpc * 0.55, 2), 'bidHigh', round(cpc * 1.9, 2), 'results', 18400000 + (pg_temp.h(kw) % 9000000)::int,
    'trend', (SELECT jsonb_agg(jsonb_build_object('month', pg_temp.ym(fetched - ((23 - i) || ' months')::interval),
        'volume', round(vol * (1 + 0.32 * sin((extract(month FROM fetched - ((23 - i) || ' months')::interval) - 3) / 12.0 * 2 * pi())) * (0.9 + (pg_temp.h(seed || i) % 21) / 100.0) / 10) * 10) ORDER BY i) FROM generate_series(0, 23) i),
    'features', '["local_pack","people_also_ask","organic","images","reviews"]'::jsonb,
    'topAvg', jsonb_build_object('authority', 27, 'backlinks', 412, 'referringDomains', 86),
    'serp', (SELECT jsonb_agg(jsonb_build_object('position', (e->>'position')::int, 'domain', e->>'domain', 'url', e->>'url', 'title', e->>'title',
        'authority', CASE WHEN e->>'domain' = 'summitroofing.example' THEN 24 ELSE (SELECT authority FROM rival r WHERE r.domain = e->>'domain') END) ORDER BY (e->>'position')::int)
      FROM jsonb_array_elements(pg_temp.serp_top('summitroofing.example', 'Summit Roofing Co. | Denver Roofing Contractor', kw, split_part(kw, ' ', 1) || CASE WHEN kw LIKE 'roof replacement%' THEN ' replacement' WHEN kw LIKE 'roofing%' THEN 'ing' ELSE ' repair' END, ourpos, 0)) e),
    'potential', jsonb_build_object('url', CASE WHEN ourpos = 1 THEN 'https://summitroofing.example' || ourpath ELSE 'https://' || (SELECT domain FROM rival WHERE i = 1 + (pg_temp.h(kw || 'pool') % 12)::int) || '/' || pg_temp.topic(split_part(kw, ' ', 1)) END,
        'traffic', round(vol * 0.9), 'keywords', 60 + (pg_temp.h(kw || 'pk') % 80)::int, 'parentTopic', CASE WHEN kw LIKE 'roof replacement%' THEN 'roof replacement' WHEN kw LIKE 'roofing%' THEN 'roofing companies denver' ELSE 'hail damage roof repair' END, 'parentVolume', vol * 3),
    'missing', '[]'::jsonb) $$;
INSERT INTO seo_report_cache (user_id, key, kind, data, cost_usd, created_at) VALUES
 (1, '726e5b317906ec750c899726846ff6ceacb74e41', 'keyword-overview', pg_temp.overview('roof replacement denver', 1900, 18.40, 42, 'commercial', 3, '/roof-replacement-denver', 'ov1', now() - interval '5 days 6 hours'), 0.051, now() - interval '5 days 6 hours'),
 (1, '5ffe4e4e5961cde1908b58106a8f17306e9d0ff2', 'keyword-overview', pg_temp.overview('roofing contractor denver', 2400, 21.10, 48, 'commercial', 5, '/', 'ov2', now() - interval '5 days 6 hours'), 0.049, now() - interval '5 days 6 hours'),
 (1, '5b6b4cf51f7101b7449de52522d76d5ea1217557', 'keyword-overview', pg_temp.overview('hail damage roof repair denver', 880, 14.90, 33, 'transactional', 2, '/hail-damage-roof-repair', 'ov3', now() - interval '2 days 1 hour'), 0.052, now() - interval '2 days 1 hour');

-- content: ["hail damage roof repair","relevance",0,0,"","",25,0] and the same with the site's own domain left out.
-- (Saved content, planner and directories pages are shown for a day; the mentions check for a week; keyword overviews for 7 days — the created_at of each row keeps it inside its window.)
CREATE TEMP TABLE cpage AS
  SELECT jsonb_build_object('query', 'hail damage roof repair', 'total', 412, 'sourceRows', 25, 'limit', 25, 'offset', 0, 'fetchedAt', pg_temp.iso(now() - interval '10 days 1 hour'),
    'rows', (SELECT jsonb_agg(jsonb_build_object('url', 'https://' || d || p, 'domain', d, 'title', t, 'snippet', s, 'authority', a, 'published', to_char(current_date - pub, 'YYYY-MM-DD'), 'quality', q, 'author', au) ORDER BY o) FROM (VALUES
      (1, 'coloradohomeowner.example', '/guides/hail-damage-roof-repair', 'Hail damage roof repair: what Colorado homeowners should know', 'Hail season runs May through August on the Front Range. Here is how to document damage, what adjusters look for and when a repair beats a replacement.', 27, 38, 88, 'Dana Whitfield'),
      (2, 'hailreportcolorado.example', '/repair-vs-replace', 'Repair or replace? Reading a hail-damaged roof', 'Bruised mats, granule loss and cracked seals: the three signs that decide between a hail damage roof repair and a full tear-off.', 34, 61, 84, 'Luis Ortega'),
      (3, 'denverhomeguide.example', '/roofing/hail-claims-timeline', 'The hail claim timeline, from storm to new roof', 'Most Denver hail claims close in six to ten weeks. A step-by-step look at inspection, adjuster meeting, approval and the repair itself.', 46, 95, 91, 'Priya Natarajan'),
      (4, 'frontrangeliving.example', '/home/hail-season-checklist', 'Your hail-season roof checklist', 'Before the first storm: photos of the roof, gutters and siding; a copy of your policy; and a roofer who will do a free inspection.', 36, 118, 79, 'Marcus Ellery'),
      (5, 'milehighremodelers.example', '/blog/hail-damage-vs-wear', 'Hail damage or normal wear? Telling them apart', 'Random impact marks versus even granule loss: what a trained eye checks on asphalt shingles after a Front Range storm.', 29, 140, 82, 'Tom Becker'),
      (6, 'coloradoinsuranceadjusters.example', '/articles/hail-damage-documentation', 'Documenting hail damage for a roof claim', 'Chalk circles, test squares and dated photos: how to document hail damage so your roof repair claim is not short-paid.', 23, 170, 86, NULL),
      (7, 'denverweatherwatch.example', '/hail-season-2026', 'Hail season 2026: the storms that hit the Denver metro', 'A storm-by-storm record of the 2026 season with the neighborhoods that saw the largest stones.', 20, 102, 74, 'Weather desk'),
      (8, 'arvadatoday.example', '/local/after-the-hail', 'Arvada after the hail: a roofing season like no other', 'Crews have been on Arvada rooftops since early June. Residents share what the repairs cost and how long they waited.', 24, 130, 71, 'Jenna Caldwell'),
      (9, 'highlandsranchliving.example', '/articles/class-4-shingles-hail', 'Do Class 4 shingles stop hail damage?', 'Impact-resistant shingles cut hail damage roof repair claims and can lower premiums. What the UL 2218 rating means.', 21, 210, 83, 'Owen Bright'),
      (10, 'rockymountainbuilders.example', '/resources/hail-repair-materials', 'Materials for hail repair in Colorado', 'Why Class 4 asphalt, standing-seam metal and synthetic shake are the common choices after hail damage along the Front Range.', 33, 260, 80, NULL),
      (11, 'coloradoroofingreviews.example', '/guides/choosing-a-storm-roofer', 'How to choose a storm roofer (and avoid storm chasers)', 'Local license, local address, references from last season: the checks that keep you away from a crew that leaves town in September.', 38, 75, 85, 'Editorial team'),
      (12, 'denverhoa-news.example', '/articles/hoa-hail-damage-roofs', 'Hail damage and HOA roofs: who pays for what', 'Shared roofs, master policies and special assessments after a hail storm hits a Denver HOA.', 31, 300, 77, 'Carla Jimenez'),
      (13, 'lakewoodliving.example', '/after-the-hail', 'After the hail: who Lakewood neighbors called', 'Lakewood readers on the roofers they used, the repair costs and the claims that went smoothly.', 25, 9, 72, 'Neighbors desk'),
      (14, 'thorntonvoice.example', '/storm-recovery-resources', 'Storm recovery resources for Thornton homeowners', 'Emergency tarping, tree removal and roof repair contacts after severe weather.', 16, 88, 68, NULL),
      (15, 'coloradoattics.example', '/blog/hail-and-attic-leaks', 'Hail damage you cannot see: attic leaks after a storm', 'Why a roof that looks fine from the street can leak into the attic weeks after hail, and what an inspection finds.', 14, 150, 76, 'Sarah Lindqvist'),
      (16, 'denverrealtygroup.example', '/sellers/hail-damage-selling', 'Selling a house with hail damage in Denver', 'Disclose, repair or credit? How hail damage affects a sale and what buyers’ inspectors flag.', 24, 190, 78, 'Alexis Moreno'),
      (17, 'wheatridgelife.example', '/after-the-storm', 'After the storm: Wheat Ridge roofs, gutters and claims', 'A neighborhood guide to roof repair after the June hail, with typical repair costs.', 9, 115, 66, NULL),
      (18, 'coloradoskylights.example', '/blog/hail-and-skylights', 'Hail and skylights: repair or replace?', 'Cracked acrylic domes and fogged glass after hail. When a skylight repair makes sense during a roof repair.', 18, 230, 75, 'Installer notes'),
      (19, 'auroraneighbors.example', '/guides/hail-claims-aurora', 'Hail claims in Aurora: a neighbor-to-neighbor guide', 'What Aurora homeowners learned filing roof claims after back-to-back storms.', 27, 200, 73, 'Community team'),
      (20, 'englewoodhomes.example', '/blog/hail-roof-repair-cost', 'What hail damage roof repair costs in the Denver metro', 'Typical repair invoices for small, medium and whole-slope hail damage, and the deductible math.', 18, 240, 81, 'Ben Okafor'),
      (21, 'centennialhomeguide.example', '/hail-damage-roof-repair', 'Hail damage roof repair in Centennial', 'A homeowner guide to inspections, estimates and the contractors Centennial residents recommend.', 15, 320, 70, NULL),
      (22, 'denvergreenbuilding.example', '/articles/recycling-hail-damaged-shingles', 'Recycling hail-damaged shingles', 'Where torn-off asphalt shingles go after a hail repair, and the Denver recyclers that take them.', 17, 275, 79, 'Green building desk'),
      (23, 'littletoncommunity.example', '/news/hail-season-recap', 'Hail season recap for Littleton', 'Three storms, thousands of claims and the roofers who worked through the summer.', 19, 60, 67, 'Staff'),
      (24, 'goldenhomeowners.example', '/forum/hail-damage-roof-repair', 'Hail damage roof repair – your experiences', 'Golden homeowners compare repair quotes, insurance outcomes and roofers.', 12, 45, 58, NULL),
      (25, 'denverdiyforum.example', '/threads/diy-hail-repair', 'DIY hail repair on shingles: bad idea?', 'A forum thread on patching hail damage yourself versus calling a roofer, with photos.', 9, 58, 55, NULL)) v(o, d, p, t, s, a, pub, q, au))) AS page;
INSERT INTO seo_report_cache (user_id, key, kind, data, cost_usd, created_at)
SELECT 1, k, 'content', page, 0.0245, now() - interval '5 hours' FROM cpage, unnest(ARRAY['29b7766f5a072718c010509539ce91983be2df2d', 'a0a9376980790b00db24b15d36624057e2197582']) k;

-- ===================================================================================================
-- AI visibility: three questions put to three assistants, once a month for three months (the business named more often each time)
-- ===================================================================================================
CREATE TEMP TABLE aiq (p int, prompt text) ON COMMIT DROP;
INSERT INTO aiq VALUES (1, 'Who are the best roofing companies in Denver? Name specific businesses.'), (2, 'Who should I call for hail damage roof repair in Aurora, Colorado?'), (3, 'Which Denver roofers offer free roof inspections?');
INSERT INTO seo_ai_checks (id, user_id, site_id, prompt, engine, model, mentioned, cited, listed_at, businesses, sources, searches, answer, cost_usd, created_at, run_id)
SELECT 910000 + q.p * 100 + m.m * 10 + e.i, 1, 910001, q.prompt, e.engine, e.model, x.mentioned, x.mentioned AND x.cited,
  CASE WHEN x.mentioned THEN x.at END,
  (SELECT jsonb_agg(nm) FROM (SELECT CASE WHEN x.mentioned AND pos = x.at THEN 'Summit Roofing Co.' ELSE r.name END AS nm FROM generate_series(1, 5) pos
      LEFT JOIN rival r ON r.i = 1 + ((pg_temp.h(q.p || e.engine || m.m || 'b') + pos - CASE WHEN x.mentioned AND x.at < pos THEN 1 ELSE 0 END) % 10)) b),
  (SELECT jsonb_agg(jsonb_build_object('domain', d, 'title', t, 'url', 'https://' || d || u, 'ours', d = 'summitroofing.example')) FROM (
      SELECT * FROM (VALUES ('denverhomeguide.example', 'The 10 best roofers in Denver (2026)', '/best-roofers-denver-2026'), ('coloradoroofingreviews.example', 'Denver roofing contractor reviews', '/denver'),
                            ('frontrangeliving.example', 'The best Denver roofers of 2026', '/best-denver-roofers-2026'), ('clearpeakexteriors.example', 'Clearpeak Exteriors – Denver roofing', '/'),
                            ('cobaltridge.example', 'Cobalt Ridge Roofing', '/'), ('hailreportcolorado.example', 'June 2026 hail report', '/2026/june-storm-denver-metro')) s(d, t, u)
      WHERE pg_temp.h(q.p || e.engine || m.m || d) % 3 > 0
      UNION ALL SELECT 'summitroofing.example', 'Summit Roofing Co. – free roof inspections in Denver', '/free-roof-inspection' WHERE x.mentioned AND x.cited) z),
  jsonb_build_array(lower(regexp_replace(q.prompt, '[?.]| Name specific businesses', '', 'g')), 'denver roofing contractor reviews', 'hail damage roof repair denver'),
  CASE WHEN x.mentioned THEN 'Several Denver-area roofers stand out for hail repair and inspections. **Summit Roofing Co.** is frequently recommended for free inspections and insurance claim help across Denver, Aurora and Lakewood. **Clearpeak Exteriors** and **Cobalt Ridge Roofing** are also well reviewed. Check recent reviews and confirm licensing before you book.'
       ELSE 'Well-reviewed roofing companies in the Denver area include **Clearpeak Exteriors**, **Cobalt Ridge Roofing**, **Northgate Storm Restoration** and **Brightpine Roofing**. Look for a local address, a Colorado license and references from the last hail season.' END,
  CASE e.engine WHEN 'chatgpt' THEN 0.027 WHEN 'gemini' THEN 0.036 ELSE 0.006 END,
  now() - (m.ago || ' days')::interval + (q.p || ' hours')::interval + (e.i || ' minutes')::interval,
  ('00910010-0000-4000-8000-0000000' || q.p || m.m || '000')::uuid
FROM aiq q
CROSS JOIN (VALUES (1, 'chatgpt', 'gpt-4o-mini'), (2, 'gemini', 'gemini-2.5-flash-lite'), (3, 'perplexity', 'sonar')) e(i, engine, model)
CROSS JOIN (VALUES (0, 68), (1, 38), (2, 8)) m(m, ago)
CROSS JOIN LATERAL (
  -- Named in 3 of 9 answers two months ago, 5 of 9 last month, 7 of 9 now; its website among the sources a little less often.
  SELECT (CASE m.m WHEN 0 THEN (q.p * 3 + e.i) % 3 = 0 WHEN 1 THEN (q.p * 3 + e.i) % 9 < 5 ELSE NOT (q.p = 3 AND e.i = 2 OR q.p = 1 AND e.i = 3) END) AS mentioned,
         ((q.p + e.i + m.m) % 3 <> 0) AS cited,
         1 + ((q.p * 2 + e.i + m.m) % 4) AS at) x;
INSERT INTO seo_ai_tracked (id, site_id, user_id, prompt, engines, next_at, created_at) VALUES
 (910001, 910001, 1, 'Who are the best roofing companies in Denver? Name specific businesses.', ARRAY['chatgpt', 'gemini', 'perplexity'], now() + interval '22 days', now() - interval '68 days'),
 (910002, 910001, 1, 'Which Denver roofers offer free roof inspections?', ARRAY['chatgpt', 'gemini', 'perplexity'], now() + interval '22 days', now() - interval '68 days');

-- ===================================================================================================
-- Action plan
-- ===================================================================================================
INSERT INTO seo_tasks (id, user_id, site_id, kind, title, target, detail, source, status, note, created_at, updated_at, done_at, due_on, owner) VALUES
 (910001, 1, 910001, 'keyword', 'Move "roof replacement denver" into the top 3', 'roof replacement denver', '{"position":3,"volume":1900,"device":"desktop"}', 'kw:roof replacement denver', 'doing', 'Expand the Denver page: add the Class 4 shingle section and three recent jobs with photos.', now() - interval '18 days', now() - interval '3 days', NULL, current_date + 14, 'Sam Rivera'),
 (910002, 1, 910001, 'page', 'Write a page for "commercial roofing denver"', 'https://summitroofing.example/commercial-flat-roofing', '{"position":24,"volume":880,"difficulty":55}', 'kw:commercial roofing denver', 'todo', NULL, now() - interval '12 days', now() - interval '12 days', NULL, current_date + 30, 'Maria Delgado'),
 (910003, 1, 910001, 'link_reclaim', 'Win back the lost link from denverhoa-news.example', 'https://denverhoa-news.example/vendors/roofing', ('{"authority":31,"lastSeen":"' || to_char(current_date - 9, 'YYYY-MM-DD') || '"}')::jsonb, 'lost:denverhoa-news.example', 'todo', 'Vendor page was rebuilt; ask the editor to re-add us.', now() - interval '2 days', now() - interval '2 days', NULL, current_date + 10, 'Sam Rivera'),
 (910004, 1, 910001, 'link_prospect', 'Ask frontrangeliving.example for a link (they name us without linking)', 'https://frontrangeliving.example/best-denver-roofers-2026', '{"authority":36}', 'mention:frontrangeliving.example', 'todo', NULL, now() - interval '2 days', now() - interval '2 days', NULL, NULL, NULL),
 (910005, 1, 910001, 'audit', 'Fix missing meta descriptions on 6 pages', 'https://summitroofing.example/', '{"crawlId":"93000000-0000-4000-8000-00000000f001","count":6,"severity":"warning"}', 'audit:missing-meta-description', 'doing', NULL, now() - interval '9 days', now() - interval '1 day', NULL, current_date + 5, 'Tom Becker'),
 (910006, 1, 910001, 'audit', 'Compress oversized images on the gallery page', 'https://summitroofing.example/gallery', '{"crawlId":"93000000-0000-4000-8000-00000000f002","count":11,"severity":"warning"}', 'audit:oversized-images', 'done', 'Converted to WebP, 4.1 MB saved.', now() - interval '22 days', now() - interval '9 days', now() - interval '9 days', NULL, 'Tom Becker'),
 (910007, 1, 910001, 'keyword', 'Add a Westminster service-area page', 'roofing contractor westminster co', '{"position":null,"volume":320}', 'kw:roofing contractor westminster co', 'done', 'Live since the 20th; first ranking two weeks later.', now() - interval '47 days', now() - interval '21 days', now() - interval '21 days', NULL, 'Maria Delgado'),
 (910008, 1, 910001, 'other', 'Publish the October hail-season recap post', NULL, '{}', NULL, 'todo', 'Use the 300-inspections figure and the Westminster photos.', now() - interval '4 days', now() - interval '4 days', NULL, current_date + 7, 'Sam Rivera'),
 (910009, 1, 910001, 'link_reclaim', 'Fix the broken link from coloradocontractorsassoc.example', 'https://coloradocontractorsassoc.example/news/2025-storm-season', '{"authority":41}', 'lost:coloradocontractorsassoc.example', 'dropped', 'The article was taken down; nothing to fix.', now() - interval '13 days', now() - interval '6 days', NULL, NULL, NULL),
 (910010, 1, 910002, 'page', 'Write "how to spot hail damage" with photos from this season', 'https://denverhailrepair.example/blog/how-to-spot-hail-damage', '{"position":21,"volume":2400}', 'kw:how to spot hail damage on a roof', 'todo', NULL, now() - interval '6 days', now() - interval '6 days', NULL, current_date + 21, 'Maria Delgado');

-- ===================================================================================================
-- Keyword watch: two monthly snapshots of what the site ranks for (the newer one finds 7 new searches)
-- ===================================================================================================
CREATE FUNCTION pg_temp.snapshot_kws(worse int, drop_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('keyword', e->>'keyword', 'position', least(100, (e->>'position')::int + worse), 'volume', (e->>'volume')::int,
      'traffic', round((e->>'volume')::int * pg_temp.ctr(least(100, (e->>'position')::int + worse)), 1), 'path', regexp_replace(e->>'url', '^https?://[^/]+', ''), 'url', e->>'url') ORDER BY (e->>'volume')::int DESC)
  FROM seo_domain_reports r, jsonb_array_elements(r.report->'keywords') WITH ORDINALITY AS t(e, o)
  WHERE r.id = 910001 AND (drop_n = 0 OR NOT (e->>'keyword' IN ('solar ready roof replacement', 'roof snow removal denver', 'roofing warranty colorado', 'skylight repair denver', 'roofing contractor golden co', 'roofing contractor westminster co', 'ice dam prevention colorado'))) $$;
INSERT INTO seo_keyword_snapshots (id, site_id, user_id, taken_on, location_code, language_code, keywords, total, cost_usd, alerts_done, version, created_at, fetched)
VALUES
 (910001, 910001, 1, current_date - 33, 2840, 'en', pg_temp.snapshot_kws(2, 1), 139, 0.0398, true, 2, current_date - 33 + interval '5 hours', 53),
 (910002, 910001, 1, current_date - 3,  2840, 'en', pg_temp.snapshot_kws(0, 0), 149, 0.0412, true, 2, current_date - 3 + interval '5 hours', 60);

-- ===================================================================================================
-- Mentions watch: the monthly check of pages published since the last one
-- ===================================================================================================
INSERT INTO seo_mention_checks (id, site_id, user_id, name, name_key, since, run_on, page, window_from, window_to, complete, cost_usd, alerts_done, created_at, seen_keys)
SELECT 910001, 910001, 1, 'Summit Roofing Co.', 'summit roofing co.', current_date - 33, current_date - 2,
  jsonb_build_object('name', 'Summit Roofing Co.', 'domain', 'summitroofing.example', 'total', 4, 'linksChecked', true, 'linksCheckedAt', pg_temp.iso(current_date - 2 + interval '5 hours 29 minutes'), 'fetchedAt', pg_temp.iso(current_date - 2 + interval '5 hours 28 minutes'),
    'complete', true, 'resumeFrom', NULL, 'skippedSeen', 1, 'seenKeys', '["frontrangeliving.example/best-denver-roofers-2026","lakewoodliving.example/after-the-hail","denverdiyforum.example/threads/who-did-your-roof-2026","westminsterbiz.example/members","parkerparents.example/local-deals/fall-gutter-cleaning"]'::jsonb,
    'rows', jsonb_build_array(
      jsonb_build_object('url', 'https://frontrangeliving.example/best-denver-roofers-2026', 'domain', 'frontrangeliving.example', 'title', 'The best Denver roofers of 2026, according to homeowners', 'snippet', 'Readers named Summit Roofing Co. most often for hail repair in Denver and Arvada.', 'published', to_char(current_date - 12, 'YYYY-MM-DD'), 'authority', 36, 'linksToYou', false),
      jsonb_build_object('url', 'https://lakewoodliving.example/after-the-hail', 'domain', 'lakewoodliving.example', 'title', 'After the hail: who Lakewood neighbors called', 'snippet', 'Several Lakewood readers recommended Summit Roofing Co. for same-week estimates.', 'published', to_char(current_date - 9, 'YYYY-MM-DD'), 'authority', 25, 'linksToYou', false),
      jsonb_build_object('url', 'https://denverdiyforum.example/threads/who-did-your-roof-2026', 'domain', 'denverdiyforum.example', 'title', 'Who did your roof? (Denver metro thread)', 'snippet', 'We went with Summit Roofing Co. after the June storm. Highlands area.', 'published', to_char(current_date - 6, 'YYYY-MM-DD'), 'authority', 9, 'linksToYou', false),
      jsonb_build_object('url', 'https://westminsterbiz.example/members', 'domain', 'westminsterbiz.example', 'title', 'Westminster business members', 'snippet', 'Summit Roofing Co. · Roofing contractor · Member since 2024', 'published', to_char(current_date - 20, 'YYYY-MM-DD'), 'authority', 21, 'linksToYou', true))),
  current_date - 33 + interval '5 hours', current_date - 2 + interval '5 hours 28 minutes', true, 0.0471, true, current_date - 2 + interval '5 hours 28 minutes',
  ARRAY['frontrangeliving.example/best-denver-roofers-2026', 'lakewoodliving.example/after-the-hail', 'denverdiyforum.example/threads/who-did-your-roof-2026', 'westminsterbiz.example/members', 'parkerparents.example/local-deals/fall-gutter-cleaning'];
INSERT INTO seo_mention_verdicts (site_id, user_id, name_key, page_key, page_url, verdict, marked_at) VALUES
 (910001, 1, 'summit roofing co.', 'summitroofingtx.example/about', 'https://summitroofingtx.example/about', 'not_mine', now() - interval '20 hours'),
 (910001, 1, 'summit roofing co.', 'frontrangeliving.example/best-denver-roofers-2026', 'https://frontrangeliving.example/best-denver-roofers-2026', 'mine', now() - interval '20 hours');

-- ===================================================================================================
-- Monthly client report: schedule and a confirmed recipient
-- ===================================================================================================
INSERT INTO seo_report_schedules (site_id, user_id, frequency, recipients, next_send_at, last_sent_at, updated_at)
VALUES (910001, 1, 'monthly', ARRAY['sam@summitroofing.example', 'maria@summitroofing.example'], date_trunc('month', now()) + interval '1 month 8 hours', date_trunc('month', now()) + interval '8 hours 2 minutes', now() - interval '40 days');
INSERT INTO seo_report_recipients (user_id, email, status, source, confirm_sent_at, confirm_tries, confirmed_at, created_at) VALUES
 (1, 'sam@summitroofing.example', 'confirmed', 'account', NULL, 0, now() - interval '40 days', now() - interval '40 days'),
 (1, 'maria@summitroofing.example', 'confirmed', 'customer', now() - interval '40 days', 1, now() - interval '39 days 20 hours', now() - interval '40 days');

COMMIT;
