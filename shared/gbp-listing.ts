/**
 * Listing editor rules, shared by the server (validation before the Google write, the update mask)
 * and the client (the same validation as you type, the "what changed" list).
 *
 * Every limit here mirrors a rule Google states for the Business Information API or in its Business
 * Profile guidelines; the source is named beside each one. Nothing here calls Google, and nothing
 * here invents a value: an unknown field stays null/undefined.
 *
 * Sources (fetched 2026-10-09):
 *   Location resource — developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations
 *   locations.patch (updateMask) — .../rest/v1/locations/patch
 *   Attributes / updateAttributes (attributeMask) — .../rest/v1/locations/updateAttributes
 *   Business name, description, category guidelines — support.google.com/business/answer/3038177
 */

/** The fields the editor writes through locations.patch, as update-mask paths. */
export const LISTING_FIELDS = [
  "title", "phoneNumbers", "websiteUri", "storefrontAddress", "categories", "profile.description",
  "regularHours", "specialHours", "serviceArea", "openInfo.openingDate", "openInfo.status", "labels", "serviceItems",
] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

export const LISTING_FIELD_LABELS: Record<ListingField, string> = {
  title: "Business name", phoneNumbers: "Phone numbers", websiteUri: "Website", storefrontAddress: "Address",
  categories: "Categories", "profile.description": "Description", regularHours: "Regular hours", specialHours: "Special hours",
  serviceArea: "Service area", "openInfo.openingDate": "Opening date", "openInfo.status": "Open status",
  labels: "Labels", serviceItems: "Services",
};

export const LIMITS = {
  /** Business Profile help: the description takes up to 750 characters (server/gbp/profile-input.ts uses the same cap). */
  description: 750,
  /** Location.phoneNumbers.additionalPhones: "Up to two phone numbers ... in addition to your primary phone number." */
  additionalPhones: 2,
  /** One primary category plus up to nine additional (profile-input.ts; Business Profile help). */
  additionalCategories: 9,
  /** ServiceArea.places.placeInfos: "Limited to a maximum of 20 places." */
  serviceAreaPlaces: 20,
  /** Location.labels: "Must be between 1-255 characters per label." */
  labelLength: 255,
  /** StructuredServiceItem.description: "The character limit is 300." */
  structuredServiceDescription: 300,
  /** FreeFormServiceItem.label: "We recommend that item names be 140 characters or less, and descriptions 250 characters or less." (a recommendation, so a warning) */
  freeFormServiceName: 140,
  freeFormServiceDescription: 250,
  /** OpenInfo.openingDate: "The date must be in the past or be no more than one year in the future." */
  openingDateMaxFutureDays: 366,
  /** websiteUri (profile-input.ts). */
  websiteLength: 2048,
} as const;

/** Google's business-name guideline, in the owner's words (support.google.com/business/answer/3038177, "Name"). */
export const NAME_RULES_SOURCE = "https://support.google.com/business/answer/3038177";
export const NAME_RULES: readonly string[] = [
  "Use your business's real-world name, as it appears on your storefront, website and stationery.",
  "No marketing taglines (\"America's Most Convenient Bank\").",
  "No store codes (\"The UPS Store - 2872\").",
  "No business-hours information (\"Open 24 hours\", \"(Closed)\").",
  "No phone numbers or website URLs.",
  "No special characters (%$@/\") or legal terms (LLC, LTD, INC) unless your signage shows them.",
  "No service or product information (\"Verizon Wireless 4G LTE\").",
  "No location or containment information (\"Chase ATM (in Duane Reade)\").",
];

/** Google's description guideline (same page, "Business description"). */
export const DESCRIPTION_RULES: readonly string[] = [
  "Describe your services, products, mission and history — upfront and honest.",
  "No links of any type.",
  "No special promotions, prices or sales (\"Everything on sale, -50%\").",
  "No low-quality or distracting content: misspellings, gimmicky characters, gibberish.",
];

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type Day = (typeof DAYS)[number];
export const OPEN_STATUSES = ["OPEN", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"] as const;
export const SERVICE_AREA_TYPES = ["CUSTOMER_LOCATION_ONLY", "CUSTOMER_AND_BUSINESS_LOCATION"] as const;

/* ── Reading and comparing Google's nested fields ───────────────────────────── */

export const readField = (o: any, path: string): any => path.split(".").reduce((v, k) => v?.[k], o);

/** Set a dotted path on a plain object; a null value is left out (with the mask, Google clears the field). */
export function setField(o: any, path: string, value: any) {
  if (value === null || value === undefined) return;
  const keys = path.split(".");
  let node = o;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  if (value !== null && value !== undefined) node[keys.at(-1)!] = value;
}

function canonical(v: any, key = ""): any {
  if (Array.isArray(v)) {
    const values = v.map((item) => canonical(item, key));
    // Order matters for address lines; everywhere else Google may reorder a list.
    return key === "addressLines" ? values : values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canonical(v[k], k)]));
  return v;
}

