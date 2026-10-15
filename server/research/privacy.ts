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
 *     keeps only words of standing (round 3, decision 1; standingStatus below):
 *     probation, "disciplined", citations, a pending case and the like come off the status and go to `discipline`,
 *     which an individual's record never shows.
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
const STANDING = "active|inactive|current|clear|expired|delinquent|null and void|revoked|suspended|surrendered|valid|issued|licensed|lapsed|cancell?ed|retired|closed|deceased|void|renewed|(?:in )?good standing";
const STANDING_RE = new RegExp(`^(${STANDING})\\b(.*)$`, "i");
/** Words that make a status piece disciplinary (or about a case) rather than standing. */
const DISCIPLINARY = /probation|disciplin|citation|\bcited\b|pending|\bcase\b|complaint|reprimand|censure|\bfined?\b|consent|\border\b|restrict|condition|monitor|stipulat|sanction|violation|investigat|hearing|summary|emergency|warning|admonish|letter of concern|corrective|action/i;

/**
 * An individual's license status split into standing words (kept, as published) and everything else (moved to
 * `discipline`): "Probation, Active" → "Active" + "Probation"; "Active - Pending Case" → "Active" + "Pending Case";
 * "Disciplined" → null + "Disciplined"; "Inactive per Request" stays. A piece that is neither (an unlisted word) moves
 * too: only standing words are left on an individual's status.
 */
export function standingStatus(status: string | null | undefined): { status: string | null; moved: string | null } {
  const t = (status ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { status: null, moved: null };
  // An applicant list's own wording ("Applicant: an application is on file … (not a license)") is not a license status.
  if (/^applicant\b/i.test(t)) return { status: t, moved: null };
  const keep: string[] = [], moved: string[] = [];
  for (const raw of t.split(/\s*[,;|/]\s*|\s+-\s+|\s*\(\s*|\s*\)\s*/)) {
    const piece = raw.trim();
    if (!piece) continue;
    const m = piece.match(STANDING_RE);
    if (!m) { moved.push(piece); continue; }
    const rest = m[2].trim();
    if (rest && DISCIPLINARY.test(rest)) { keep.push(m[1]); moved.push(rest.replace(/^(?:with|on|under|and|-|:)\s+/i, "")); }
    else keep.push(piece);
  }
  return { status: keep.length ? Array.from(new Set(keep)).join(", ") : null, moved: moved.length ? moved.join("; ") : null };
}

/** True unless the publisher says a business holds the license (null, unknown, counts as an individual). */
export const isIndividual = (h: Pick<LicenseHit, "holder">): boolean => h.holder !== "business";

/**
 * The hit with an individual's or unknown holder's street and phone removed (city, state and ZIP kept), and its
 * status reduced to standing words, the rest moved to `discipline` (round 3, decision 1).
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
 * an identifier and whatever its holder, shows standing words only ("Probation, Active" → "Active").
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
