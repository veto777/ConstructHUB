/**
 * Estimate & invoice defaults (Settings → Estimate & invoice defaults) as a
 * per-document SNAPSHOT.
 *
 * A new estimate copies the org's estimate footer, warranty text, company
 * terms, default deposit percent and bid headline (shared/bid-headline.ts)
 * onto itself; a new invoice copies the
 * invoice footer, warranty text and terms. The client's page and the signed
 * contract print the document's own copy, so editing Settings later changes
 * only documents created after the save — never one already in a client's
 * hands.
 *
 * `defaultsSnapshotAt` marks a document that carries a snapshot. A document
 * from before snapshots existed (null) keeps printing the live Settings value,
 * as it always did; schema-ensure backfills the snapshot onto unsent drafts
 * only, never onto a sent, viewed or signed document.
 */

import { bidHeadlineFromCustomFields } from "@shared/bid-headline";

type OrgDefaults = {
  estimateFooter?: string | null;
  invoiceFooter?: string | null;
  termsAndConditions?: string | null;
  warrantyText?: string | null;
  defaultDepositBps?: number | null;
  customFields?: unknown;
};

const text = (v: string | null | undefined) => (v && v.trim() ? v : null);

/** The columns a new estimate gets from the org. depositBps is null when the org has no default deposit. */
export function estimateDefaultsFromOrg(org: OrgDefaults, now: Date = new Date()) {
  const bps = org.defaultDepositBps ?? 0;
  return {
    footerText: text(org.estimateFooter),
    warrantyText: text(org.warrantyText),
    companyTermsText: text(org.termsAndConditions),
    depositBps: bps > 0 ? Math.min(10000, bps) : null,
    // The headline is never read live: only estimates created while it is set carry it.
    bidHeadline: bidHeadlineFromCustomFields(org.customFields),
    defaultsSnapshotAt: now,
  };
}

/** The columns a new invoice gets. An invoice billed from an estimate keeps
 *  the warranty and terms the client signed on that estimate. */
export function invoiceDefaultsFromOrg(
  org: OrgDefaults,
  fromEstimate?: EstimateSnapshot | null,
  now: Date = new Date(),
) {
  const signed = fromEstimate ? estimateDocText(fromEstimate, org) : null;
  return {
    footerText: text(org.invoiceFooter),
    warrantyText: signed ? signed.warrantyText : text(org.warrantyText),
    termsText: signed ? signed.companyTermsText : text(org.termsAndConditions),
    defaultsSnapshotAt: now,
  };
}

type EstimateSnapshot = {
  defaultsSnapshotAt?: Date | null;
  footerText?: string | null;
  warrantyText?: string | null;
  companyTermsText?: string | null;
};
type InvoiceSnapshot = {
  defaultsSnapshotAt?: Date | null;
  footerText?: string | null;
  warrantyText?: string | null;
  termsText?: string | null;
};

/** What an estimate prints: its own snapshot, or (pre-snapshot documents) live Settings. */
export function estimateDocText(est: EstimateSnapshot, org: OrgDefaults) {
  if (est.defaultsSnapshotAt) {
    return {
      footerText: est.footerText ?? null,
      warrantyText: est.warrantyText ?? null,
      companyTermsText: est.companyTermsText ?? null,
    };
  }
  return {
    footerText: text(org.estimateFooter),
    warrantyText: text(org.warrantyText),
    companyTermsText: text(org.termsAndConditions),
  };
}

/** What an invoice prints: its own snapshot, or (pre-snapshot documents) live Settings. */
export function invoiceDocText(inv: InvoiceSnapshot, org: OrgDefaults) {
  if (inv.defaultsSnapshotAt) {
    return {
      footerText: inv.footerText ?? null,
      warrantyText: inv.warrantyText ?? null,
      termsText: inv.termsText ?? null,
    };
  }
  return {
    footerText: text(org.invoiceFooter),
    warrantyText: text(org.warrantyText),
    termsText: text(org.termsAndConditions),
  };
}

/** A percent deposit in cents of a total — rounded once, never above the total. */
export function depositFromBps(totalCents: number, bps: number | null | undefined): number | null {
  if (bps == null) return null;
  return Math.min(totalCents, Math.max(0, Math.round((totalCents * bps) / 10000)));
}
