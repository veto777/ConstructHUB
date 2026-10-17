/**
 * The press automation against a real database (the lane's dev DB, as worker.test.ts): story ideas are built only
 * from stored rows, the writer's prefill takes each field from the first source that has it, and autopilot drafts at
 * most once a month, skips when it should, and never moves a release past "draft" or spends a credit.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db";
import { ensurePressSchema } from "./schema";
import * as store from "./store";
import { buildIdeas, findIdeas, loadPrefill, markIdea, milestoneFor, PROJECT_MILESTONES } from "./ideas";
import { autopilotDeps, monthKey, nextDraftOn, runAutopilotFor, saveSettings } from "./autopilot";
import { draftDeps } from "./draft";
import type { PressReleaseInput, PressReleaseText } from "@shared/press";

const tag = `vt${Date.now().toString(36)}`;
const users: number[] = [];
const orgs: string[] = [];
const orders: number[] = [];

async function newUser(extra: { company?: string; name?: string } = {}): Promise<number> {
  const { rows: [u] } = await pool.query(`INSERT INTO users (email, company_name, display_name) VALUES ($1,$2,$3) RETURNING id`, [`${tag}-${users.length}@press.test`, extra.company ?? null, extra.name ?? null]);
  users.push(u.id);
  return u.id;
}
async function newOrg(userId: number, o: { name: string; city?: string; state?: string; email?: string; phone?: string; website?: string; description?: string }): Promise<string> {
  const { rows: [r] } = await pool.query(
    `INSERT INTO crm_orgs (name, owner_user_id, city, state, email, phone, website, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [o.name, userId, o.city ?? null, o.state ?? null, o.email ?? null, o.phone ?? null, o.website ?? null, o.description ?? null],
  );
  orgs.push(r.id);
  return r.id;
}
async function paidOrder(userId: number, tier: "budget" | "national" = "budget", credits = 14) {
  const o = await store.createOrder({ userId, email: `${tag}@press.test`, packageKey: "program_12", tier, credits, amountCents: 1 });
  await store.markPaid(o.id, `cs_${tag}_${o.id}`);
  orders.push(o.id);
  return o.id;
}
const fullInput = (over: Partial<PressReleaseInput> = {}): PressReleaseInput => ({
  newsType: "launch", companyName: "Last Release Roofing", website: "https://last.example", city: "Columbus", state: "OH", contactName: "Pat Last", contactEmail: "pat@last.example",
  contactPhone: "(614) 555-0101", details: "x".repeat(90), spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: "Roofing since 2014.", photos: [], ...over,
});
const TEXT: PressReleaseText = { headline: "Vitest Builders Adds a New Division", subheadline: "", dateline: "", body: "Vitest Builders today announced a new division in Dayton, Ohio.", boilerplate: "About Vitest Builders", mediaContact: "Pat Vitest\npat@vitest.example" };

const origDraft = draftDeps.draftRelease, origNotify = autopilotDeps.notify, origReady = autopilotDeps.writerReady;
const notified: { userId: number; title: string; link?: string }[] = [];

beforeAll(async () => {
  await ensurePressSchema(pool);
  draftDeps.draftRelease = async () => ({ ...TEXT });
  autopilotDeps.notify = (async (userId: number, _kind: string, msg: { title: string; link?: string }) => { notified.push({ userId, title: msg.title, link: msg.link }); return { inApp: true, email: "off" as const }; }) as any;
  autopilotDeps.writerReady = () => true;
});
afterAll(async () => {
  draftDeps.draftRelease = origDraft; autopilotDeps.notify = origNotify; autopilotDeps.writerReady = origReady;
  await pool.query(`DELETE FROM press_autopilot_runs WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_autopilot WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_idea_marks WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_releases WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_orders WHERE id = ANY($1) OR user_id = ANY($2)`, [orders, users]);
  for (const t of ["crm_divisions", "crm_projects", "crm_jobs", "crm_members", "voice_profiles", "voice_profile_versions"]) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
  await pool.query(`DELETE FROM crm_orgs WHERE id = ANY($1)`, [orgs]);
  await pool.query(`DELETE FROM google_profile_reviews WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM business_locations WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
  await pool.end();
});
beforeEach(() => { notified.length = 0; });

describe("story ideas", () => {
  it("milestones are the largest round number reached", () => {
    expect(milestoneFor(99, PROJECT_MILESTONES)).toBeNull();
    expect(milestoneFor(100, PROJECT_MILESTONES)).toBe(100);
    expect(milestoneFor(263, PROJECT_MILESTONES)).toBe(250);
  });

  it("an account with no data gets no ideas", async () => {
    const bare = await newUser();
    expect(await buildIdeas(bare)).toEqual([]);
    const withOrg = await newUser({ company: "Quiet Co" });
    await newOrg(withOrg, { name: "Quiet Co", city: "Columbus", state: "OH" });
    expect(await buildIdeas(withOrg)).toEqual([]);
  });

  it("builds each idea from the seeded rows, with the exact facts and nothing else", async () => {
    const u = await newUser({ company: "Vitest Builders" });
    const org = await newOrg(u, { name: "Vitest Builders", city: "Columbus", state: "OH" });
    const year = new Date().getUTCFullYear();
    await pool.query(`INSERT INTO crm_divisions (org_id, name, code, city, state, is_headquarters, created_at) VALUES ($1,'Columbus HQ','HQ','Columbus','OH',true, now() - interval '400 days'), ($1,'Dayton Exteriors','DAY','Dayton','OH',false, now() - interval '10 days')`, [org]);
    // 103 completed projects; the 100th finished 20 days ago. One cancelled project never counts.
    await pool.query(`INSERT INTO crm_projects (org_id, customer_id, name, status, completed_at) SELECT $1, 'c', 'P' || g, 'complete', now() - ((123 - g) || ' days')::interval FROM generate_series(1,103) g`, [org]);
    await pool.query(`INSERT INTO crm_projects (org_id, customer_id, name, status, completed_at) VALUES ($1,'c','Cancelled','cancelled', now())`, [org]);
    await pool.query(`INSERT INTO crm_members (org_id, user_id, email, role, status, display_name, title, created_at) VALUES ($1,$2,$3,'owner','active','Owner Person',null, now() - interval '300 days'), ($1,null,$4,'field','active','Jordan Lee','Estimator', now() - interval '5 days')`, [org, u, `${tag}-own@press.test`, `${tag}-jl@press.test`]);
    await pool.query(`INSERT INTO voice_profiles (org_id, profile) VALUES ($1,$2)`, [org, JSON.stringify({ company: { name: "Vitest Builders", about: "" }, credibility: { foundedYear: year - 10, awards: ["Best of Columbus 2025"], certifications: ["GAF Master Elite"] }, serviceArea: { counties: [] } })]);
    await pool.query(`INSERT INTO business_locations (user_id, business_name, city, state, review_count, avg_rating) VALUES ($1,'Vitest Builders','Columbus','OH',120,4.8)`, [u]);

    const ideas = await buildIdeas(u);
    const by = (p: string) => ideas.find((i) => i.key.startsWith(p));
    const days = (d: number) => new Date(Date.now() - d * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

    expect(by("division:")).toMatchObject({ newsType: "expansion", title: "New division: Dayton Exteriors", facts: ["New division: Dayton Exteriors", "Location: Dayton, OH", `Added in your CRM on ${days(10)}`] });
    expect(by("division:")!.detailsDraft).toBe(`Vitest Builders has added a new division, Dayton Exteriors, in Dayton, OH. The division was set up on ${days(10)}. Vitest Builders is based in Columbus, OH.`);

    expect(by("projects:")).toMatchObject({ key: "projects:100", newsType: "milestone", facts: ["103 projects marked complete in your CRM", `Project number 100 was completed on ${days(23)}`] });
    expect(by("jobs:")).toBeUndefined();
    expect(by("reviews:")).toMatchObject({ newsType: "milestone", title: "Passed 100 Google reviews", facts: ["120 Google reviews on your business profile", "Average rating: 4.8 out of 5", "That passes the 100-review mark"] });
    expect(by("anniversary:")).toMatchObject({ title: "10 years in business", facts: [`Founded in ${year - 10} (from your Call Assistant profile)`, `10 years in business in ${year}`] });
    expect(by("team:")).toMatchObject({ newsType: "hire", title: "New team member: Jordan Lee", facts: [`Jordan Lee, Estimator joined on ${days(5)}`] });
    expect(by("awards:")).toMatchObject({ newsType: "award", facts: ["Award: Best of Columbus 2025", "Certification: GAF Master Elite"] });
    expect(by("area:")).toBeUndefined(); // no earlier profile version to compare with

    // Every number in every starter is one of the idea's own facts (or the year of a date in them).
    for (const i of ideas) {
      const allowed = new Set([...i.facts.join(" ").matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[.,]$/, "")));
      for (const m of i.detailsDraft.matchAll(/\d[\d,.]*/g)) expect(allowed, `${i.key}: ${m[0]}`).toContain(m[0].replace(/[.,]$/, "").replace(/th$/, ""));
    }

    // At most five, and a dismissed or used idea leaves the list.
    const shown = await findIdeas(u);
    expect(shown.length).toBe(5);
    await markIdea(u, by("division:")!.key, "dismissed");
    expect((await findIdeas(u)).some((i) => i.key.startsWith("division:"))).toBe(false);
  });
});

