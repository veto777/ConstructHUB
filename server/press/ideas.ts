/**
 * What the account already knows, for the press writer (owner, 2026-10-17: "give it some automation"):
 *
 *   loadPrefill(userId)  the writer's company and contact fields, each from the first place that has it:
 *                        1. the user's last press release · 2. their CRM org (crm_orgs.owner_user_id) ·
 *                        3. their business profile (business_locations) · 4. their user profile.
 *   findIdeas(userId)    up to 5 newsworthy facts found in the account's OWN data (a new division, a completed-project
 *                        or Google-review milestone, a round anniversary, new team members, awards and certifications
 *                        from the Call Assistant profile, new service areas), less the ones dismissed or already used.
 *
 * HARD RULE (CLAUDE.md): nothing here is invented. Every number is a query result, every name a stored value, and a
 * missing value means no field and no idea. The idea's detailsDraft only restates its own facts.
 */
import { createHash } from "node:crypto";
import { pool } from "../db";
import { PRESS_PREFILL_FIELDS, type PressIdea, type PressPrefill, type PressPrefillField, type PressPrefillSource } from "@shared/press";

type Q = { query: (sql: string, vals?: unknown[]) => Promise<{ rows: any[] }> };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const httpUrl = (v: unknown): string => { const s = clean(v); return /^https?:\/\/\S+$/i.test(s) ? s : ""; };

/** "October 3, 2026" (UTC: the stored timestamps are UTC). */
export const longDate = (d: Date | string): string => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const n = (v: number) => v.toLocaleString("en-US");
const short = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

/** The largest round milestone at or below `count`, or null. */
export const milestoneFor = (count: number, steps: readonly number[]): number | null => {
  let hit: number | null = null;
  for (const m of steps) if (count >= m) hit = m;
  return hit;
};
export const PROJECT_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const REVIEW_MILESTONES = [50, 100, 250, 500, 1000, 2500] as const;
/** A milestone, an opening or a new hire older than this is not news any more. */
const RECENT_DAYS = { division: 90, team: 90, milestone: 180, review: 365, opening: 365 } as const;
const daysAgo = (d: Date | string, now: Date) => (now.getTime() - new Date(d).getTime()) / 86_400_000;

// ---- the account ----------------------------------------------------------------------------------------------

type Org = { id: string; name: string; email: string | null; phone: string | null; website: string | null; city: string | null; state: string | null; description: string | null; owner_user_id: number };
type Location = { id: number; business_name: string; website: string | null; city: string | null; state: string | null; phone: string | null; description: string | null; review_count: number | null; avg_rating: number | null; opening_date: string | null };

