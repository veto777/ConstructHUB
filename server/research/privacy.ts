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
 *
 * Applied centrally (the runner's finders and the bulk loader), whatever a source publishes.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { localityOf, type IdKeys } from "./identifiers";

/** True unless the publisher says a business holds the license (null, unknown, counts as an individual). */
export const isIndividual = (h: Pick<LicenseHit, "holder">): boolean => h.holder !== "business";

/** The hit with an individual's or unknown holder's street and phone removed (city, state and ZIP kept). */
export function privateHit<T extends LicenseHit>(h: T): T {
  if (!isIndividual(h) || (h.address == null && h.phone == null)) return h;
  const locality = h.address ? localityOf(h.address) : null;
  return { ...h, address: locality && locality !== h.city ? locality : null, phone: null };
}

/** The hit as a report shows it: private (above) and without disciplinary text (see disciplineRecord). */
export function reportHit<T extends LicenseHit>(h: T): T {
  const p = privateHit(h);
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