describe("prefill", () => {
  it("takes each field from the last release, then the CRM org, then the business profile, then the profile", async () => {
    const u = await newUser({ company: "Profile Co", name: "Profile Person" });
    // Profile only.
    let p = await loadPrefill(u);
    expect(p.values).toEqual({ companyName: "Profile Co", contactName: "Profile Person", contactEmail: `${tag}-${users.length - 1}@press.test` });
    expect(p.sources.companyName).toBe("profile");

    // A business profile fills what it has; the profile keeps the rest.
    await pool.query(`INSERT INTO business_locations (user_id, business_name, city, state, phone, website, description) VALUES ($1,'Location Co','Dayton','OH','(937) 555-0100','not-a-url','From Google.')`, [u]);
    p = await loadPrefill(u);
    expect(p.values).toMatchObject({ companyName: "Location Co", city: "Dayton", contactPhone: "(937) 555-0100", about: "From Google.", contactName: "Profile Person" });
    expect(p.values.website).toBeUndefined(); // a stored value that is not a web address is left out
    expect(p.sources).toMatchObject({ companyName: "business_profile", contactName: "profile" });

    // The CRM org beats the business profile.
    const org = await newOrg(u, { name: "CRM Co", city: "Columbus", state: "OH", email: "office@crm.example", website: "https://crm.example" });
    await pool.query(`INSERT INTO crm_members (org_id, user_id, email, role, status, display_name) VALUES ($1,$2,$3,'owner','active','Crm Owner')`, [org, u, `${tag}-pf@press.test`]);
    p = await loadPrefill(u);
    expect(p.values).toMatchObject({ companyName: "CRM Co", city: "Columbus", state: "OH", website: "https://crm.example", contactEmail: "office@crm.example", contactName: "Crm Owner", contactPhone: "(937) 555-0100", about: "From Google." });
    expect(p.sources).toMatchObject({ companyName: "crm", contactPhone: "business_profile" });

    // The last release beats everything.
    const r = await store.createRelease(u, "budget", fullInput());
    p = await loadPrefill(u);
    expect(p.values).toMatchObject({ companyName: "Last Release Roofing", website: "https://last.example", contactName: "Pat Last", contactEmail: "pat@last.example", about: "Roofing since 2014." });
    expect(p.sources.companyName).toBe("last_release");
    await pool.query(`DELETE FROM press_releases WHERE id=$1`, [r.id]);
  });
});

