/**
 * Adapter registry: platform label (or alias) → PortalAdapter.
 *
 * The seven adapters that live in server/scraper.ts predate this interface.
 * They are wrapped here with `listRecent` returning [] and
 * `capabilities.listRecent = false`; platform-specific adapter files under
 * server/scrapers/ replace these wrappers by calling `registerAdapter`.
 */
import { scrapeByPlatform, type ScrapeResult } from "../scraper";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

const adapters = new Map<string, PortalAdapter>();

function key(platform: string): string {
  return platform.trim().toLowerCase();
}

/** Register (or replace) an adapter under its platform label and aliases. */
export function registerAdapter(adapter: PortalAdapter): void {
  adapters.set(key(adapter.platform), adapter);
  for (const alias of adapter.aliases ?? []) adapters.set(key(alias), adapter);
}

export function getAdapter(platform: string | null | undefined): PortalAdapter | null {
  if (!platform) return null;
  return adapters.get(key(platform)) ?? null;
}

/** Distinct adapters, for capability listings. */
export function listAdapters(): PortalAdapter[] {
  return Array.from(new Set(adapters.values()));
}

/** Does this platform have an adapter whose listRecent really lists by date? */
export function supportsAlerts(platform: string | null | undefined): boolean {
  return getAdapter(platform)?.capabilities.listRecent === true;
}

/** Map a legacy ScrapeResult (server/scraper.ts) to the normalized record. */
export function fromLegacyResult(r: ScrapeResult, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">): PermitRecord | null {
  if (!r.permitNumber) return null;
  const raw = (r as any).rawData as Record<string, unknown> | undefined;
  return {
    permitNumber: r.permitNumber,
    jurisdiction: ctx.jurisdiction,
    databaseId: ctx.databaseId,
    address: r.address ?? null,
    parcel: r.parcelNumber ?? null,
    permitType: r.permitType ?? null,
    description: r.description ?? null,
    status: r.status ?? null,
    issuedAt: r.issuedDate ?? null,
    expiresAt: r.expirationDate ?? null,
    contractorName: r.contractorName ?? null,
    applicantName: r.applicantName ?? null,
    sourceUrl: typeof raw?.detailUrl === "string" ? raw.detailUrl : null,
    raw: raw ?? null,
  };
}

/** The legacy scrapers write search_results rows under a query id; alerts/registry searches use this sentinel. */
export const REGISTRY_QUERY_ID = 0;

function legacy(platform: string, aliases: string[], search: PermitSearchType[]): PortalAdapter {
  return {
    platform,
    aliases,
    capabilities: { search, listRecent: false, detail: false },
    async search(ctx, q) {
      const jobId = `registry-${ctx.databaseId}-${Date.now()}`;
      const results = await scrapeByPlatform(
        platform, ctx.searchUrl, q.value, q.type, ctx.databaseId, ctx.databaseName, REGISTRY_QUERY_ID, jobId,
      );
      return results.map(r => fromLegacyResult(r, ctx)).filter((r): r is PermitRecord => r !== null);
    },
    async listRecent() {
      return [];
    },
  };
}

// The 7 adapters in server/scraper.ts. Labels and aliases mirror scrapeByPlatform's switch.
registerAdapter(legacy("SmartGov", [], ["address", "permit"]));
registerAdapter(legacy("Skagit County", ["Custom / GovPlatform"], ["address", "permit", "name"]));
registerAdapter(legacy("Tyler EnerGov", ["Tyler Technologies", "Tyler EnerGov Self Service"], ["address", "permit", "name"]));
registerAdapter(legacy("eTRAKiT", [], ["permit", "name", "company"]));
registerAdapter(legacy("Accela", ["Accela Citizen Access"], ["address", "permit", "name"]));
registerAdapter(legacy("Click2Gov", [], ["address", "permit", "name"]));
registerAdapter(legacy("FTG Portal", [], ["name", "company"]));
