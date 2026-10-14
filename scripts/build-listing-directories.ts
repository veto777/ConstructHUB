/**
 * Scouted directories → server/data/listing-directories.json (tier 4 of the listings catalogue).
 *
 *   npx tsx scripts/build-listing-directories.ts <scout-dir>/*\/directories.jsonl [--recheck]
 *
 * Each scout line is validated (server/listings/scouted.ts), skipped if its domain is already in the catalogue or the
 * data file, and its directory page is fetched again:
 *   - loads (2xx after redirects, not parked, not a soft 404)  → "verified"
 *   - bot wall / rate limit / server error / timeout           → "unconfirmed" (kept: the scout saw the page)
 *   - DNS failure, refused connection, bad TLS, 404/410, parked or soft 404 → dropped and listed in the summary
 * Existing rows are kept as they are unless --recheck is passed (then they are re-fetched and dead ones removed).
 * Never invents a field: anything the scout did not see stays null.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { catalogue } from "../server/listings/catalogue";
import { scoutRow, toDirectoryRow, SCOUTED_FILE, type ScoutedDirectory } from "../server/listings/scouted";
import { siteUrl } from "../server/sitescan/http";

const OUT = path.join(import.meta.dirname, "..", "server", "data", SCOUTED_FILE);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const CONCURRENCY = 8;

type Check = { status: "verified" | "unconfirmed" | "dead"; reason: string };

const PARKED = /(this domain (is|may be) for sale|buy this domain|domain is parked|parked free|sedoparking|hugedomains|\bdan\.com\b)/i;
const SOFT_404 = /<title>[^<]*(404|page not found|not found)[^<]*<\/title>/i;

async function checkPage(url: string): Promise<Check> {
  let safe: string;
  try {
    safe = siteUrl(url);
  } catch {
    return { status: "dead", reason: "not a public URL" };
  }
  try {
    const res = await fetch(safe, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: { "user-agent": UA, accept: "text/html,*/*" },
    });
    if (res.status === 404 || res.status === 410) return { status: "dead", reason: `HTTP ${res.status}` };
    if (res.status >= 400) return { status: "unconfirmed", reason: `HTTP ${res.status}` };
    const body = (await res.text()).slice(0, 200_000);
    if (PARKED.test(body)) return { status: "dead", reason: "parked domain" };
    if (SOFT_404.test(body)) return { status: "dead", reason: "soft 404" };
    return { status: "verified", reason: `HTTP ${res.status}` };
  } catch (error: any) {
    const code = error?.cause?.code ?? error?.name ?? "error";
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|SSL|TLS|ERR_TLS/i.test(String(code))) return { status: "dead", reason: code };
    return { status: "unconfirmed", reason: code };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const recheck = args.includes("--recheck");
  const files = args.filter((arg) => !arg.startsWith("--"));

  let existing: ScoutedDirectory[] = [];
  try {
    existing = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    existing = [];
  }
  const taken = new Set<string>([...catalogue().map((d) => d.domain), ...existing.map((d) => d.domain)]);
  const takenNames = new Set<string>([...catalogue().map((d) => d.name.toLowerCase()), ...existing.map((d) => d.name.toLowerCase())]);

  const fresh: Omit<ScoutedDirectory, "linkStatus" | "checkedAt">[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const foundBy = path.basename(path.dirname(file));
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        rejected.push(`${foundBy}: unparseable line`);
        continue;
      }
      const parsed = scoutRow.safeParse(raw);
      if (!parsed.success) {
        rejected.push(`${foundBy}: ${(raw as any)?.domain ?? "?"} — ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        continue;
      }
      const row = parsed.data;
      if (taken.has(row.domain)) continue;
      let name = row.name;
      if (takenNames.has(name.toLowerCase())) name = `${row.name} (${row.domain})`;
      const candidate = {
        name,
        domain: row.domain,
        category: row.category,
        trades: row.trades,
        states: row.states,
        requiresStreetAddress: row.requires_street_address,
        requiresPhoneVerification: row.requires_phone_verification,
        requiresPostcard: row.requires_postcard,
        paid: row.paid,
        membershipRequired: row.membership_or_certification_required,
        directoryUrl: row.directory_url,
        joinUrl: row.join_url,
        evidence: row.evidence,
        notes: row.notes,
        foundBy,
      };
      try {
        toDirectoryRow({ ...candidate, linkStatus: "verified", checkedAt: new Date().toISOString() });
      } catch (error: any) {
        rejected.push(`${foundBy}: ${row.domain} — ${error?.issues?.[0]?.path?.join(".") ?? ""} ${error?.issues?.[0]?.message ?? error}`);
        continue;
      }
      taken.add(row.domain);
      takenNames.add(name.toLowerCase());
      fresh.push(candidate);
    }
  }

  const toCheck = recheck ? [...existing, ...fresh] : fresh;
  console.log(`checking ${toCheck.length} directory pages (${fresh.length} new${recheck ? `, ${existing.length} rechecked` : ""})…`);
  const checks = await mapLimit(toCheck, CONCURRENCY, (d) => checkPage(d.directoryUrl));
  const now = new Date().toISOString();
  const dead: string[] = [];
  const checked: ScoutedDirectory[] = [];
  toCheck.forEach((d, index) => {
    const check = checks[index];
    if (check.status === "dead") {
      dead.push(`${d.domain} ${d.directoryUrl} — ${check.reason}`);
      return;
    }
    checked.push({ ...d, linkStatus: check.status, checkedAt: now });
  });

  const kept = recheck ? checked : [...existing, ...checked];
  kept.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  writeFileSync(OUT, JSON.stringify(kept, null, 1) + "\n");

  const byCategory = kept.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.category]: (acc[d.category] ?? 0) + 1 }), {});
  console.log(`wrote ${kept.length} directories to ${path.relative(process.cwd(), OUT)}`, byCategory);
  console.log(`verified ${kept.filter((d) => d.linkStatus === "verified").length} · unconfirmed ${kept.filter((d) => d.linkStatus === "unconfirmed").length}`);
  if (dead.length) console.log(`dropped ${dead.length} dead:\n  ${dead.join("\n  ")}`);
  if (rejected.length) console.log(`rejected ${rejected.length} invalid rows:\n  ${rejected.join("\n  ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
