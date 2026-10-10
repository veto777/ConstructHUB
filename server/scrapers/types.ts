/**
 * Portal adapter contract for permit search + permit alerts.
 *
 * Every portal adapter under server/scrapers/<platform>.ts implements
 * `PortalAdapter` and registers itself in server/scrapers/registry.ts. The
 * alerts poller (server/permits/poller.ts) only ever talks to this interface.
 *
 * Rules (see CLAUDE.md):
 *  - Never fabricate government data. Unknown field → null, never a guess.
 *  - Politeness: honor `ctx.politeness.minDelayMs` between requests to one host,
 *    send an honest user agent, back off on 403/429, never bypass a CAPTCHA.
 *  - `listRecent` must return [] (and declare `capabilities.listRecent = false`)
 *    when the portal cannot list permits by date. Do not emulate it by
 *    brute-force searching.
 */
import type { BrowserContext } from "playwright-core";

export type PermitSearchType = "address" | "permit" | "name" | "company" | "license" | "keyword";

export type PermitRecord = {
  permitNumber: string;
  jurisdiction: string;
  databaseId: number;
  address?: string | null;
  parcel?: string | null;
  lat?: number | null;
  lng?: number | null;
  permitType?: string | null;
  workClass?: string | null;
  description?: string | null;
  status?: string | null;
  /** ISO 8601 date or datetime, as reported by the portal. */
  issuedAt?: string | null;
  appliedAt?: string | null;
  expiresAt?: string | null;
  valuation?: number | null;
  contractorName?: string | null;
  contractorLicense?: string | null;
  applicantName?: string | null;
  ownerName?: string | null;
  sourceUrl?: string | null;
  raw?: Record<string, unknown> | null;
};

export type AdapterCapabilities = {
  search: PermitSearchType[];
  /** True only when `listRecent` really lists permits by issue/application date. */
  listRecent: boolean;
  detail: boolean;
};

export type AdapterCtx = {
  databaseId: number;
  databaseName: string;
  jurisdiction: string;
  searchUrl: string;
  portalUrl: string | null;
  /** Lazily launches (or reuses) an isolated Playwright context. Caller closes it. */
  browser: () => Promise<BrowserContext>;
  log: (m: string) => void;
  politeness: { minDelayMs: number };
};

export interface PortalAdapter {
  /** Exact label as stored in permit_databases.platform. */
  platform: string;
  /** Other labels in permit_databases.platform served by this adapter. */
  aliases?: string[];
  /** Search by one field. Throw on portal failure; return [] on a genuine no-results. */
  search(ctx: AdapterCtx, q: { type: PermitSearchType; value: string }): Promise<PermitRecord[]>;
  /**
   * Permits issued/applied since `since` (ISO). Required for alerts. Return []
   * if the portal cannot list by date and say so in `capabilities.listRecent`.
   */
  listRecent(ctx: AdapterCtx, since: string): Promise<PermitRecord[]>;
  detail?(ctx: AdapterCtx, permitNumber: string): Promise<PermitRecord | null>;
  capabilities: AdapterCapabilities;
}