/** The user's own CRM org: the first one they own (an agency owner's later orgs are their clients'). */
export async function primaryOrg(userId: number, db: Q = pool): Promise<Org | null> {
  const { rows } = await db.query(`SELECT id, name, email, phone, website, city, state, description, owner_user_id FROM crm_orgs WHERE owner_user_id=$1 ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [userId]);
  return rows[0] ?? null;
}
/** The user's main business profile: the one with the most Google reviews, else the first added. */
async function primaryLocation(userId: number, db: Q): Promise<Location | null> {
  const { rows } = await db.query(
    `SELECT id, business_name, website, city, state, phone, description, review_count, avg_rating, opening_date FROM business_locations WHERE user_id=$1 ORDER BY COALESCE(review_count,0) DESC, created_at ASC, id LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}
/** The Call Assistant profile of the org (the published one when there is one). */
async function voiceProfile(orgId: string, db: Q): Promise<any | null> {
  const { rows } = await db.query(`SELECT COALESCE(published_profile, profile) AS p FROM voice_profiles WHERE org_id=$1`, [orgId]);
  return rows[0]?.p ?? null;
}

// ---- prefill --------------------------------------------------------------------------------------------------

export async function loadPrefill(userId: number, db: Q = pool): Promise<PressPrefill> {
  const out: PressPrefill = { values: {}, sources: {} };
  const take = (source: PressPrefillSource, vals: Partial<Record<PressPrefillField, string>>) => {
    for (const f of PRESS_PREFILL_FIELDS) {
      const v = f === "website" ? httpUrl(vals[f]) : clean(vals[f]);
      if (v && !out.values[f]) { out.values[f] = v; out.sources[f] = source; }
    }
  };

  const { rows: [last] } = await db.query(`SELECT input FROM press_releases WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [userId]);
  if (last?.input) {
    const i = last.input;
    take("last_release", { companyName: i.companyName, website: i.website, city: i.city, state: i.state, contactName: i.contactName, contactEmail: i.contactEmail, contactPhone: i.contactPhone, about: i.about });
  }

  const org = await primaryOrg(userId, db);
  if (org) {
    const { rows: [owner] } = await db.query(`SELECT display_name FROM crm_members WHERE org_id=$1 AND user_id=$2 LIMIT 1`, [org.id, userId]);
    const vp = await voiceProfile(org.id, db);
    take("crm", { companyName: org.name, website: org.website ?? undefined, city: org.city ?? undefined, state: org.state ?? undefined, contactName: owner?.display_name, contactEmail: org.email ?? undefined, contactPhone: org.phone ?? undefined, about: clean(org.description) || clean(vp?.company?.about) });
  }

  const loc = await primaryLocation(userId, db);
  if (loc) take("business_profile", { companyName: loc.business_name, website: loc.website ?? undefined, city: loc.city ?? undefined, state: loc.state ?? undefined, contactPhone: loc.phone ?? undefined, about: loc.description ?? undefined });

  const { rows: [u] } = await db.query(`SELECT email, display_name, company_name FROM users WHERE id=$1`, [userId]);
  if (u) take("profile", { companyName: u.company_name, contactName: u.display_name, contactEmail: u.email });
  return out;
}

// ---- story ideas ----------------------------------------------------------------------------------------------

type Ctx = { userId: number; now: Date; db: Q; company: string; org: Org | null; loc: Location | null; vp: any | null; base: string };

/** "Ridgeline Roofing is based in Columbus, OH." when both are stored, else "". */
const baseSentence = (company: string, city?: string | null, state?: string | null) => (clean(city) && clean(state) ? `${company} is based in ${clean(city)}, ${clean(state)}.` : "");
const join = (parts: string[]) => parts.filter(Boolean).join(" ");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

async function newDivision(c: Ctx): Promise<PressIdea | null> {
  if (!c.org) return null;
  const { rows: [total] } = await c.db.query(`SELECT count(*)::int AS n FROM crm_divisions WHERE org_id=$1`, [c.org.id]);
  if ((total?.n ?? 0) < 2) return null; // the first division is the company itself, not an expansion
  const { rows: [d] } = await c.db.query(
    `SELECT id, name, city, state, created_at FROM crm_divisions WHERE org_id=$1 AND NOT is_headquarters AND created_at > $2::timestamptz - interval '${RECENT_DAYS.division} days' ORDER BY created_at DESC LIMIT 1`,
    [c.org.id, c.now],
  );
  if (!d || !clean(d.name)) return null;
  const where = clean(d.city) && clean(d.state) ? `${clean(d.city)}, ${clean(d.state)}` : "";
  const facts = [`New division: ${clean(d.name)}`, where ? `Location: ${where}` : "", `Added in your CRM on ${longDate(d.created_at)}`].filter(Boolean);
  return {
    key: `division:${d.id}`, newsType: "expansion", title: `New division: ${clean(d.name)}`,
    why: "A new location or division is expansion news.",
    facts,
    detailsDraft: join([`${c.company} has added a new division, ${clean(d.name)}${where ? `, in ${where}` : ""}.`, `The division was set up on ${longDate(d.created_at)}.`, c.base]),
  };
}

async function completedMilestone(c: Ctx, table: "crm_projects" | "crm_jobs", word: string): Promise<PressIdea | null> {
  if (!c.org) return null;
  const { rows: [cnt] } = await c.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1 AND completed_at IS NOT NULL AND status <> 'cancelled'`, [c.org.id]);
  const total = cnt?.n ?? 0;
  const m = milestoneFor(total, PROJECT_MILESTONES);
  if (!m) return null;
  const { rows: [nth] } = await c.db.query(`SELECT completed_at FROM ${table} WHERE org_id=$1 AND completed_at IS NOT NULL AND status <> 'cancelled' ORDER BY completed_at, id OFFSET $2 LIMIT 1`, [c.org.id, m - 1]);
  if (!nth || daysAgo(nth.completed_at, c.now) > RECENT_DAYS.milestone) return null;
  return {
    key: `${table === "crm_projects" ? "projects" : "jobs"}:${m}`, newsType: "milestone", title: `${n(m)} ${word}s completed`,
    why: "A round number of finished work is a milestone the wire accepts.",
    facts: [`${n(total)} ${word}s marked complete in your CRM`, `${word[0].toUpperCase()}${word.slice(1)} number ${n(m)} was completed on ${longDate(nth.completed_at)}`],
    detailsDraft: join([`${c.company} has completed ${n(m)} ${word}s.`, `The ${n(m)}th was finished on ${longDate(nth.completed_at)}, and the count now stands at ${n(total)}.`, c.base]),
  };
}

async function reviewMilestone(c: Ctx): Promise<PressIdea | null> {
  const loc = c.loc;
  if (!loc) return null;
  const { rows: [r] } = await c.db.query(`SELECT count(*)::int AS n FROM google_profile_reviews WHERE user_id=$1 AND location_id=$2 AND NOT google_deleted`, [c.userId, loc.id]);
  const rowsCount = r?.n ?? 0;
  const total = rowsCount || (loc.review_count ?? 0);
  const m = milestoneFor(total, REVIEW_MILESTONES);
  if (!m) return null;
  let reached: Date | null = null;
  if (rowsCount >= m) {
    const { rows: [nth] } = await c.db.query(`SELECT review_date FROM google_profile_reviews WHERE user_id=$1 AND location_id=$2 AND NOT google_deleted ORDER BY review_date, id OFFSET $3 LIMIT 1`, [c.userId, loc.id, m - 1]);
    reached = nth?.review_date ?? null;
    if (!reached || daysAgo(reached, c.now) > RECENT_DAYS.review) return null;
  }
  const rating = typeof loc.avg_rating === "number" && loc.avg_rating > 0 ? loc.avg_rating : null;
  const facts = [`${n(total)} Google reviews on your business profile`, rating ? `Average rating: ${rating.toFixed(1)} out of 5` : "", reached ? `Review number ${n(m)} arrived on ${longDate(reached)}` : `That passes the ${n(m)}-review mark`].filter(Boolean);
  return {
    key: `reviews:${loc.id}:${m}`, newsType: "milestone", title: `Passed ${n(m)} Google reviews`,
    why: "A review milestone shows how many customers vouch for the company.",
    facts,
    detailsDraft: join([`${c.company} has passed ${n(m)} Google reviews, with ${n(total)} on its business profile${rating ? ` and an average rating of ${rating.toFixed(1)} out of 5` : ""}.`, reached ? `Review number ${n(m)} arrived on ${longDate(reached)}.` : "", c.base]),
  };
}

async function anniversary(c: Ctx): Promise<PressIdea | null> {
  const fromProfile = Number(c.vp?.credibility?.foundedYear);
  const fromGoogle = Number(clean(c.loc?.opening_date).match(/^(\d{4})/)?.[1]);
  const year = Number.isInteger(fromProfile) && fromProfile > 1800 ? fromProfile : Number.isInteger(fromGoogle) && fromGoogle > 1800 ? fromGoogle : null;
  if (!year) return null;
  const thisYear = c.now.getUTCFullYear();
  const years = thisYear - year;
  if (years < 5 || years % 5 !== 0) return null;
  const source = year === fromProfile ? "your Call Assistant profile" : "your Google business profile";
  return {
    key: `anniversary:${thisYear}`, newsType: "milestone", title: `${years} years in business`,
    why: "A round anniversary is a milestone the wire accepts.",
    facts: [`Founded in ${year} (from ${source})`, `${years} years in business in ${thisYear}`],
    detailsDraft: join([`${c.company} marks ${years} years in business in ${thisYear}.`, `The company was founded in ${year}.`, c.base]),
  };
}

async function newTeam(c: Ctx): Promise<PressIdea | null> {
  if (!c.org) return null;
  const { rows } = await c.db.query(
    `SELECT id, display_name, title, created_at FROM crm_members WHERE org_id=$1 AND status='active' AND user_id IS DISTINCT FROM $2 AND created_at > $3::timestamptz - interval '${RECENT_DAYS.team} days' AND COALESCE(trim(display_name),'') <> '' ORDER BY created_at DESC LIMIT 6`,
    [c.org.id, c.org.owner_user_id, c.now],
  );
  if (!rows.length) return null;
  const people = rows.map((m: any) => `${clean(m.display_name)}${clean(m.title) ? `, ${clean(m.title)}` : ""}`);
  return {
    key: `team:${rows[0].id}`, newsType: "hire", title: rows.length === 1 ? `New team member: ${clean(rows[0].display_name)}` : `${rows.length} new team members`,
    why: "New hires are news the wire accepts, especially with names and titles.",
    facts: rows.map((m: any, i: number) => `${people[i]} joined on ${longDate(m.created_at)}`),
    detailsDraft: join([`${c.company} has added ${rows.length === 1 ? "a new team member" : `${rows.length} team members`} in the last three months: ${list(people)}.`, c.base]),
  };
}

async function awards(c: Ctx): Promise<PressIdea | null> {
  const a: string[] = (c.vp?.credibility?.awards ?? []).map(clean).filter(Boolean);
  const cert: string[] = (c.vp?.credibility?.certifications ?? []).map(clean).filter(Boolean);
  if (!a.length && !cert.length) return null;
  const items = [...a.map((x) => `Award: ${x}`), ...cert.map((x) => `Certification: ${x}`)].slice(0, 6);
  return {
    key: `awards:${short(items.join("|"))}`, newsType: "award", title: a.length ? "Awards on your profile" : "Certifications on your profile",
    why: "Awards and certifications are recognition news.",
    facts: items,
    detailsDraft: join([
      a.length ? `${c.company} has received the following recognition: ${list(a.slice(0, 4))}.` : "",
      cert.length ? `The company holds ${list(cert.slice(0, 4))}.` : "",
      c.base,
    ]),
  };
}

async function newServiceArea(c: Ctx): Promise<PressIdea | null> {
  if (!c.org || !c.vp) return null;
  const { rows: [old] } = await c.db.query(
    `SELECT profile FROM voice_profile_versions WHERE org_id=$1 AND created_at < $2::timestamptz - interval '60 days' ORDER BY created_at DESC LIMIT 1`,
    [c.org.id, c.now],
  );
  if (!old?.profile) return null; // nothing to compare with: the first setup is not an expansion
  const key = (x: any) => `${x?.id}`;
  const before = new Set<string>((old.profile?.serviceArea?.counties ?? []).map(key));
  const added = (c.vp?.serviceArea?.counties ?? []).filter((x: any) => x?.id && !before.has(key(x)) && clean(x.name));
  if (!added.length) return null;
  const names = added.slice(0, 6).map((x: any) => `${clean(x.name)}${/county|parish|borough/i.test(x.name) ? "" : " County"}, ${clean(x.stateCode)}`);
  return {
    key: `area:${short(added.map(key).sort().join(","))}`, newsType: "expansion", title: added.length === 1 ? `New service area: ${names[0]}` : `${added.length} new service areas`,
    why: "Serving a new area is expansion news.",
    facts: names.map((x: string) => `New service area: ${x}`),
    detailsDraft: join([`${c.company} now serves ${list(names)}.`, `${added.length === 1 ? "This area was" : "These areas were"} added to the company's service area in the last two months.`, c.base]),
  };
}

async function newOpening(c: Ctx): Promise<PressIdea | null> {
  const d = clean(c.loc?.opening_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || daysAgo(`${d}T00:00:00Z`, c.now) > RECENT_DAYS.opening || daysAgo(`${d}T00:00:00Z`, c.now) < 0) return null;
  const where = clean(c.loc?.city) && clean(c.loc?.state) ? `${clean(c.loc!.city)}, ${clean(c.loc!.state)}` : "";
  return {
    key: `opening:${c.loc!.id}:${d}`, newsType: "launch", title: "Opened this year",
    why: "A new business or location opening is launch news.",
    facts: [`Opening date on your Google business profile: ${longDate(`${d}T00:00:00Z`)}`, where ? `Location: ${where}` : ""].filter(Boolean),
    detailsDraft: join([`${c.company} opened on ${longDate(`${d}T00:00:00Z`)}${where ? ` in ${where}` : ""}.`, c.base]),
  };
}

/** Every idea the data supports, best first, before dismissals. */
export async function buildIdeas(userId: number, opts: { now?: Date; db?: Q } = {}): Promise<PressIdea[]> {
  const db = opts.db ?? pool;
  const now = opts.now ?? new Date();
  const [prefill, org, loc] = await Promise.all([loadPrefill(userId, db), primaryOrg(userId, db), primaryLocation(userId, db)]);
  const company = prefill.values.companyName || org?.name || loc?.business_name || "";
  if (!company) return [];
  const vp = org ? await voiceProfile(org.id, db) : null;
  const c: Ctx = { userId, now, db, company, org, loc, vp, base: baseSentence(company, prefill.values.city, prefill.values.state) };
  const builders = [newDivision, newOpening, (x: Ctx) => completedMilestone(x, "crm_projects", "project"), (x: Ctx) => completedMilestone(x, "crm_jobs", "job"), reviewMilestone, anniversary, newTeam, awards, newServiceArea];
  const out: PressIdea[] = [];
  for (const b of builders) {
    try { const idea = await b(c); if (idea && idea.facts.length) out.push(idea); } catch (e: any) { console.error(`[press] idea: ${e?.message ?? e}`); }
  }
  return out;
}

export async function ideaMarks(userId: number, db: Q = pool): Promise<Map<string, "dismissed" | "used">> {
  const { rows } = await db.query(`SELECT idea_key, mark FROM press_idea_marks WHERE user_id=$1`, [userId]);
  return new Map(rows.map((r: any) => [r.idea_key, r.mark]));
}
export async function markIdea(userId: number, key: string, mark: "dismissed" | "used", releaseId: number | null = null, db: Q = pool): Promise<void> {
  await db.query(
    `INSERT INTO press_idea_marks (user_id, idea_key, mark, release_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, idea_key) DO UPDATE SET mark=EXCLUDED.mark, release_id=COALESCE(EXCLUDED.release_id, press_idea_marks.release_id)`,
    [userId, key.slice(0, 200), mark, releaseId],
  );
}

export const MAX_IDEAS = 5;
/** Up to 5 ideas the customer has neither dismissed nor used. */
export async function findIdeas(userId: number, opts: { now?: Date; db?: Q } = {}): Promise<PressIdea[]> {
  const [all, marks] = await Promise.all([buildIdeas(userId, opts), ideaMarks(userId, opts.db)]);
  return all.filter((i) => !marks.has(i.key)).slice(0, MAX_IDEAS);
}
