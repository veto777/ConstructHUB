import { politeFetch, politeJson, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";

export function govpilotUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "main.govpilot.com" || !/^\/web\/public\/[^/]+$/.test(url.pathname) || !/^\d+$/.test(url.searchParams.get("uid") ?? "")) {
    throw new Error("Not a supported GovPilot public permit lookup URL");
  }
  return url;
}

/** Module IDs come from the actual public form, never from a guessed tenant mapping. */
export function parseGovpilotConfig(html: string, input: string): { uid: string; tid: string } {
  const url = govpilotUrl(input);
  if (/captcha|cf-chl-|verify you are human|access denied/i.test(html)) throw new PortalBlockedError(input, 403, "GovPilot challenge/access denial");
  if (/type=["']password["']/i.test(html)) throw new PortalBlockedError(input, 401, "GovPilot requires sign-in");
  const tid = html.match(/\bASTYPE\s*=\s*['"]ADDSEL=([a-z\d]+,1)['"]/i)?.[1];
  if (!tid || !/id=['"]addqs['"]/i.test(html) || !/permit number/i.test(html)) {
    throw new Error("GovPilot page has no public existing-permit lookup (application, property or inspection-only form)");
  }
  return { uid: url.searchParams.get("uid")!, tid };
}

export function govpilotSearchRequest(config: { uid: string; tid: string }, value: string): { url: string; init: RequestInit } {
  return {
    url: "https://api-main.govpilot.com/api/v1/lookup/address/module-search",
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...config, q: value, take: 100, skip: 0, page: 1, pageSize: 100 }) },
  };
}

export function parseGovpilotResults(payload: unknown, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">): PermitRecord[] {
  if (!payload || typeof payload !== "object") throw new Error("Invalid GovPilot response");
  const p = payload as { success?: unknown; status?: unknown; error?: unknown; data?: unknown };
  if (p.success !== true || p.status !== "success" || p.error || !Array.isArray(p.data)) throw new Error("GovPilot lookup failed or returned an unexpected schema");
  return p.data.flatMap((row: unknown): PermitRecord[] => {
    if (!row || typeof row !== "object" || !("FADDRESS" in row) || typeof row.FADDRESS !== "string") throw new Error("GovPilot lookup row has no display address");
    // This is the public inspection lookup's labelled permit summary, not the property's ID.
    if (/^CTRL NO:/.test(row.FADDRESS) && !row.FADDRESS.includes("PRMT NO:")) return []; // Historical control-only row: no public permit number.
    const match = row.FADDRESS.match(/^CTRL NO:\s*.*?\s+PRMT NO:\s*(\S+)\s+(.+?)(?:\s+-\s+([\s\S]*))?$/);
    if (!match || /^(?:null|undefined|N\/A)$/i.test(match[1])) throw new Error("GovPilot lookup row has no recognizable permit number");
    return [{
      permitNumber: match[1], ...ctx, address: match[2].trim() || null,
      description: match[3]?.trim() || null,
      parcel: null, lat: null, lng: null, permitType: null, workClass: null, status: null,
      issuedAt: null, appliedAt: null, expiresAt: null, valuation: null,
      contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
      // The form URL identifies an inspection request, not a public permit-detail page.
      sourceUrl: null, raw: row as Record<string, unknown>,
    }];
  });
}

const adapter: PortalAdapter = {
  platform: "GovPilot",
  aliases: ["GovPilot (Construction Permit)", "GovPilot (Construction inspection request)", "GovPilot (Construction Permit Inspection Request)", "GovPilot (Construction Permit / Inspection Request)", "GovPilot (Construction Permit / Inspections)"],
  capabilities: { search: ["address", "permit"], listRecent: false, detail: false },
  async search(ctx, q) {
    govpilotUrl(ctx.searchUrl);
    if (!["address", "permit"].includes(q.type)) throw new Error(`GovPilot public permit lookup does not support ${q.type} search`);
    if (!q.value || q.value.trim().length < 4) throw new Error("GovPilot public permit lookup requires at least four characters");
    const opts = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) };
    const response = await politeFetch(ctx.searchUrl, {}, opts);
    if (!response.ok) throw new Error(`GovPilot HTTP ${response.status}`);
    const config = parseGovpilotConfig(await response.text(), response.url || ctx.searchUrl);
    const req = govpilotSearchRequest(config, q.value.trim());
    const payload = await politeJson(req.url, req.init, opts);
    // The observed endpoint returns all matching rows, despite the Kendo pageSize hint;
    // the public form explicitly has serverPaging:false. Do not invent pagination.
    return parseGovpilotResults(payload, { databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction });
  },
  async listRecent(ctx) { govpilotUrl(ctx.searchUrl); ctx.log("GovPilot public lookup has no issued/applied date listing"); return []; },
};
export default adapter;
