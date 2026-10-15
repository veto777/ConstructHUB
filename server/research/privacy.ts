/**
 * Privacy of license holders (audit 2026-10-15, decision 4; round 2, decisions 1 and 2).
 *
 *   - Contact details follow the license HOLDER, not the presence of a business name. Each source sets `holder`
 *     from what the publisher says (license class, entity type, an individual credential such as a journeyman or a
 *     qualifier card). Only a business holder keeps its street address and phone; an individual's record, or one
 *     whose holder the publisher doesn't state, is shown with city, state and ZIP only, and neither its street nor
 *     its phone is indexed or searched as an "a:"/"t:" key, even when an employer, DBA or trade name is attached.
 *   - No disciplinary text on a license: `discipline` (and anything a source still put there) is removed from every
 *     hit. For a business's license it becomes an enforcement record (companies only, FCRA); for an individual's it
 *     is dropped.
 *   - An individual's license status, and every license status in a person's report (round 4, decision 2; reportHit),
 *     is shown only when it is a complete recognized standing expression (round 7, finding 3; standingStatus below);
 *     any other status (probation, "disciplined", citations, a pending case, a condition) is null and goes to
 *     `discipline`, which an individual's record never shows.
 *   - The holder comes only from what the publisher says (round 3, decision 3; entityHolder below): a value on the
 *     source's documented business list or individual list, anything else unknown. A name that reads like a company
 *     never makes a holder a business, so it never unlocks a street address or phone.
 *
 * Applied centrally (the runner's finders, the bulk loader and every bulk read), whatever a source publishes.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { localityOf, type IdKeys } from "./identifiers";

/**
 * A publisher's entity type or license class as a holder (round 3, decision 3): a value on the documented business
 * list → "business", on the individual list → "individual"; blank or anything else (an unlisted code, a value the
 * publisher added later) → null, which is treated as an individual's.
 */
export function entityHolder(v: unknown, lists: { business: RegExp; individual: RegExp }): "business" | "individual" | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (lists.individual.test(t)) return "individual";
  return lists.business.test(t) ? "business" : null;
}

/** Words of standing a license status may keep for an individual, as published (round 3, decision 1). */
const STANDING = "active|inactive|current|clear|expired|delinquent|null and void|revoked|suspended|surrendered|valid|issued|licensed|registered|lapsed|cancell?ed|retired|closed|deceased|void|renewed|(?:in )?good standing";