const isEmpty = (v: any) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/** The writable shape of a field: output-only parts (category display names, serviceArea.regionCode) dropped, empties null. */
export function normalizeField(field: string, value: any): any {
  if (isEmpty(value)) return null;
  if (field === "categories") {
    return {
      primaryCategory: value.primaryCategory?.name ? { name: value.primaryCategory.name } : undefined,
      additionalCategories: (value.additionalCategories ?? []).filter((c: any) => c?.name).map((c: any) => ({ name: c.name })),
    };
  }
  if (field === "serviceArea") { const { regionCode: _r, ...writable } = value; return isEmpty(writable) ? null : writable; }
  if (field === "phoneNumbers") {
    const out: any = {};
    if (value.primaryPhone) out.primaryPhone = value.primaryPhone;
    const extra = (value.additionalPhones ?? []).filter(Boolean);
    if (extra.length) out.additionalPhones = extra;
    return isEmpty(out) ? null : out;
  }
  if (field === "regularHours" || field === "specialHours") {
    const key = field === "regularHours" ? "periods" : "specialHourPeriods";
    return value[key]?.length ? { [key]: value[key] } : null;
  }
  if (field === "storefrontAddress") { const { revision: _rev, ...rest } = value; return isEmpty(rest) ? null : rest; }
  return value;
}

export const same = (a: any, b: any) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

/* ── The update mask: only what changed ─────────────────────────────────────── */

/**
 * Compares the Google location as loaded with the edited copy and returns only the fields that differ,
 * in the exact shape locations.patch takes, with `mask` as the updateMask. A field the owner emptied is
 * `null` (sent as "in the mask, absent from the body", which clears it at Google). Categories are one
 * mask entry: Google says "During updates, both fields must be set. Clients are prohibited from
 * individually updating the primary or additional categories using the update mask."
 */
export function buildUpdateMask(original: any, draft: any, fields: readonly string[] = LISTING_FIELDS): { fields: Record<string, any>; mask: string[] } {
  const changed: Record<string, any> = {};
  for (const f of fields) {
    const before = normalizeField(f, readField(original, f));
    const after = normalizeField(f, readField(draft, f));
    if (same(before, after)) continue;
    changed[f] = after;
  }
  return { fields: changed, mask: Object.keys(changed) };
}

/* ── Validation, mirroring the API's stated rules ───────────────────────────── */

export type FieldIssues = Record<string, string[]>;
export type ValidationResult = { errors: FieldIssues; warnings: FieldIssues };

const add = (bag: FieldIssues, field: string, message: string) => { (bag[field] ??= []).push(message); };
const isDay = (d: any) => (DAYS as readonly string[]).includes(d);
const minutesOf = (t: any) => (Number(t?.hours ?? 0) * 60) + Number(t?.minutes ?? 0);
const validTime = (t: any) => !!t && typeof t === "object" && Number.isInteger(t.hours ?? 0) && (t.hours ?? 0) >= 0 && (t.hours ?? 0) <= 24
  && Number.isInteger(t.minutes ?? 0) && (t.minutes ?? 0) >= 0 && (t.minutes ?? 0) <= 59 && !((t.hours ?? 0) === 24 && (t.minutes ?? 0) > 0);
