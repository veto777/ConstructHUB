/**
 * research_orders: one row per research report order. Plain SQL on the shared pool (like server/billing), created
 * idempotently at boot. The input is stored exactly as validated by shared/research-reports.ts researchOrderSchema;
 * the price and tier are the server's, never the client's.
 */
import { pool } from "../db";
import { reportHit } from "./privacy";
import { ALL_BULK_SOURCES } from "./registry";
import { WITHDRAWN_REPORT_SOURCES } from "./bulk";
import { localityOf } from "./identifiers";
import { licenseRef } from "./xref";
import { looksLikeBusiness, personNameForm } from "./states/lib/business-name";
import { REPORT_SNAPSHOT_VERSION } from "@shared/research-reports";
import type {
  ComplaintHit, EnforcementHit, LicenseHit, ResearchOrderInput, ResearchOrderView, ResearchPreview, ResearchReport, ResearchStatus, ResearchSubjectReport, ResearchTier,
} from "@shared/research-reports";

const DDL = `
CREATE TABLE IF NOT EXISTS research_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment',
  tier text NOT NULL,
  price_cents integer NOT NULL,
  input jsonb NOT NULL,
  preview jsonb,
  report jsonb,
  error text,
  agreed_at timestamptz NOT NULL,
  agreed_terms text NOT NULL,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS research_orders_session_uq ON research_orders (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS research_orders_user_idx ON research_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_orders_status_idx ON research_orders (status);
`;

let ready: Promise<void> | null = null;
export function researchSchemaReady(): Promise<void> {
  ready ??= pool.query(DDL).then(() => undefined).catch((err) => { ready = null; throw err; });
  return ready;
}

