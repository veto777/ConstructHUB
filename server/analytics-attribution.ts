/**
 * Campaign attribution on top of the consent-gated first-party analytics
 * (server/analytics.ts) — which social post, and which referring site, a
 * visit and a sign-up came from.
 *
 * What is stored, and nothing else:
 *   ch_analytics_events.landing        — the first page view of a page load that
 *                                        did not come from the site's own domain
 *   ch_analytics_events.utm_source / utm_medium / utm_campaign
 *                                      — the sanitized campaign tags of that landing
 *   ch_analytics_events.referrer_host  — the referring site's HOST (never a URL)
 *   ch_signup_attribution              — one row per new account: the first
 *                                        attributed landing of the browser that
 *                                        created it (first touch wins, set once)
 *   ch_analytics_meta                  — the date attribution started here
 *
 * Consent is the same gate as every other analytics write: ch_consent=granted
 * and a server-minted ch_vid, or nothing is read and nothing is written.
 *
 * No `./db` import at module scope: scripts/campaign-report.ts and the unit
 * tests pass their own Queryable.
 */
import {
  type CampaignReport, type CampaignRow, type DailyRow, type Utm,
  groupReferrers, hasUtm, isInternalHost, parseReportDate, referrerHost, sanitizeUtm, sortCampaigns,
} from "@shared/campaign-attribution";

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Idempotent DDL: boot runs it (server/routes.ts) and so does scripts/apply-schema-migration.ts.
 *  shared/schema.ts mirrors it. */
export const ANALYTICS_ATTRIBUTION_DDL: readonly string[] = [
  `ALTER TABLE ch_analytics_events ADD COLUMN IF NOT EXISTS landing boolean NOT NULL DEFAULT false`,
  `ALTER TABLE ch_analytics_events ADD COLUMN IF NOT EXISTS utm_source text`,
  `ALTER TABLE ch_analytics_events ADD COLUMN IF NOT EXISTS utm_medium text`,
  `ALTER TABLE ch_analytics_events ADD COLUMN IF NOT EXISTS utm_campaign text`,
  `ALTER TABLE ch_analytics_events ADD COLUMN IF NOT EXISTS referrer_host text`,
  `CREATE INDEX IF NOT EXISTS ch_analytics_landing_idx ON ch_analytics_events (created_at) WHERE landing`,
  `CREATE TABLE IF NOT EXISTS ch_signup_attribution (
     user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     utm_source text,
     utm_medium text,
     utm_campaign text,
     referrer_host text,
     touched_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ch_signup_attribution_created_idx ON ch_signup_attribution (created_at)`,
  `CREATE TABLE IF NOT EXISTS ch_analytics_meta (
     key text PRIMARY KEY,
     value text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // The first run on a database IS the moment attribution starts there; later runs keep it.
  `INSERT INTO ch_analytics_meta (key) VALUES ('attribution_started') ON CONFLICT (key) DO NOTHING`,
];

export async function ensureAnalyticsAttributionSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("./db")).pool;
  for (const sql of ANALYTICS_ATTRIBUTION_DDL) await target.query(sql);
}

// ── Consent gate ───────────────────────────────────────────────────────────────────────────────

export function parseCookieHeader(header: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // Malformed % escapes — treat the cookie as absent, never 500.
      }
    }
  }
  return out;
}

/** The server only ever mints UUID visitor ids — anything else is forged. */
const MINTED_VID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isMintedVisitorId(vid: string): boolean {
  return MINTED_VID.test(vid);
}

/** The visitor id of a browser that accepted the banner, or null — the one gate for every analytics write. */
export function consentedVisitorId(cookieHeader: unknown): string | null {
  const c = parseCookieHeader(cookieHeader);
  if (c.ch_consent !== "granted" || !c.ch_vid || !isMintedVisitorId(c.ch_vid)) return null;
  return c.ch_vid;
}

// ── Landing page view → stored columns ─────────────────────────────────────────────────────────

export type LandingColumns = {
  landing: boolean;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
  referrerHost: string | null;
};

const NOT_A_LANDING: LandingColumns = { landing: false, utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null };

/**
 * The attribution columns for one beacon event. Only an event the browser
 * flagged as the first page view of a page load can be a landing; a page load
 * that came from the site's own domain is a navigation and carries nothing —
 * unless it is tagged, which is always a landing.
 */
export function landingColumns(
  event: { landing?: unknown; utm?: unknown; referrer?: unknown },
  siteHost: string | null | undefined,
): LandingColumns {
  if (event.landing !== true) return NOT_A_LANDING;
  const utm: Utm = sanitizeUtm(event.utm);
  const host = referrerHost(event.referrer);
  const internal = isInternalHost(host, siteHost);
  if (internal && !hasUtm(utm)) return NOT_A_LANDING;
  return {
    landing: true,
    utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign,
    referrerHost: internal ? null : host,
  };
}

// ── Sign-up attribution ────────────────────────────────────────────────────────────────────────

/** How far back a browser's first campaign touch still counts toward its sign-up. */
export const FIRST_TOUCH_WINDOW_DAYS = 30;

/**
 * Called once, right after an account is created. Copies the EARLIEST
 * landing of this browser (within the window) that carried a campaign tag or
 * an outside referrer onto the new user, in one statement. First touch wins:
 * a user who already has a row keeps it. Without consent it reads nothing and
 * writes nothing. Never throws — attribution must not break a sign-up.
 */
export async function recordSignupAttribution(userId: number, cookieHeader: unknown, q?: Queryable): Promise<boolean> {
  try {
    const vid = consentedVisitorId(cookieHeader);
    if (!vid || !Number.isInteger(userId)) return false;
    const target = q ?? (await import("./db")).pool;
    const r = await target.query(
      `INSERT INTO ch_signup_attribution (user_id, utm_source, utm_medium, utm_campaign, referrer_host, touched_at)
       SELECT $1::int, utm_source, utm_medium, utm_campaign, referrer_host, created_at AT TIME ZONE 'UTC'
         FROM ch_analytics_events
        WHERE visitor_id = $2 AND landing
          AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL OR referrer_host IS NOT NULL)
          AND created_at >= (now() AT TIME ZONE 'UTC') - make_interval(days => $3::int)
        ORDER BY created_at ASC
        LIMIT 1
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, vid, FIRST_TOUCH_WINDOW_DAYS],
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e: any) {
    console.error("[analytics] sign-up attribution failed:", e?.message || e);
    return false;
  }
}

