/**
 * Federal exclusions and debarments: SAM.gov's public Exclusions extract (A9), searched in every state.
 *
 *   us-sam-exclusions  sam.gov/data-services → Exclusions → "Public V2": a daily ZIP of one CSV "for all active exclusion
 *                      records … No additional access is required to download these files" (the listing's own
 *                      description, read 2026-10-15). No account and no key; the listing and the download go through
 *                      sam.gov/api/prod/fileextractservices (robots.txt disallows only Drupal paths, /admin/, /search/,
 *                      /user/…), and the download redirects to a signed falextracts.s3.amazonaws.com URL.
 *
 * On 2026-10-15 the file (SAM_Exclusions_Public_Extract_V2_26288) had 169,026 records: 133,776 Individual, 25,564
 * Special Entity Designation, 8,364 Firm, 1,322 Vessel; every one Record Status "Active".
 *
 * Only the publisher's "Firm" records are kept: a federal exclusion is an enforcement record for a business (FCRA).
 * Individuals, vessels and special entity designations never reach a report, an index key or a person subject. Kept per
 * firm: the exclusion type, program, excluding agency, CT code (as published; SAM's code, not our reading of it), the
 * active and termination dates as published (a termination of "Indefinite" is no end date), the publisher's comments,
 * the address, UEI and CAGE (searchable as identifiers). The "Cross-Reference" column is left out: it names other
 * excluded parties, mostly individuals. `adverse` is the publisher's own fact: an active exclusion is true, one whose
 * termination date has passed false, anything else null.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { hasEnded } from "./adverse";
import { type BulkHit, type BulkSource, csvRecordsFrom, download } from "./bulk";
import { politeFetch, rethrowIfBlocked } from "./http";

export const SAM_SOURCE_ID = "us-sam-exclusions";
const LIST_URL = "https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Exclusions/Public%20V2&privacy=Public";
const DOWNLOAD_BASE = "https://sam.gov/api/prod/fileextractservices/v1/api/download/";
/** Where a reader finds the extract (SAM's data services page, named in its terms of use). */
const PAGE_URL = "https://sam.gov/data-services";
const SOURCE = "SAM.gov federal exclusions and debarments (Public V2 extract)";

type ListedFile = { displayKey: string; key: string; dateModified?: string };

/** The newest "SAM_Exclusions_Public_Extract_V2_<yyddd>.ZIP" in the listing (null when it lists none). */
export function newestExtract(list: ListedFile[]): ListedFile | null {
  const num = (f: ListedFile) => Number(f.displayKey.match(/^SAM_Exclusions_Public_Extract_V2_(\d+)\.ZIP$/i)?.[1] ?? NaN);
  const files = list.filter((f) => Number.isFinite(num(f)));
  return files.length ? files.reduce((a, b) => (num(b) > num(a) ? b : a)) : null;
}

/** The download URL of a listed file: the listing's own key, each path segment encoded. */
export const downloadUrl = (f: ListedFile) => `${DOWNLOAD_BASE}${f.key.split("/").map(encodeURIComponent).join("/")}?privacy=Public`;

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim() || null;
const isoDate = (v: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null);