/** The one applicant wording a source writes for itself (FL DBPR applicants, bulk-sources.ts): kept as it is. */
export const APPLICANT_STATUS = "Applicant: an application is on file with DBPR (not a license)";
/** A date as publishers print one ("2026-10-15", "10/15/2026", "Oct 15, 2026"). */
const DATE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[a-z]{3,9}\.? \d{1,2},? \d{4})`;
/** A supported date after a standing: on, as of, since, effective, through, until or an expiry, then the date. */
const DATE_TAIL = String.raw`(?:(?:on|as of|since|effective|eff\.?|through|thru|until|expires?|exp\.?)\s+)?${DATE}`;

/**
 * Complete standing expressions (round 7, finding 3): a standing word or phrase alone, "Listed as active/licensed",
 * "Valid & In Good Standing" or a voluntary surrender, each optionally followed by a supported date; and the roster
 * listings our packs write ("On the board's roster of 2026-07-10", "Listed in the … directory of 2026-08-17"). The whole piece must be one of these; a
 * standing followed by anything else ("Active - contingent upon board approval", "Active with civil penalty") is not.
 */
const STANDING_EXPR = new RegExp(String.raw`^(?:(?:${STANDING}|active in renewal|not expired|listed as (?:active|licensed)|valid (?:&|and) in good standing|voluntar(?:y|ily) (?:surrender(?:ed)?|termination|terminated))(?:\s+${DATE_TAIL})?|on the board's roster of ${DATE}|listed in the [^;]{1,100} directory of ${DATE})$`, "i");

/**
 * Pieces that say nothing about the license's standing and are left out: the source attributions our own packs write
 * ("on the Secretary of State's list of active entities", "on DPOR's regulant list", "current-license report of
 * 2026-04-06", "as of 2024-10-25", "the layer's last update") and a publisher's one-letter status code ("C - Current").
 */
const ATTRIBUTION = new RegExp(String.raw`^(?:on (?:the |DPOR's )[^;]*\blist\b[^;]*|current-license report of ${DATE}|as of ${DATE}|the layer's last update|[A-Z])$`);

/**
 * A license status as a standing (round 3, decision 1; round 7, finding 3): kept only when every piece of it is a
 * complete recognized standing expression ("Active", "Expired 2024-05-01", "Current, Inactive") or an attribution
 * (above), and shown as published apart from the attributions. Anything else (a qualification, a condition, a
 * negation, discipline or wording we don't recognize: "Active - contingent upon board approval", "Probation, Active",
 * "Active with civil penalty of $500") gives no standing at all: null, which reads "Status not stated", and the whole
 * status moves to `discipline`, which a report never shows. Recognizing whole expressions replaces round 6's list of
 * conditional words, which any new wording got past.
 */
export function standingStatus(status: string | null | undefined): { status: string | null; moved: string | null } {
  const t = (status ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { status: null, moved: null };
  if (t === APPLICANT_STATUS) return { status: t, moved: null };
  const keep: string[] = [];
  const body = t.replace(/^license status:\s*/i, "");
  for (const raw of body.split(/\s*[;|]\s*|,\s*(?![^()]*\))|\s+-\s+|\s*\(\s*|\s*\)\s*/)) {
    const piece = raw.trim();
    if (!piece || ATTRIBUTION.test(piece)) continue;
    if (!STANDING_EXPR.test(piece)) return { status: null, moved: t };
    keep.push(piece);
  }
  if (!keep.length) return { status: null, moved: t };
  const shown = Array.from(new Set(keep)).join(", ");
  return { status: shown, moved: null };
}

/** True unless the publisher says a business holds the license (null, unknown, counts as an individual). */
export const isIndividual = (h: Pick<LicenseHit, "holder">): boolean => h.holder !== "business";

/**
 * The hit with an individual's or unknown holder's street and phone removed (city, state and ZIP kept), and its
 * status shown only as a recognized standing, else null with the status moved to `discipline` (standingStatus).
 */
export function privateHit<T extends LicenseHit>(h: T): T {
  if (!isIndividual(h)) return h;
  let out = h;
  if (h.address != null || h.phone != null) {
    const locality = h.address ? localityOf(h.address) : null;
    out = { ...out, address: locality && locality !== h.city ? locality : null, phone: null };
  }
  const st = standingStatus(h.status);
  if (st.status !== (h.status ?? null) || st.moved) {
    const discipline = [h.discipline, st.moved].filter(Boolean).join("; ") || null;
    out = { ...out, status: st.status, ...(discipline ? { discipline } : {}) };
  }
  return out;
}

/**
 * The hit as a report shows it: private (above) and without disciplinary text (see disciplineRecord). The status
 * follows the REPORT SUBJECT too (round 4, decision 2): in a person's report every license, own, related or matched by
 * an identifier and whatever its holder, shows a recognized standing only ("Probation, Active" → null).
 */
export function reportHit<T extends LicenseHit>(h: T, subject: "person" | "company"): T {
  let p = privateHit(h);
  if (subject === "person" && !isIndividual(p)) {
    const st = standingStatus(p.status);
    if (st.status !== (p.status ?? null)) p = { ...p, status: st.status };
  }
  if (p.discipline === undefined) return p;
  const { discipline: _d, ...rest } = p;
  return rest as T;
}

/** An individual's identifier keys: license numbers only (no home address or phone keys). */
export function privateKeys(keys: IdKeys | undefined, individual: boolean): IdKeys | undefined {
  if (!keys || !individual) return keys;
  return keys.licenses?.length ? { licenses: keys.licenses } : undefined;
}

/**
 * The enforcement record a business's license discipline becomes (null for an individual's license, or none).
 * `adverse` stays null: the text is the publisher's history, not one outcome.
 */
export function disciplineRecord(h: LicenseHit): EnforcementHit | null {
  const text = h.discipline?.replace(/\s+/g, " ").trim();
  if (!text || h.holder !== "business") return null;
  return {
    state: h.state, source: h.source, sourceUrl: h.sourceUrl, category: "discipline",
    name: h.businessName, id: h.licenseNumber, date: null, endDate: null, status: null, city: h.city,
    detail: `Disciplinary information published on license ${h.licenseNumber ?? "(no number)"}: ${text}`.slice(0, 1000),
    amount: null, adverse: null, licenseNumber: h.licenseNumber,
    ...(h.relatedVia ? { relatedVia: h.relatedVia, relatedTie: h.relatedTie } : {}),
    ...(h.byYourIdentifier ? { byYourIdentifier: true } : {}),
  };
}