export type ResearchOrderRow = {
  id: number; user_id: number; email: string; status: ResearchStatus; tier: ResearchTier; price_cents: number;
  input: ResearchOrderInput; preview: ResearchPreview | null; report: ResearchReport | null; error: string | null;
  stripe_session_id: string | null; created_at: Date; paid_at: Date | null; started_at: Date | null; completed_at: Date | null;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** Bulk sources whose old rows' holders can be recomputed from the stored fields, by the source name a hit carries. */
let legacyHolders: Map<string, NonNullable<(typeof ALL_BULK_SOURCES)[number]["legacyHolder"]>> | null = null;

/**
 * A license from a report saved before REPORT_SNAPSHOT_VERSION 2 (A10, decision 5): a "business" holder it can't verify
 * by today's rules is unknown (city, state and ZIP only, no phone). The holder is recomputed where the hit's source
 * can do that from the fields it kept (CSLB's "Contractor license (Sole Owner)", VA's license type); an individual
 * stays one.
 */
export function legacyReportHolder(h: LicenseHit): LicenseHit {
  if (h.holder !== "business") return h;
  legacyHolders ??= new Map(ALL_BULK_SOURCES.filter((s) => s.legacyHolder).map((s) => [s.label, s.legacyHolder!]));
  const recompute = legacyHolders.get(h.source);
  return { ...h, holder: recompute ? recompute(h) ?? null : null };
}

/** Bulk sources' current rule on who an enforcement record is about, by the source name a hit carries. */
let legacySubjects: Map<string, NonNullable<(typeof ALL_BULK_SOURCES)[number]["legacyEnforcement"]>> | null = null;

/** City, state and ZIP of a stored address, or null (an unverifiable street or phone is absent; round 6, decision 4). */
const localityOnly = (address: string | null | undefined, city: string | null): string | null => {
  const l = address ? localityOf(address) : null;
  return l && l !== city ? l : null;
};

/**
 * An enforcement record from a report saved before REPORT_SNAPSHOT_VERSION 3 (round 6, decision 4): its subject is
 * checked again by today's rule (the bulk source's own, else: a name with a personal form, or with no business sign,
 * is dropped), and its street and phone, which no rule of the time verified, are cut to the locality.
 */
export function legacyReportEnforcement(h: EnforcementHit): EnforcementHit | null {
  legacySubjects ??= new Map(ALL_BULK_SOURCES.filter((s) => s.legacyEnforcement).map((s) => [s.label, s.legacyEnforcement!]));
  const rule = legacySubjects.get(h.source);
  const names = (h.name ?? "").split(/\s+\/\s+|;/).map((n) => n.trim()).filter(Boolean);
  const kept = rule ? rule(h, 0) : names.some((n) => personNameForm(n) === null && looksLikeBusiness(n)) ? h : null;
  if (!kept) return null;
  return { ...kept, address: localityOnly(kept.address, kept.city), phone: null };
}

/** The same for an older report's consumer complaint: the business address it named is cut to the locality. */
const legacyComplaint = (c: ComplaintHit): ComplaintHit => (c.address ? { ...c, address: localityOnly(c.address, c.city) } : c);

/** A phone or address as compared in relationship prose: digits of a phone, letters and digits of an address. */
const contactKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** Where the next tie in relationship prose starts ("; " then one of the forms xref.ts writes). */
const NEXT_TIE = /; (?=(?:possible match \(address\): )?(?:same (?:phone|address) as |lists the same license number as |matched by the |held by |a record of )|[^;]*? is named on both )/;

/** One of the subject's own records as relationship prose names it (xref.ts licenseRef), with the contacts the report shows on it. */
export type ShownRef = { ref: string; shown: Set<string> };

/**
 * Relationship prose as shown (round 6, decision 4; round 7, finding 2). "same phone as license 123, (813) 555-0100" and
 * "same address as license EC 03136, 123 Main St, Omaha NE" name a phone or street of one of the subject's own records.
 * The explanation is rebuilt from those records: the reference must be one of them, written in full (`refs`, from
 * licenseRef, so a license number with spaces is read whole), and the value is kept only when the report shows it on
 * that record and the subject is not a person. Otherwise the value is left out ("same address as license EC 03136"),
 * and when the reference can't be read safely the explanation names no record or value ("same address as another of
 * the subject's records"). Ties inside an enforcement record's explanation ("a record of X, which is tied to this
 * name: same phone as …") are read the same way. What the customer gave ("matched by the phone you gave (…)") is the
 * customer's own and stays.
 */
export function shownVia(via: string | null | undefined, refs: ShownRef[], person: boolean): string | null | undefined {
  if (!via) return via;
  const byLength = [...refs].sort((a, b) => b.ref.length - a.ref.length);
  const tie = /same (phone|address) as /g;
  let out = "", at = 0;
  for (let m = tie.exec(via); m; m = tie.exec(via)) {
    const from = m.index + m[0].length;
    out += via.slice(at, from);
    const next = via.slice(from).search(NEXT_TIE);
    const end = next < 0 ? via.length : from + next;
    const rest = via.slice(from, end);
    const own = byLength.find((r) => rest === r.ref || rest.startsWith(`${r.ref}, `));
    if (own) {
      const value = rest.slice(own.ref.length + 2);
      out += value && !person && own.shown.has(contactKey(value)) ? rest : own.ref;
    } else {
      // No ", " → no value to leave out; anything else can't be split into record and value safely.
      out += rest.includes(", ") ? "another of the subject's records" : rest;
    }
    at = end;
    tie.lastIndex = end;
  }
  return out + via.slice(at);
}

/** A phone or street in the cross-reference's notes ("address 123 Main St (on license 1) is shared by…"), left out. */
export const scrubNote = (n: string): string =>
  n.replace(/\bphone \(\d{3}\) \d{3}-\d{4}/g, "a phone").replace(/\baddress .+?(?= \(on | is shared| was not searched|: | in )/g, "an address");

/** Totals of a report, counted from its subjects as shown (A10, decision 9; the same counts the runner makes). */
export function reportTotals(subjects: ResearchSubjectReport[]): ResearchReport["totals"] {
  const sum = (f: (s: ResearchSubjectReport) => number) => subjects.reduce((n, s) => n + f(s), 0);
  const portals = subjects.flatMap((s) => s.portals);
  return {
    licenses: sum((s) => s.licenses.length),
    permits: sum((s) => s.permits.length),
    portalsSearched: portals.filter((c) => c.outcome === "searched").length,
    portalsNotSearched: portals.filter((c) => c.outcome !== "searched").length,
    complaints: sum((s) => s.complaints?.length ?? 0),
    courtCases: sum((s) => s.courtCases?.length ?? 0),
    osha: sum((s) => s.osha?.length ?? 0),
    enforcement: sum((s) => s.enforcement?.length ?? 0),
    related: sum((s) => (s.relatedLicenses?.length ?? 0) + (s.relatedEnforcement?.length ?? 0)),
  };
}

/** The line a saved report shows when shownReport left out a withdrawn source's records. */
export const WITHDRAWN_NOTE = "A source was withdrawn after this report was made, so its records are no longer shown here.";

/** What a person's report says about company-only records (the runner's own line for a person). */
const PERSON_RECORD_SOURCES: NonNullable<ResearchSubjectReport["recordSources"]> = [{ source: "Complaints, lawsuits, enforcement and OSHA records", scope: "", searched: false, note: "Searched for companies only, not for individual people" }];

/**
 * A stored report as shown today (round 4, decision 2; A10, decisions 5 and 9; round 6, decision 4): license statuses
 * follow the report subject and holder under the current rules; a report saved before snapshot version 2 has its
 * unverifiable business holders treated as unknown, and one saved before version 3 its enforcement records checked
 * again (legacyReportEnforcement) and its consumer complaints' addresses cut to the locality; relationship prose names
 * only a phone or street the report shows (never for a person); a person's report carries no enforcement, complaint,
 * court or OSHA records and says those are searched for companies only; and the totals are counted again from what
 * is shown.
 */
export function shownReport(r: ResearchReport | null): ResearchReport | null {
  if (!r) return r;
  const version = r.snapshotVersion ?? 1;
  // Before version 2 holders are recomputed (A10, decision 5); before version 3 enforcement subjects and contacts too
  // (round 6, decision 4).
  const legacyHolders = version < 2, legacyContacts = version < 3, legacyRules = version < 4;
  const show = (h: LicenseHit, kind: "person" | "company") => reportHit(legacyHolders ? legacyReportHolder(h) : h, kind);
  // Before version 4 each enforcement record is checked again by its source's current rule (round 8, finding 1: an SD
  // lien whose owner was a business only by "Brothers" is a person's and is dropped).
  legacySubjects ??= new Map(ALL_BULK_SOURCES.filter((s) => s.legacyEnforcement).map((s) => [s.label, s.legacyEnforcement!]));
  const recheck = (h: EnforcementHit): EnforcementHit | null => { const rule = legacySubjects!.get(h.source); return rule ? rule(h, 0) : h; };
  const enforcement = (list: EnforcementHit[] | undefined) => list && (legacyContacts ? list.map(legacyReportEnforcement).filter((e): e is EnforcementHit => !!e)
    : legacyRules ? list.map(recheck).filter((e): e is EnforcementHit => !!e) : list);
  const subjects = r.subjects.map((raw): ResearchSubjectReport => {
    // Records and source lines of a source withdrawn after the report was made are not shown (round 8, finding 4).
    let withdrawn = false;
    const keep = <T extends { source: string }>(list: T[] | undefined): T[] | undefined => {
      if (!list) return list;
      const kept = list.filter((x) => !WITHDRAWN_REPORT_SOURCES.has(x.source));
      if (kept.length !== list.length) withdrawn = true;
      return kept;
    };
    const s: ResearchSubjectReport = {
      ...raw, licenses: keep(raw.licenses)!, licenseSources: keep(raw.licenseSources)!,
      ...(raw.relatedLicenses ? { relatedLicenses: keep(raw.relatedLicenses) } : {}),
      ...(raw.enforcement ? { enforcement: keep(raw.enforcement) } : {}),
      ...(raw.relatedEnforcement ? { relatedEnforcement: keep(raw.relatedEnforcement) } : {}),
      ...(raw.recordSources ? { recordSources: keep(raw.recordSources) } : {}),
    };
    if (withdrawn) s.withdrawnNote = WITHDRAWN_NOTE;
    const person = s.kind === "person";
    const licenses = s.licenses.map((h) => show(h, s.kind));
    // Each of the subject's own records as relationship prose names it, with the phone and street the report shows on
    // it: the only values the prose may name (round 7, finding 2).
    const refs: ShownRef[] = s.licenses.map((h, i) => ({ ref: licenseRef(h), shown: new Set([licenses[i].phone, licenses[i].address].filter((v): v is string => !!v).map(contactKey)) }));
    const via = <T extends { relatedVia?: string | null }>(h: T): T => (h.relatedVia ? { ...h, relatedVia: shownVia(h.relatedVia, refs, person) } : h);
    const out: ResearchSubjectReport = {
      ...s,
      licenses: licenses.map(via),
      ...(s.relatedLicenses ? { relatedLicenses: s.relatedLicenses.map((h) => via(show(h, s.kind))) } : {}),
      ...(s.relatedNotes && (person || legacyContacts) ? { relatedNotes: s.relatedNotes.map(scrubNote) } : {}),
    };
    if (person) return {
      ...out, complaints: [], courtCases: [], osha: [], enforcement: [], ...(s.relatedEnforcement ? { relatedEnforcement: [] } : {}),
      ...(s.recordSources ? { recordSources: PERSON_RECORD_SOURCES } : {}),
    };
    return {
      ...out,
      ...(s.enforcement ? { enforcement: enforcement(s.enforcement)!.map(via) } : {}),
      ...(s.relatedEnforcement ? { relatedEnforcement: enforcement(s.relatedEnforcement)!.map(via) } : {}),
      ...(s.complaints && legacyContacts ? { complaints: s.complaints.map(legacyComplaint) } : {}),
    };
  });
  const t = reportTotals(subjects);
  // A total the stored report didn't carry (older reports) stays absent, so the page doesn't claim a search.
  const totals = Object.fromEntries(Object.entries(t).filter(([k]) => k in r.totals || ["licenses", "permits", "portalsSearched", "portalsNotSearched"].includes(k))) as ResearchReport["totals"];
  return { ...r, subjects, totals };
}

export function orderView(row: ResearchOrderRow): ResearchOrderView {
  const { agreeNonRefundable: _a, agreeNoGuarantee: _b, agreeNotFcra: _c, ...input } = row.input;
  return {
    id: row.id, status: row.status, tier: row.tier, priceCents: row.price_cents, input,
    preview: row.preview, report: row.status === "complete" ? shownReport(row.report) : null, error: row.status === "failed" ? row.error : null,
    createdAt: iso(row.created_at)!, paidAt: iso(row.paid_at), completedAt: iso(row.completed_at),
  };
}

export async function createOrder(o: {
  userId: number; email: string; tier: ResearchTier; priceCents: number; input: ResearchOrderInput; preview: ResearchPreview | null; terms: string;
}): Promise<ResearchOrderRow> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `INSERT INTO research_orders (user_id, email, tier, price_cents, input, preview, agreed_at, agreed_terms)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING *`,
    [o.userId, o.email, o.tier, o.priceCents, JSON.stringify(o.input), o.preview ? JSON.stringify(o.preview) : null, o.terms],
  );
  return rows[0];
}