const validDate = (d: any, allowPartial: boolean) => {
  if (!d || typeof d !== "object" || !Number.isInteger(d.year) || d.year < 1 || d.year > 9999) return false;
  if (d.month !== undefined && (!Number.isInteger(d.month) || d.month < 1 || d.month > 12)) return false;
  if (d.day !== undefined && (!Number.isInteger(d.day) || d.day < 1 || d.day > 31 || d.month === undefined)) return false;
  if (!allowPartial && (d.month === undefined || d.day === undefined)) return false;
  if (d.month !== undefined && d.day !== undefined) {
    const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
    if (dt.getUTCMonth() !== d.month - 1 || dt.getUTCDate() !== d.day) return false;
  }
  return true;
};
const dayNumber = (d: any) => Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1) / 86400000;
const CATEGORY_NAME = /^categories\/[\w:.-]+$/;

/** Patterns Google's naming guideline forbids; each gives a warning (Google decides, we only point). */
const NAME_WARNINGS: [RegExp, string][] = [
  [/\b(open|closed)\b|24\s*hours|24\/7/i, "Business-hours information is not allowed in the name."],
  [/\(?\+?\d[\d\s().-]{7,}\d/, "Phone numbers are not allowed in the name."],
  [/https?:\/\/|www\.|\.(com|net|org|us|biz|io)\b/i, "Website URLs are not allowed in the name."],
  [/[%$@/"]/, "Special characters (%$@/\") need real-world proof on your signage."],
  [/\b(LLC|L\.L\.C\.|LTD|INC|CORP)\b/i, "Legal terms (LLC, LTD, INC) need real-world proof on your signage."],
  [/\s[-–#]\s*\d{2,}$/, "A store code at the end of the name is not allowed."],
];

/**
 * Per-field validation of a change set (the `fields` from buildUpdateMask). Errors block the save and
 * mirror a rule Google states; warnings point at guideline text Google enforces at review time.
 * `today` lets tests pin the clock.
 */
export function validateListing(fields: Record<string, any>, opts: { today?: Date } = {}): ValidationResult {
  const errors: FieldIssues = {}, warnings: FieldIssues = {};
  const today = opts.today ?? new Date();
  for (const [field, value] of Object.entries(fields)) {
    if (!(LISTING_FIELDS as readonly string[]).includes(field)) { add(errors, field, "This field cannot be edited here."); continue; }
    if (value === null) {
      if (field === "title") add(errors, field, "The business name cannot be empty.");
      if (field === "categories") add(errors, field, "A primary category is required.");
      if (field === "openInfo.status") add(errors, field, "Choose an open status.");
      continue;
    }
    switch (field) {
      case "title": {
        if (typeof value !== "string" || !value.trim()) { add(errors, field, "The business name cannot be empty."); break; }
        if (value.length > 300) add(errors, field, "Keep the name under 300 characters.");
        for (const [re, msg] of NAME_WARNINGS) if (re.test(value)) add(warnings, field, msg);
        break;
      }
      case "phoneNumbers": {
        if (typeof value !== "object") { add(errors, field, "Invalid phone numbers."); break; }
        const extra = value.additionalPhones ?? [];
        if (!Array.isArray(extra) || extra.length > LIMITS.additionalPhones) add(errors, field, `Up to ${LIMITS.additionalPhones} additional phone numbers.`);
        for (const p of [value.primaryPhone, ...(Array.isArray(extra) ? extra : [])]) if (p !== undefined && (typeof p !== "string" || p.length > 300)) add(errors, field, "Invalid phone number.");
        if (!value.primaryPhone && extra.length) add(errors, field, "Additional numbers need a primary phone number.");
        break;
      }
      case "websiteUri": {
        if (typeof value !== "string" || !/^https?:\/\/\S+$/.test(value) || value.length > LIMITS.websiteLength) add(errors, field, "Enter a full web address starting with http:// or https://.");
        else { try { new URL(value); } catch { add(errors, field, "That web address is not valid."); } }
        break;
      }
      case "storefrontAddress": {
        if (typeof value !== "object") { add(errors, field, "Invalid address."); break; }
        if (typeof value.regionCode !== "string" || !/^[A-Z]{2}$/.test(value.regionCode)) add(errors, field, "Country must be a 2-letter code (US).");
        if (!Array.isArray(value.addressLines) || !value.addressLines.length || value.addressLines.some((l: any) => typeof l !== "string" || !l.trim())) add(errors, field, "At least one street address line.");
        else if (value.addressLines.length > 10) add(errors, field, "Up to 10 address lines.");
        if (value.addressLines?.some((l: any) => /https?:\/\/|www\./i.test(String(l)))) add(warnings, field, "Address lines must not contain URLs or keywords.");
        break;
      }
      case "categories": {
        const primary = value?.primaryCategory?.name;
        if (typeof primary !== "string" || !CATEGORY_NAME.test(primary)) add(errors, field, "Pick a primary category from Google's list.");
        const extra = value?.additionalCategories ?? [];
        if (!Array.isArray(extra)) add(errors, field, "Invalid additional categories.");
        else {
          if (extra.length > LIMITS.additionalCategories) add(errors, field, `Up to ${LIMITS.additionalCategories} additional categories.`);
          if (extra.some((c: any) => typeof c?.name !== "string" || !CATEGORY_NAME.test(c.name))) add(errors, field, "Pick additional categories from Google's list.");
          const names = extra.map((c: any) => c?.name);
          if (names.includes(primary) || new Set(names).size !== names.length) add(errors, field, "Each category once; the primary category is not repeated.");
        }
        break;
      }
      case "profile.description": {
        if (typeof value !== "string") { add(errors, field, "Invalid description."); break; }
        if (value.length > LIMITS.description) add(errors, field, `${value.length}/${LIMITS.description} characters — shorten it.`);
        if (/https?:\/\/|www\.|<\/?[a-z][^>]*>/i.test(value)) add(warnings, field, "Google does not allow links or HTML in the description.");
        if (/\$\s?\d|\d\s?%\s*off|\bsale\b|\bdiscount\b/i.test(value)) add(warnings, field, "Google does not allow prices, promotions or sales in the description.");
        break;
      }
      case "regularHours": {
        const periods = value?.periods;
        if (!Array.isArray(periods) || periods.length > 100) { add(errors, field, "Invalid hours."); break; }
        for (const p of periods) {
          if (!isDay(p?.openDay) || !isDay(p?.closeDay)) { add(errors, field, "Each period needs an opening and closing weekday."); continue; }
          if (!validTime(p.openTime) || !validTime(p.closeTime)) { add(errors, field, "Times are 00:00–24:00."); continue; }
          if (p.openDay === p.closeDay && minutesOf(p.closeTime) <= minutesOf(p.openTime)) add(errors, field, `${cap(p.openDay)}: closing time must be after opening time (use 24:00 to close at midnight).`);
        }
        break;
      }
      case "specialHours": {
        const periods = value?.specialHourPeriods;
        if (!Array.isArray(periods) || periods.length > 100) { add(errors, field, "Invalid special hours."); break; }
        for (const p of periods) {
          if (!validDate(p?.startDate, false)) { add(errors, field, "Each special day needs a full date."); continue; }
          if (p.endDate !== undefined && (!validDate(p.endDate, false) || dayNumber(p.endDate) < dayNumber(p.startDate))) { add(errors, field, "The end date must not be before the start date."); continue; }
          if (p.closed) { if (p.openTime || p.closeTime) add(errors, field, "A closed day has no opening times."); continue; }
          if (!validTime(p.openTime) || !validTime(p.closeTime)) { add(errors, field, "Open days need an opening and a closing time."); continue; }
          const span = p.endDate ? dayNumber(p.endDate) - dayNumber(p.startDate) : 0;
          if (span > 1) add(errors, field, "A special-hours period must be shorter than 24 hours (one row per day).");
          else if (span === 0 && minutesOf(p.closeTime) <= minutesOf(p.openTime)) add(errors, field, "Closing time must be after opening time.");
          else if (span === 1 && minutesOf(p.closeTime) > 11 * 60 + 59) add(errors, field, "Hours that run past midnight can end no later than 11:59 AM the next day.");
        }
        break;
      }
      case "serviceArea": {
        if (typeof value !== "object") { add(errors, field, "Invalid service area."); break; }
        if (!(SERVICE_AREA_TYPES as readonly string[]).includes(value.businessType)) add(errors, field, "Choose how customers reach you.");
        const places = value.places?.placeInfos;
        if (places !== undefined) {
          if (!Array.isArray(places) || places.length > LIMITS.serviceAreaPlaces) add(errors, field, `Up to ${LIMITS.serviceAreaPlaces} service areas.`);
          else if (places.some((p: any) => typeof p?.placeId !== "string" || !p.placeId || typeof p?.placeName !== "string" || !p.placeName)) add(errors, field, "Pick service areas from the search (each needs Google's place id).");
        }
        if (value.businessType === "CUSTOMER_LOCATION_ONLY" && !places?.length) add(errors, field, "A service-area business needs at least one area.");
        break;
      }
      case "openInfo.openingDate": {
        if (!validDate(value, true)) { add(errors, field, "Enter a year, optionally a month and day."); break; }
        const future = new Date(Date.UTC(value.year, (value.month ?? 1) - 1, value.day ?? 1)).getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        if (future > LIMITS.openingDateMaxFutureDays * 86400000) add(errors, field, "The opening date can be at most one year in the future.");
        break;
      }
      case "openInfo.status": {
        if (!(OPEN_STATUSES as readonly string[]).includes(value)) add(errors, field, "Choose an open status.");
        if (value === "CLOSED_PERMANENTLY") add(warnings, field, "Permanently closed removes the business from most Google results. Reopening later needs Google's review.");
        break;
      }
      case "labels": {
        if (!Array.isArray(value)) { add(errors, field, "Invalid labels."); break; }
        if (value.some((l: any) => typeof l !== "string" || !l.trim() || l.length > LIMITS.labelLength)) add(errors, field, `Each label is 1–${LIMITS.labelLength} characters.`);
        if (new Set(value).size !== value.length) add(errors, field, "Each label once.");
        break;
      }
      case "serviceItems": {
        if (!Array.isArray(value)) { add(errors, field, "Invalid services."); break; }
        value.forEach((item: any, i: number) => {
          const n = `Service ${i + 1}`;
          const s = item?.structuredServiceItem, f = item?.freeFormServiceItem;
          if (!!s === !!f) { add(errors, field, `${n}: pick a Google service type or enter a custom name — not both.`); return; }
          if (s) {
            if (typeof s.serviceTypeId !== "string" || !s.serviceTypeId) add(errors, field, `${n}: missing service type.`);
            if (s.description !== undefined && (typeof s.description !== "string" || s.description.length > LIMITS.structuredServiceDescription)) add(errors, field, `${n}: description up to ${LIMITS.structuredServiceDescription} characters.`);
          } else {
            if (typeof f.category !== "string" || !CATEGORY_NAME.test(f.category)) add(errors, field, `${n}: a custom service belongs to one of your categories.`);
            const label = f.label;
            if (typeof label?.displayName !== "string" || !label.displayName.trim()) add(errors, field, `${n}: a custom service needs a name.`);
            else if (label.displayName.length > LIMITS.freeFormServiceName) add(warnings, field, `${n}: Google recommends names of ${LIMITS.freeFormServiceName} characters or less.`);
            if (label?.description !== undefined && (typeof label.description !== "string")) add(errors, field, `${n}: invalid description.`);
            else if (label?.description && label.description.length > LIMITS.freeFormServiceDescription) add(warnings, field, `${n}: Google recommends descriptions of ${LIMITS.freeFormServiceDescription} characters or less.`);
          }
          const price = item.price;
          if (price !== undefined) {
            if (typeof price?.currencyCode !== "string" || !/^[A-Z]{3}$/.test(price.currencyCode)) add(errors, field, `${n}: price needs a 3-letter currency code (USD).`);
            if (price.units !== undefined && !/^\d{1,12}$/.test(String(price.units))) add(errors, field, `${n}: price must be a whole number of dollars plus cents.`);
            if (price.nanos !== undefined && (!Number.isInteger(price.nanos) || price.nanos < 0 || price.nanos > 999_999_999)) add(errors, field, `${n}: invalid cents.`);
          }
        });
        break;
      }
    }
  }
  return { errors, warnings };
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/* ── Attributes (locations.updateAttributes) ────────────────────────────────── */

export type AttributeValueType = "BOOL" | "ENUM" | "URL" | "REPEATED_ENUM";
export type AttributeValue = {
  /** attributes/{attribute}, exactly as the metadata's `parent` names it. */
  name: string;
  valueType: AttributeValueType;
  values?: any[];
  uriValues?: { uri: string }[];
  repeatedEnumValue?: { setValues?: string[]; unsetValues?: string[] };
};
export const ATTRIBUTE_NAME = /^attributes\/[\w.-]+$/;

const writableAttribute = (a: AttributeValue) => ({
  valueType: a.valueType,
  values: a.values?.length ? a.values : undefined,
  uriValues: a.uriValues?.length ? a.uriValues.map((u) => ({ uri: u.uri })) : undefined,
  repeatedEnumValue: a.repeatedEnumValue && ((a.repeatedEnumValue.setValues?.length ?? 0) + (a.repeatedEnumValue.unsetValues?.length ?? 0)) ? a.repeatedEnumValue : undefined,
});

/**
 * Google's attributeMask contract: every attribute to update is in the mask AND in `attributes`; an
 * attribute to delete is in the mask with no entry in `attributes`. Only attributes that changed go in.
 */
export function buildAttributeMask(original: AttributeValue[], draft: AttributeValue[]): { attributeMask: string[]; attributes: AttributeValue[] } {
  const before = new Map(original.map((a) => [a.name, a]));
  const after = new Map(draft.map((a) => [a.name, a]));
  const attributeMask: string[] = [], attributes: AttributeValue[] = [];
  for (const [name, a] of after) {
    const cleared = !writableAttribute(a).values && !writableAttribute(a).uriValues && !writableAttribute(a).repeatedEnumValue;
    if (cleared) { if (before.has(name)) attributeMask.push(name); continue; }
    if (before.has(name) && same(writableAttribute(before.get(name)!), writableAttribute(a))) continue;
    attributeMask.push(name);
    attributes.push({ name, ...writableAttribute(a) } as AttributeValue);
  }
  for (const name of before.keys()) if (!after.has(name)) attributeMask.push(name);
  return { attributeMask, attributes };
}

export function validateAttributes(attributes: AttributeValue[]): FieldIssues {
  const errors: FieldIssues = {};
  for (const a of attributes) {
    if (typeof a?.name !== "string" || !ATTRIBUTE_NAME.test(a.name)) { add(errors, String(a?.name ?? "attribute"), "Unknown attribute."); continue; }
    switch (a.valueType) {
      case "BOOL": if (!Array.isArray(a.values) || a.values.length !== 1 || typeof a.values[0] !== "boolean") add(errors, a.name, "Yes or No."); break;
      case "ENUM": if (!Array.isArray(a.values) || a.values.length !== 1 || typeof a.values[0] !== "string" || !a.values[0]) add(errors, a.name, "Pick one of Google's values."); break;
      case "URL":
        if (!Array.isArray(a.uriValues) || !a.uriValues.length || a.uriValues.some((u) => typeof u?.uri !== "string" || !/^https?:\/\/\S+$/.test(u.uri))) add(errors, a.name, "Enter a full web address starting with http:// or https://.");
        break;
      case "REPEATED_ENUM": {
        const set = a.repeatedEnumValue?.setValues ?? [], unset = a.repeatedEnumValue?.unsetValues ?? [];
        if (!set.length && !unset.length) add(errors, a.name, "At least one value must be set or unset.");
        if (set.some((v) => unset.includes(v))) add(errors, a.name, "A value cannot be both set and unset.");
        break;
      }
      default: add(errors, a.name, "Unsupported attribute type.");
    }
  }
  return errors;
}

/* ── Small helpers the editor and the preview share ─────────────────────────── */

/** Adds UTM parameters to a website URL without disturbing what is already there. */
export function withUtm(url: string, utm: { source?: string; medium?: string; campaign?: string }): string {
  const u = new URL(url);
  if (utm.source) u.searchParams.set("utm_source", utm.source);
  if (utm.medium) u.searchParams.set("utm_medium", utm.medium);
  if (utm.campaign) u.searchParams.set("utm_campaign", utm.campaign);
  return u.toString();
}

/** A Money value from a decimal string ("149.50") — units + nanos, as the API wants. Null when not a price. */
export function moneyFromDecimal(text: string, currencyCode = "USD"): { currencyCode: string; units: string; nanos?: number } | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return { currencyCode, units: m[1], ...(cents ? { nanos: cents * 10_000_000 } : {}) };
}
export function decimalFromMoney(price: { units?: string | number; nanos?: number } | undefined): string {
  if (!price) return "";
  const units = Number(price.units ?? 0), cents = Math.round((price.nanos ?? 0) / 10_000_000);
  return cents ? `${units}.${String(cents).padStart(2, "0")}` : String(units);
}
