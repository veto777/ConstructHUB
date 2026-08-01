/**
 * Financing links — the lender/partner URLs a contractor offers clients
 * ("Finance this project →"). Stored on the org at
 * custom_fields->financingLinks: up to 10 { label, url, primary } entries,
 * exactly one of them primary.
 *
 * The PRIMARY link is what clients see: on the public estimate and invoice
 * pages (rendered by payments.ts' pay-info endpoints) and in the client
 * portal's documents payload — portal code calls getPrimaryFinancing(org)
 * from here so the resolution rule lives in exactly one place.
 *
 * Kept separate from payments.ts so the client-portal agent can import the
 * helper without touching (or conflicting on) the payments route file.
 */
import { z } from "zod";
import type { CrmOrg } from "@shared/schema";

export type FinancingLink = {
  label: string;
  url: string;
  primary?: boolean;
};

export const FINANCING_LINKS_MAX = 10;

/** http(s) only — these render as client-facing links; javascript: must never save. */
export const financingLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().max(1000).refine((u) => /^https?:\/\//i.test(u), {
    message: "Financing links must start with http:// or https://",
  }),
  primary: z.boolean().optional(),
});

export const financingLinksSchema = z.array(financingLinkSchema).max(FINANCING_LINKS_MAX);

/** The org's financing links, normalised: at most one primary, first link wins ties. */
export function financingLinksOf(org: Pick<CrmOrg, "customFields"> | null | undefined): FinancingLink[] {
  const raw = (org?.customFields as Record<string, unknown> | null | undefined)?.financingLinks;
  if (!Array.isArray(raw)) return [];
  const links: FinancingLink[] = [];
  let primarySeen = false;
  for (const item of raw.slice(0, FINANCING_LINKS_MAX)) {
    const parsed = financingLinkSchema.safeParse(item);
    if (!parsed.success) continue;
    const primary = parsed.data.primary === true && !primarySeen;
    if (primary) primarySeen = true;
    links.push({ label: parsed.data.label, url: parsed.data.url, primary });
  }
  return links;
}

/**
 * The link shown to clients: the one marked primary, else the first. This is
 * the function the client portal's documents endpoint should call.
 */
export function getPrimaryFinancing(
  org: Pick<CrmOrg, "customFields"> | null | undefined,
): { label: string; url: string } | null {
  const links = financingLinksOf(org);
  if (!links.length) return null;
  const primary = links.find((l) => l.primary) ?? links[0];
  return { label: primary.label, url: primary.url };
}