/** One CSV record → a business's enforcement row, or null (an individual, a vessel, a special entity designation, no name). */
export function samRow(r: Record<string, string>): BulkHit | null {
  if (clean(r["Classification"]) !== "Firm") return null;
  const name = clean(r["Name"]);
  if (!name) return null;
  const endDate = isoDate(r["Termination Date"]);
  const termination = clean(r["Termination Date"]);
  const status = clean(r["Record Status"]);
  const city = clean(r["City"]), st = clean(r["State / Province"]), zip = clean(r["Zip Code"]), country = clean(r["Country"]);
  const address = [r["Address 1"], r["Address 2"], r["Address 3"], r["Address 4"], city, st, zip].map(clean).filter(Boolean).join(" ") || null;
  const uei = clean(r["Unique Entity ID"]), cage = clean(r["CAGE"]);
  const detail = [
    clean(r["Exclusion Program"]) ? `Program: ${clean(r["Exclusion Program"])}` : null,
    clean(r["Excluding Agency"]) ? `Excluding agency: ${clean(r["Excluding Agency"])}` : null,
    clean(r["CT Code"]) ? `CT code: ${clean(r["CT Code"])}` : null,
    termination ? `Termination: ${termination}` : null,
    uei ? `UEI: ${uei}` : null,
    cage ? `CAGE: ${cage}` : null,
    country && country !== "USA" ? `Country: ${country}` : null,
    clean(r["Additional Comments"]),
  ].filter(Boolean).join(". ").slice(0, 1000) || null;
  const active = status === "Active";
  const hit: EnforcementHit = {
    state: "US", source: SOURCE, sourceUrl: PAGE_URL, category: "debarment",
    name, id: clean(r["SAM Number"]), date: isoDate(r["Active Date"]), endDate,
    status: [clean(r["Exclusion Type"]), status].filter(Boolean).join(", ") || null,
    city: [city, st].filter(Boolean).join(", ") || null, detail, amount: null,
    // The publisher's own fact: an active exclusion is one; a termination date that has passed ends it.
    adverse: active ? (hasEnded(endDate) ? false : true) : null,
    address, licenseNumber: uei,
  };
  return { kind: "enforcement", hit, business: name, person: null, keys: { licenses: [uei, cage], addresses: [address] } };
}

/** The bytes of one zip member, streamed (`unzip -p`): the 78 MB CSV is never written to disk. */
export async function* unzipStream(zip: string, member: string): AsyncIterable<Buffer> {
  const child = spawn("unzip", ["-p", zip, member.replace(/([[\]*?\\])/g, "\\$1")], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr = (stderr + String(c)).slice(-500); });
  const exited = new Promise<number>((resolve, reject) => { child.on("error", reject); child.on("close", (code) => resolve(code ?? -1)); });
  try {
    for await (const chunk of child.stdout) yield chunk as Buffer;
    const code = await exited;
    if (code !== 0) throw new Error(`unzip exited ${code}: ${stderr.trim()}`);
  } finally {
    if (child.exitCode == null) child.kill();
  }
}

async function samRetry<T>(what: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 30_000));
    try { return await fn(); }
    catch (err) {
      rethrowIfBlocked(err);
      last = err;
    }
  }
  throw new Error(`SAM.gov ${what} failed ${tries} times: ${String((last as Error)?.message ?? last).slice(0, 200)}`);
}

async function* samLoader(): AsyncIterable<BulkHit> {
  // sam.gov's file service answers a passing HTTP 500 now and then (2026-10-15: runs of 500s, then 200s): the
  // listing and the download each get up to five tries, 30 s apart (its bad spells last a minute or more). A 401/403 or robots.txt refusal still stops at once.
  const body = await samRetry("file listing", async () => {
    // The listing is HAL JSON; asked for as plain "application/json" it answers HTTP 500 every time (2026-10-15).
    const res = await politeFetch(LIST_URL, { headers: { accept: "application/hal+json" } });
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`SAM.gov file listing returned HTTP ${res.status}`); }
    return await res.json() as { _embedded?: { customS3ObjectSummaryList?: ListedFile[] } };
  });
  const file = newestExtract(body._embedded?.customS3ObjectSummaryList ?? []);
  if (!file) throw new Error("SAM.gov lists no Public V2 exclusions extract");
  const zip = await samRetry("download", () => download(downloadUrl(file)));
  try {
    const member = file.displayKey.replace(/\.zip$/i, ".CSV");
    for await (const r of csvRecordsFrom(unzipStream(zip, member))) {
      const h = samRow(r);
      if (h) yield h;
    }
  } finally {
    await fs.rm(zip, { force: true });
  }
}

export const SAM_EXCLUSIONS: BulkSource = {
  id: SAM_SOURCE_ID, state: "US", label: SOURCE, pageUrl: PAGE_URL,
  // 8,364 firm records on 2026-10-15.
  everyHours: 24, minRows: 6_000, rowShape: 1, companiesOnly: true, category: "debarment",
  load: samLoader,
};

/** Bulk sources searched in every state (once per report, not once per state). */
export const NATIONWIDE_BULK: BulkSource[] = [SAM_EXCLUSIONS];
