import * as cheerio from "cheerio";
import { safeFetch, type PageResponse } from "../sitescan/http";
export type NapProfile = {
  name: string | null;
  phone: string | null;
  street_address: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  service_area_only: boolean | null;
};
export type FieldResult = {
  result: "match" | "differs" | "missing";
  expected: string | null;
  observed: string | null;
  required: boolean;
};
export type NapResult = {
  fields: Record<string, FieldResult>;
  matches: boolean;
};
export const normalizeText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export const normalizeName = (value: string) =>
  normalizeText(value.replace(/\b(l\.?l\.?c\.?|i\.?n\.?c\.?)\b/gi, " "))
    .split(" ")
    .filter(
      (t) =>
        ![
          "llc",
          "inc",
          "incorporated",
          "limited",
          "ltd",
          "corporation",
          "corp",
        ].includes(t),
    )
    .filter(Boolean)
    .sort()
    .join(" ");
export function normalizePhone(value: string) {
  const digits = value
    .replace(/(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "")
    .replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
}
const addressWords: Record<string, string> = {
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  highway: "hwy",
  parkway: "pkwy",
  place: "pl",
  terrace: "ter",
  suite: "ste",
  unit: "ste",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};
export const normalizeAddress = (value: string) =>
  normalizeText(value.replace(/#/g, " ste "))
    .split(" ")
    .map((t) => addressWords[t] ?? t)
    .join(" ");
function splitAddress(raw: string | null) {
  const m = raw?.match(
    /^(.+?),\s*([^,]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/,
  );
  return {
    street_address: m?.[1] ?? raw,
    city: m?.[2] ?? null,
    state: m?.[3] ?? null,
    postal_code: m?.[4] ?? null,
  };
}
type Seen = {
  name: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};
const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const businessType = (t: unknown) =>
  (Array.isArray(t) ? t : [t]).some(
    (v) =>
      typeof v === "string" &&
      /(?:LocalBusiness|Store|Restaurant|LodgingBusiness|Hotel|HomeAndConstructionBusiness|GeneralContractor|RoofingContractor|Plumber|Electrician|HVACBusiness|ProfessionalService|AutoRepair|Dentist|MedicalBusiness|RealEstateAgent|LegalService|FinancialService|LandscapingBusiness|HousePainter|Locksmith|MovingCompany)$/.test(
        v,
      ),
  );
/** Keep each business separate: never assemble matching NAP from different search-result cards. */
export function parseBusinesses(html: string): {
  businesses: Seen[];
  title: string | null;
  text: string;
} {
  const $ = cheerio.load(html),
    businesses: Seen[] = [];
  const nodes: any[] = [];
  const walk = (v: any, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 30) return;
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    nodes.push(v);
    Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()));
    } catch {
      /* malformed markup is not evidence */
    }
  });
  const byId = new Map(nodes.filter((n) => n["@id"]).map((n) => [n["@id"], n]));
  for (const n of nodes.filter((n) => businessType(n["@type"]))) {
    const a = n.address?.["@id"]
      ? (byId.get(n.address["@id"]) ?? n.address)
      : n.address;
    businesses.push({
      name: clean(n.name),
      phone: clean(n.telephone),
      street_address: clean(typeof a === "string" ? a : a?.streetAddress),
      city: clean(a?.addressLocality),
      state: clean(a?.addressRegion),
      postal_code: clean(a?.postalCode),
      ...(typeof a === "string" ? splitAddress(a) : {}),
    });
  }
  $("[itemscope][itemtype]").each((_, el) => {
    if (!businessType($(el).attr("itemtype")?.split("/").pop())) return;
    const value = (prop: string) => {
      const v = $(el)
        .find(`[itemprop="${prop}"]`)
        .filter(
          (_, child) =>
            $(child)
              .parents("[itemscope][itemtype]")
              .filter((_, profile) =>
                businessType($(profile).attr("itemtype")?.split("/").pop()),
              )
              .first()[0] === el,
        )
        .first();
      return clean(
        v.attr("content") ?? v.attr("href")?.replace(/^tel:/, "") ?? v.text(),
      );
    };
    businesses.push({
      name: value("name"),
      phone: value("telephone"),
      street_address: value("streetAddress"),
      city: value("addressLocality"),
      state: value("addressRegion"),
      postal_code: value("postalCode"),
    });
  });
  const title = clean($("title").first().text());
  $(
    'script,style,noscript,template,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"]',
  ).remove();
  $("p,div,section,article,main,address,br,h1,h2,li").before(" ").after(" ");
  const text = $("body").text().replace(/\s+/g, " ").trim();
  // Fallback only for a single-business page. A heading + a local contact block provide identity.
  if (!businesses.length) {
    const headings = $("h1");
    if (headings.length === 1) {
      const scope = $("main").length === 1 ? $("main") : $("body");
      const phones = [
        ...new Set(
          (
            (scope
              .text()
              .match(
                /(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/g,
              ) ?? []) as string[]
          ).concat(
            scope
              .find('a[href^="tel:"]')
              .map((_, e) => $(e).attr("href")!.slice(4))
              .get(),
          ),
        ),
      ];
      const addresses = scope.find("address");
      // Multiple contacts can be unrelated directory profiles; leave inconclusive.
      const addressText = addresses.length
        ? addresses.text().replace(/\s+/g, " ").trim()
        : (scope
            .text()
            .match(
              /\b\d+\s+[A-Za-z0-9 .#-]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b(?:[ .]+(?:Ste|Suite|Unit|#)\s*[A-Za-z0-9-]+)?(?:,\s*[A-Za-z .-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/i,
            )?.[0] ?? null);
      if (
        new Set(phones.map(normalizePhone)).size <= 1 &&
        addresses.length <= 1
      )
        businesses.push({
          name: clean(headings.text()),
          phone: clean(phones[0]),
          ...splitAddress(addressText),
        });
    }
  }
  return { businesses, title, text };
}
export function matchNap(profile: NapProfile, seen: Seen): NapResult {
  const fields: Record<string, FieldResult> = {};
  const expected: Record<string, string | null> = {
    name: profile.name,
    phone: profile.phone,
    street_address:
      [profile.street_address, profile.address_line2]
        .filter(Boolean)
        .join(" ") || null,
    city: profile.city ?? null,
    state: profile.state ?? null,
    postal_code: profile.postal_code ?? null,
  };
  for (const field of Object.keys(expected)) {
    const expectedValue = expected[field],
      observedValue = seen[field as keyof Seen];
    const required =
      field === "name" ||
      field === "phone" ||
      (profile.service_area_only !== true &&
        (field === "street_address" || !!expectedValue));
    const normalize =
      field === "name"
        ? normalizeName
        : field === "phone"
          ? normalizePhone
          : normalizeAddress;
    fields[field] = {
      expected: expectedValue,
      observed: observedValue,
      required,
      result:
        !expectedValue || !observedValue
          ? "missing"
          : normalize(expectedValue) &&
              normalize(expectedValue) === normalize(observedValue)
            ? "match"
            : "differs",
    };
  }
  return {
    fields,
    matches: Object.values(fields).every(
      (f) => f.result === "match" || (!f.required && f.result === "missing"),
    ),
  };
}
export type CheckResult = {
  status: string;
  billable: boolean;
  nap: NapResult | null;
  evidence: {
    confirmation: "confirmed" | "unconfirmed";
    title: string | null;
    excerpt: string | null;
    url: string;
    reason: string | null;
  };
};
export function isBillable(
  status: string,
  nap: NapResult | null,
  confirmed: boolean,
) {
  return status === "live" && confirmed && nap?.matches === true;
}
export function analyzeDirectoryProfile(
  page: Pick<PageResponse, "url" | "status" | "body">,
  profile: NapProfile,
  previous = "queued",
): CheckResult {
  const parsed = parseBusinesses(page.body);
  const evidence: CheckResult["evidence"] = {
    confirmation: "unconfirmed",
    title: parsed.title,
    excerpt: parsed.text.slice(0, 1000) || null,
    url: page.url,
    reason: null,
  };
  const unconfirmed = (reason: string): CheckResult => ({
    status: previous,
    billable: false,
    nap: null,
    evidence: { ...evidence, reason },
  });
  if (
    page.status < 200 ||
    page.status >= 300 ||
    /captcha|verify (?:that )?you are human|access denied|just a moment|checking your browser|enable javascript|unusual traffic/i.test(
      `${parsed.title} ${parsed.text}`,
    )
  )
    return unconfirmed("Blocked or non-success response");
  const ranked = parsed.businesses
    .map((seen) => ({ seen, nap: matchNap(profile, seen) }))
    .filter(
      ({ nap }) =>
        nap.fields.name.result === "match" ||
        nap.fields.phone.result === "match",
    )
    .sort((a, b) => Number(b.nap.matches) - Number(a.nap.matches));
  // More than one candidate is ambiguous (including duplicate-location pages).
  if (ranked.length !== 1)
    return unconfirmed(
      ranked.length
        ? "Multiple businesses match; use an individual directory profile URL"
        : "Business identity not confirmed",
    );
  const nap = ranked[0].nap;
  // A matching name alone on an unrelated page is insufficient proof of identity.
  if (
    nap.fields.phone.result !== "match" &&
    !(
      nap.fields.name.result === "match" &&
      nap.fields.street_address.result === "match"
    )
  )
    return unconfirmed("Insufficient corroborating business identity");
  evidence.confirmation = "confirmed";
  evidence.excerpt = JSON.stringify(ranked[0].seen).slice(0, 1000);
  const status = ["duplicate", "suppressed"].includes(previous)
    ? previous
    : nap.matches
      ? "live"
      : "mismatch";
  return { status, nap, evidence, billable: isBillable(status, nap, true) };
}
export async function checkDirectoryProfile(
  url: string,
  profile: NapProfile,
  previous = "queued",
  fetcher = safeFetch,
  allowed: (url: string) => boolean = () => true,
): Promise<CheckResult> {
  try {
    return analyzeDirectoryProfile(await fetcher(url, allowed), profile, previous);
  } catch {
    return {
      status: previous,
      billable: false,
      nap: null,
      evidence: {
        confirmation: "unconfirmed",
        title: null,
        excerpt: null,
        url,
        reason: "Fetch failed or blocked by crawl policy",
      },
    };
  }
}