describe("autopilot", () => {
  it("next draft date: the chosen day, the next month once drafted, and after the gap", () => {
    const now = new Date("2026-10-17T15:00:00Z");
    const o = { monthDone: false, hasCredit: true, lastSubmittedAt: null };
    expect(nextDraftOn({ enabled: false, dayOfMonth: 20 }, now, o)).toBeNull();
    expect(nextDraftOn({ enabled: true, dayOfMonth: 20 }, now, { ...o, hasCredit: false })).toBeNull();
    expect(nextDraftOn({ enabled: true, dayOfMonth: 20 }, now, o)).toBe("2026-10-20");
    expect(nextDraftOn({ enabled: true, dayOfMonth: 5 }, now, o)).toBe("2026-10-17");
    expect(nextDraftOn({ enabled: true, dayOfMonth: 5 }, now, { ...o, monthDone: true })).toBe("2026-11-05");
    expect(nextDraftOn({ enabled: true, dayOfMonth: 20 }, now, { ...o, lastSubmittedAt: new Date("2026-10-10T00:00:00Z") })).toBe("2026-11-20");
    expect(nextDraftOn({ enabled: true, dayOfMonth: 5 }, now, { ...o, lastSubmittedAt: new Date("2026-10-01T00:00:00Z") })).toBe("2026-10-29");
    expect(nextDraftOn({ enabled: true, dayOfMonth: 5 }, new Date("2026-12-20T00:00:00Z"), { ...o, monthDone: true })).toBe("2027-01-05");
  });

  async function seededAccount(): Promise<number> {
    const u = await newUser({ company: "Auto Co", name: "Auto Owner" });
    const org = await newOrg(u, { name: "Auto Co", city: "Columbus", state: "OH", email: "media@auto.example" });
    await pool.query(`INSERT INTO crm_divisions (org_id, name, code, city, state, is_headquarters, created_at) VALUES ($1,'Main','M','Columbus','OH',true, now() - interval '400 days'), ($1,'Dayton Exteriors','D','Dayton','OH',false, now() - interval '3 days')`, [org]);
    await pool.query(`INSERT INTO voice_profiles (org_id, profile) VALUES ($1,$2)`, [org, JSON.stringify({ company: { name: "Auto Co" }, credibility: { awards: ["Best of Columbus 2025"] }, serviceArea: { counties: [] } })]);
    await saveSettings(u, { enabled: true, dayOfMonth: 1 });
    return u;
  }
  const countReleases = async (u: number) => Number((await pool.query(`SELECT count(*) FROM press_releases WHERE user_id=$1`, [u])).rows[0].count);

  it("skips with no credit, drafts once a month, never past draft and never with a credit", async () => {
    const u = await seededAccount();
    const now = new Date();

    expect(await runAutopilotFor(u, now)).toEqual({ outcome: "no_credit" });
    expect(await countReleases(u)).toBe(0);

    const orderId = await paidOrder(u);
    const before = await store.creditsLeft(u);
    // Two passes at once and one after: one draft.
    const [a, b] = await Promise.all([runAutopilotFor(u, now), runAutopilotFor(u, now)]);
    const c = await runAutopilotFor(u, now);
    const outcomes = [a, b, c].map((x) => x.outcome).sort();
    expect(outcomes).toEqual(["already", "already", "drafted"]);
    expect(await countReleases(u)).toBe(1);
    const { rows: [run] } = await pool.query(`SELECT * FROM press_autopilot_runs WHERE user_id=$1 AND month=$2`, [u, monthKey(now)]);
    expect(run.outcome).toBe("drafted");

    const [row] = await store.listReleases(u);
    expect(row.status).toBe("draft");
    expect(row.order_id).toBeNull();
    expect(row.text?.headline).toBe(TEXT.headline);
    expect(row.input).toMatchObject({ companyName: "Auto Co", city: "Columbus", state: "OH", contactEmail: "media@auto.example", newsType: "expansion" });
    expect(row.input.details).toContain("Dayton Exteriors");
    expect(await store.creditsLeft(u)).toEqual(before);
    expect((await store.getOrder(orderId))!.credits_used).toBe(0);
    expect(notified).toEqual([{ userId: u, title: "Your monthly press release draft is ready", link: `/press-releases?release=${row.id}` }]);
    // The idea it used is gone from the list.
    expect((await findIdeas(u)).some((i) => i.key.startsWith("division:"))).toBe(false);

    // Next month it drafts the next idea, still without a credit.
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2, 12));
    expect((await runAutopilotFor(u, next)).outcome).toBe("drafted");
    expect(await countReleases(u)).toBe(2);
    expect((await store.listReleases(u)).every((r) => r.status === "draft" && r.order_id === null)).toBe(true);
    expect((await store.getOrder(orderId))!.credits_used).toBe(0);
  });

  it("skips when a release went out recently, when there is no idea, and before the chosen day", async () => {
    const u = await seededAccount();
    await paidOrder(u);
    const now = new Date();

    const sentOne = await store.createRelease(u, "budget", fullInput({ companyName: "Auto Co" }));
    await store.updateRelease(sentOne.id, { status: "submitted", submitted_at: new Date(Date.now() - 5 * 86_400_000) });
    expect(await runAutopilotFor(u, now)).toEqual({ outcome: "too_recent" });
    expect(await countReleases(u)).toBe(1);

    await store.updateRelease(sentOne.id, { submitted_at: new Date(Date.now() - 60 * 86_400_000) });
    for (const i of await findIdeas(u)) await markIdea(u, i.key, "dismissed");
    expect(await runAutopilotFor(u, now)).toEqual({ outcome: "no_idea" });
    expect(await countReleases(u)).toBe(1);

    await saveSettings(u, { enabled: true, dayOfMonth: 28 });
    expect(await runAutopilotFor(u, new Date(Date.UTC(2026, 9, 3)))).toEqual({ outcome: "not_due" });
    await saveSettings(u, { enabled: false, dayOfMonth: 1 });
    expect(await runAutopilotFor(u, now)).toEqual({ outcome: "off" });
    expect(notified).toEqual([]);
  });
});
