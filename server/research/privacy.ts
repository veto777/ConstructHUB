/**
 * Home addresses (audit 2026-10-15, decision 4). A license held by an individual (no business on the record) is
 * shown with its city, state and ZIP only: no street address, no phone, and neither is indexed or searched as an
 * "a:"/"t:" key, so a report never prints a person's home or ties records together through it. A business keeps
 * its full address. Applied centrally (the runner's finders and the bulk loader), whatever a source publishes.
 */
import type { LicenseHit } from "@shared/research-reports";
import { localityOf, type IdKeys } from "./identifiers";

/** True when the record names no business: an individual's license. */
export const isIndividual = (h: Pick<LicenseHit, "businessName">): boolean => !h.businessName?.trim();

/** The hit as a report may show it: an individual's street and phone removed (city, state and ZIP kept). */
export function privateHit<T extends LicenseHit>(h: T): T {
  if (!isIndividual(h) || (h.address == null && h.phone == null)) return h;
  const locality = h.address ? localityOf(h.address) : null;
  return { ...h, address: locality && locality !== h.city ? locality : null, phone: null };
}

/** An individual's identifier keys: license numbers only (no home address or phone keys). */
export function privateKeys(keys: IdKeys | undefined, individual: boolean): IdKeys | undefined {
  if (!keys || !individual) return keys;
  return keys.licenses?.length ? { licenses: keys.licenses } : undefined;
}