export async function getOrder(id: number): Promise<ResearchOrderRow | null> {
  await researchSchemaReady();
  const { rows } = await pool.query(`SELECT * FROM research_orders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listOrders(userId: number | null, limit = 50): Promise<ResearchOrderRow[]> {
  await researchSchemaReady();
  const { rows } = userId == null
    ? await pool.query(`SELECT * FROM research_orders ORDER BY created_at DESC LIMIT $1`, [limit])
    : await pool.query(`SELECT * FROM research_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return rows;
}

export async function setCheckoutSession(id: number, sessionId: string): Promise<void> {
  await pool.query(`UPDATE research_orders SET stripe_session_id = $2 WHERE id = $1 AND status = 'awaiting_payment'`, [id, sessionId]);
}

/** Paid, once: true only for the call that moved it out of awaiting_payment. */
export async function markPaid(id: number, userId: number, sessionId: string): Promise<boolean> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `UPDATE research_orders SET status = 'paid', paid_at = now(), stripe_session_id = $3
     WHERE id = $1 AND user_id = $2 AND status = 'awaiting_payment' RETURNING id`,
    [id, userId, sessionId],
  );
  return rows.length > 0;
}

/** The next paid order to research (oldest first), claimed atomically. */
export async function claimNext(): Promise<ResearchOrderRow | null> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `UPDATE research_orders SET status = 'researching', started_at = now()
     WHERE id = (SELECT id FROM research_orders WHERE status = 'paid' ORDER BY paid_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return rows[0] ?? null;
}

/** At boot: an order cut off mid-research (a restart) goes back to the queue. */
export async function requeueInterrupted(): Promise<number> {
  await researchSchemaReady();
  const { rowCount } = await pool.query(`UPDATE research_orders SET status = 'paid' WHERE status = 'researching'`);
  return rowCount ?? 0;
}

export async function finishOrder(id: number, report: ResearchReport): Promise<void> {
  // Saved with the version of the rules it was made under (A10, decision 5).
  await pool.query(`UPDATE research_orders SET status = 'complete', report = $2, completed_at = now(), error = NULL WHERE id = $1`, [id, JSON.stringify({ ...report, snapshotVersion: REPORT_SNAPSHOT_VERSION })]);
}

export async function failOrder(id: number, error: string): Promise<void> {
  await pool.query(`UPDATE research_orders SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`, [id, error.slice(0, 2000)]);
}

/** Admin: put a failed order back in the queue. */
export async function retryOrder(id: number): Promise<boolean> {
  const { rows } = await pool.query(`UPDATE research_orders SET status = 'paid', error = NULL WHERE id = $1 AND status = 'failed' RETURNING id`, [id]);
  return rows.length > 0;
}