// ── The report ─────────────────────────────────────────────────────────────────────────────────

/** Days are US Eastern (the owner's clock); ch_analytics_events.created_at / users.created_at hold UTC wall time. */
const TZ = "America/New_York";
const EVENT_DAY = `((e.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date`;
const eventWindow = (col: string) =>
  `${col} >= ($1::date::timestamp AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC') AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC')`;
const signupWindow =
  `s.created_at >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND s.created_at < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const MAX_RANGE_DAYS = 366;

/** Default: the last 7 Eastern days including today (`days` picks another rolling span). A bad or inverted input falls back to the default. */
export function reportRange(input: { since?: unknown; until?: unknown; days?: unknown }, now = new Date()): { since: string; until: string } {
  const today = easternToday(now);
  const until = parseReportDate(input.until) ?? today;
  const n = Number(input.days);
  const span = Number.isInteger(n) && n >= 1 && n <= MAX_RANGE_DAYS ? n : 7;
  let since = parseReportDate(input.since) ?? addDays(until, -(span - 1));
  if (since > until) since = addDays(until, -(span - 1));
  if (addDays(since, MAX_RANGE_DAYS) < until) since = addDays(until, -MAX_RANGE_DAYS);
  return { since, until };
}

const key = (a: unknown, b: unknown, c: unknown) => JSON.stringify([a ?? null, b ?? null, c ?? null]);

/** Read-only. `source` narrows everything except the total sign-up count to one utm_source. */
export async function campaignReport(
  q: Queryable,
  input: { since?: unknown; until?: unknown; days?: unknown; source?: unknown },
  now = new Date(),
): Promise<CampaignReport> {
  const { since, until } = reportRange(input, now);
  const source = sanitizeUtm({ source: input.source }).source;
  const args: unknown[] = source ? [since, until, source] : [since, until];
  const eSrc = source ? " AND e.utm_source = $3" : "";
  const sSrc = source ? " AND s.utm_source = $3" : "";
  const tagged = "(e.utm_source IS NOT NULL OR e.utm_medium IS NOT NULL OR e.utm_campaign IS NOT NULL)";
  const landings = `FROM ch_analytics_events e WHERE e.landing AND ${eventWindow("e.created_at")}${eSrc}`;
  const signups = `FROM ch_signup_attribution s WHERE ${signupWindow}${sSrc}`;

  // One query at a time: the CLI runs this on a single connection inside a READ ONLY transaction.
  const meta = await q.query(`SELECT created_at FROM ch_analytics_meta WHERE key = 'attribution_started'`);
  const totals = await q.query(`SELECT count(*)::int AS visits, count(DISTINCT e.visitor_id)::int AS visitors ${landings}`, args);
  const allSignups = await q.query(`SELECT count(*)::int AS n FROM users u WHERE ${eventWindow("u.created_at")}`, [since, until]);
  const camp = await q.query(
    `SELECT e.utm_source, e.utm_medium, e.utm_campaign, count(*)::int AS visits, count(DISTINCT e.visitor_id)::int AS visitors
     ${landings} AND ${tagged} GROUP BY 1, 2, 3`, args);
  const campSign = await q.query(
    `SELECT s.utm_source, s.utm_medium, s.utm_campaign, count(*)::int AS signups ${signups} GROUP BY 1, 2, 3`, args);
  const refs = await q.query(
    `SELECT e.referrer_host, count(*)::int AS visits, count(DISTINCT e.visitor_id)::int AS visitors ${landings} GROUP BY 1`, args);
  const refSign = await q.query(`SELECT s.referrer_host, count(*)::int AS signups ${signups} GROUP BY 1`, args);
  const daily = await q.query(
    `SELECT to_char(${EVENT_DAY}, 'YYYY-MM-DD') AS day, e.utm_source, count(*)::int AS visits, count(DISTINCT e.visitor_id)::int AS visitors
     ${landings} AND e.utm_source IS NOT NULL GROUP BY 1, 2`, args);
  const dailySign = await q.query(
    `SELECT to_char((s.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day, s.utm_source, count(*)::int AS signups
     ${signups} AND s.utm_source IS NOT NULL GROUP BY 1, 2`, args);

  const campaigns = new Map<string, CampaignRow>();
  for (const r of camp.rows) {
    campaigns.set(key(r.utm_source, r.utm_medium, r.utm_campaign),
      { source: r.utm_source, medium: r.utm_medium, campaign: r.utm_campaign, visits: r.visits, visitors: r.visitors, signups: 0 });
  }
  let attributedSignups = 0;
  for (const r of campSign.rows) {
    if (r.utm_source == null && r.utm_medium == null && r.utm_campaign == null) continue;
    const k = key(r.utm_source, r.utm_medium, r.utm_campaign);
    const row = campaigns.get(k) ?? { source: r.utm_source, medium: r.utm_medium, campaign: r.utm_campaign, visits: 0, visitors: 0, signups: 0 };
    row.signups += r.signups;
    campaigns.set(k, row);
  }

  const hosts = new Map<string | null, { host: string | null; visits: number; visitors: number; signups: number }>();
  for (const r of refs.rows) hosts.set(r.referrer_host ?? null, { host: r.referrer_host ?? null, visits: r.visits, visitors: r.visitors, signups: 0 });
  for (const r of refSign.rows) {
    attributedSignups += r.signups;
    const h = r.referrer_host ?? null;
    const row = hosts.get(h) ?? { host: h, visits: 0, visitors: 0, signups: 0 };
    row.signups += r.signups;
    hosts.set(h, row);
  }

  const days = new Map<string, DailyRow>();
  for (const r of daily.rows) days.set(key(r.day, r.utm_source, null), { day: r.day, source: r.utm_source, visits: r.visits, visitors: r.visitors, signups: 0 });
  for (const r of dailySign.rows) {
    const k = key(r.day, r.utm_source, null);
    const row = days.get(k) ?? { day: r.day, source: r.utm_source, visits: 0, visitors: 0, signups: 0 };
    row.signups += r.signups;
    days.set(k, row);
  }

  const started = meta.rows[0]?.created_at;
  return {
    since, until,
    attributionStartedAt: started ? new Date(started).toISOString() : null,
    totals: {
      visits: totals.rows[0]?.visits ?? 0,
      visitors: totals.rows[0]?.visitors ?? 0,
      signups: allSignups.rows[0]?.n ?? 0,
      attributedSignups,
    },
    campaigns: sortCampaigns(Array.from(campaigns.values())),
    referrers: groupReferrers(Array.from(hosts.values())),
    daily: Array.from(days.values()).sort((a, b) => a.day.localeCompare(b.day) || b.visits - a.visits || a.source.localeCompare(b.source)),
  };
}
