/**
 * Pure helpers for the Site Scan page (client/src/pages/site-scan.tsx) and its fix checklist
 * (client/src/components/site-scan-fixes.tsx). Kept free of React so server-side vitest can cover them.
 */

/** One readable line of a fix's evidence: a label and its plain-text value. */
export type EvidenceLine = { label: string; value: string };

const MAX_TEXT = 160;
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1).trimEnd() + "…" : s);
const count = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** 2732 → "2.7 KB"; 1450000 → "1.4 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 1000) return `${n} B`;
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} KB`;
  return `${(n / 1000 / 1000).toFixed(1)} MB`;
}

const httpStatus = (n: number) =>
  n === 200 ? "200 (OK)" : n === 301 || n === 308 ? `${n} (permanent redirect)` : n === 302 || n === 307 ? `${n} (temporary redirect)`
    : n === 404 ? "404 (not found)" : n === 410 ? "410 (gone)" : n >= 500 ? `${n} (server error)` : String(n);

/** camelCase key → "Camel case" for keys the summary does not know by name. */
const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Keys whose content is too long or nested for the summary; they stay in the technical evidence. */
const DETAIL_ONLY = new Set(["observedHeadings", "observedText", "robots", "draftLabel", "asked", "headings"]);

/**
 * A short, readable summary of a fix's evidence (status code, page title, size, …). The raw JSON stays
 * available behind the "Technical evidence" disclosure; this only picks out what a person reads first.
 */
export function evidenceSummary(evidence: unknown): EvidenceLine[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const e = evidence as Record<string, any>;
  const out: EvidenceLine[] = [];
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    out.push({ label, value: clip(String(value)) });
  };
  const handled = new Set<string>();
  const take = (key: string, fn: (v: any) => void) => {
    if (!(key in e)) return;
    handled.add(key);
    fn(e[key]);
  };

  take("status", (v) => add("Status code", typeof v === "number" ? httpStatus(v) : v));
  take("title", (v) => add("Page title", v || "(none)"));
  take("description", (v) => add("Meta description", v || "(none)"));
  if (Array.isArray(e.headings)) add("H1", e.headings.length ? e.headings.join(" · ") : "(none)");
  take("canonical", (v) => add("Canonical URL", v));
  take("noindex", (v) => typeof v === "boolean" && add("Indexing", v ? "Blocked by noindex" : "Allowed"));
  take("htmlBytes", (v) => typeof v === "number" && add("HTML size", formatBytes(v)));
  take("currentBytes", (v) => typeof v === "number" && add("Current size", formatBytes(v)));
  take("targetBytes", (v) => typeof v === "number" && add("Target size", formatBytes(v)));
  take("targetNote", (v) => add("Note", v));
  take("current", (v) => add("Current", v || "(none)"));
  take("draft", (v) => add(e.draftLabel ? "Draft (review before publishing)" : "Draft", v || "(none)"));
  take("observed", (v) =>
    Array.isArray(v) ? add("Structured data found", v.length ? count(v.length, "block") : "None") : add("Observed", v));
  take("invalidJSON", (v) => typeof v === "boolean" && v && add("Structured data", "Invalid JSON-LD"));
  take("source", (v) => add("Source", v));
  take("images", (v) => Array.isArray(v) && add("Images without alt text", v.length ? `${count(v.length, "image")}: ${v.slice(0, 3).join(", ")}${v.length > 3 ? ", …" : ""}` : "None"));
  take("partOfSite", (v) => add("Part of site", v));
  if (Array.isArray(e.asked)) add("Test addresses checked", count(e.asked.length, "address", "addresses"));
  take("chain", (v) => Array.isArray(v) && add("Redirect chain", v.length ? count(v.length, "hop") : "None"));
  take("final", (v) => add("Final URL", v));
  take("resources", (v) => Array.isArray(v) && add("Insecure resources", v.length ? count(v.length, "resource") : "None"));
  take("error", (v) => add("Fetch error", v));
  if ("robots" in e) add("robots.txt", e.robots ? "Read (see technical evidence)" : "Not found");
  take("syncedValue", (v) => add("Business Profile value", v));
  if (typeof e.observedText === "string") add("Page text checked", count(e.observedText.length, "character"));
  take("method", (v) => add("Method", v));
  take("syncedEntry", (v) => add("Business Profile entry", v));
  take("profileValues", (v) => Array.isArray(v) && add("Profile entries", count(v.length, "entry", "entries")));
  take("observedHeadingCount", (v) => add("Pages checked", v));
  take("anchor", (v) => add("Link text", v));
  take("suggestedReplacement", (v) => add("Suggested replacement", v));
  take("note", (v) => add("Note", v));

  // Anything else: show plain scalars, leave nested data to the technical evidence.
  for (const [key, v] of Object.entries(e)) {
    if (handled.has(key) || DETAIL_ONLY.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof v)) add(humanize(key), typeof v === "boolean" ? (v ? "Yes" : "No") : v);
    else if (Array.isArray(v)) add(humanize(key), count(v.length, "item"));
  }
  return out;
}

/**
 * The line under a report category that has no findings in the current view. "Current page" wording is
 * used only when the filtered findings really continue on other pages; otherwise the category has none.
 */
export function emptyCategoryMessage(opts: {
  /** Findings on this page (already filtered by category and search). */
  shown: number;
  /** Findings across all pages for the current filters (server findingTotal). */
  total: number | undefined;
  offset: number | undefined;
  searching: boolean;
}): string {
  const { shown, searching } = opts;
  const total = opts.total ?? shown;
  const offset = opts.offset ?? 0;
  const morePages = offset > 0 || total > offset + shown;
  if (morePages)
    return "None of the findings on this page are in this category. Use Next findings, or set Category to this one, to check the other pages.";
  if (searching) return "No findings in this category match your search.";
  return "No findings in this category.";
}

/**
 * The location the scan form opens on: the signed-in account's own business (the location named like the
 * account's company), never just the first client location in the list. Null leaves the form empty.
 */
export function ownLocation<T extends { business_name?: string | null; website?: string | null }>(
  locations: T[] | undefined,
  companyName: string | null | undefined,
): T | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const company = norm(companyName || "");
  if (!company || !locations?.length) return null;
  return locations.find((l) => l.website && norm(l.business_name || "") === company) ?? null;
}

