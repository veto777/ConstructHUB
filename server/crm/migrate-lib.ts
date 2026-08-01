/**
 * Migration center — the pure half: CSV/TSV parsing (papaparse-style quoting,
 * no dependency), header auto-mapping for the common Jobber / QuickBooks /
 * Leap / Excel export shapes, money-to-integer-cents, and external status
 * vocabularies mapped onto the CRM's.
 *
 * Kept free of server imports (db, stripe, email) so migrate.test.ts can pin
 * every function here without environment setup — the same split as
 * formula.ts / formula.test.ts.
 */

// Hard caps. A migration file is a few thousand rows of text; anything bigger
// is the assisted path's job, not a JSON body's.
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5000;

// ── CSV / TSV parsing ───────────────────────────────────────────────────────

export interface ParsedCsv {
  headers: string[];
  /** Data rows as raw string cells, aligned with headers (short rows padded). */
  rows: string[][];
}

/**
 * RFC-4180-style parser: quoted fields may hold commas, tabs, quotes ("")
 * and newlines. The delimiter is auto-detected from the first line — Excel
 * "tab delimited" exports are the other half of the world.
 */
export function parseCsv(text: string): ParsedCsv {
  // Strip a BOM; Excel writes one and it silently poisons the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? "\t" : ",";

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldStarted = false; // distinguishes a quoted empty field from EOF mid-record

  const pushField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (c === delim) {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  // Trailing field/record (file not ending in a newline).
  if (field !== "" || fieldStarted || record.length) pushRecord();

  // Drop fully-blank records (trailing newline already handled above; this is
  // the "empty lines between sections" some exporters emit).
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });
  return { headers, rows };
}

// ── Column auto-mapping ─────────────────────────────────────────────────────

export interface MigrateField {
  key: string;
  label: string;
  /** Header spellings seen in Jobber, QuickBooks, Leap and plain-Excel exports. */
  aliases: string[];
}

export const MIGRATE_ENTITIES = ["customers", "estimates", "invoices"] as const;
export type MigrateEntity = (typeof MIGRATE_ENTITIES)[number];

export const MIGRATE_FIELDS: Record<MigrateEntity, MigrateField[]> = {
  customers: [
    { key: "displayName", label: "Name", aliases: ["name", "full name", "customer name", "client name", "display name", "customer", "client", "contact name"] },
    { key: "firstName", label: "First name", aliases: ["first name", "first", "given name"] },
    { key: "lastName", label: "Last name", aliases: ["last name", "last", "surname", "family name"] },
    { key: "companyName", label: "Company", aliases: ["company", "company name", "business", "business name", "organization", "organisation"] },
    { key: "email", label: "Email", aliases: ["email", "e-mail", "email address", "main email", "primary email"] },
    { key: "phone", label: "Phone", aliases: ["phone", "phone number", "main phone", "primary phone", "mobile", "cell", "telephone"] },
    { key: "altPhone", label: "Alt phone", aliases: ["alt phone", "alternate phone", "secondary phone", "other phone", "work phone", "home phone"] },
    { key: "addressLine1", label: "Address", aliases: ["address", "address 1", "address1", "address line 1", "street", "street address", "service address", "billing address", "bill to 1"] },
    { key: "city", label: "City", aliases: ["city", "town"] },
    { key: "state", label: "State", aliases: ["state", "st", "province", "region"] },
    { key: "postalCode", label: "Zip / postal code", aliases: ["zip", "zip code", "zipcode", "postal code", "postcode"] },
    { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"] },
  ],
  estimates: [
    { key: "customerName", label: "Customer name", aliases: ["customer", "customer name", "client", "client name", "name"] },
    { key: "customerEmail", label: "Customer email", aliases: ["customer email", "client email", "email"] },
    { key: "title", label: "Title", aliases: ["title", "estimate title", "estimate name", "description", "subject", "job name"] },
    { key: "number", label: "Estimate #", aliases: ["number", "estimate number", "estimate #", "estimate no", "quote number", "quote #", "#"] },
    { key: "status", label: "Status", aliases: ["status", "estimate status", "state"] },
    { key: "total", label: "Total", aliases: ["total", "total amount", "amount", "estimate total", "grand total"] },
  ],
  invoices: [
    { key: "customerName", label: "Customer name", aliases: ["customer", "customer name", "client", "client name", "name"] },
    { key: "customerEmail", label: "Customer email", aliases: ["customer email", "client email", "email"] },
    { key: "title", label: "Title", aliases: ["title", "invoice title", "description", "subject", "job name"] },
    { key: "number", label: "Invoice #", aliases: ["number", "invoice number", "invoice #", "invoice no", "#"] },
    { key: "status", label: "Status", aliases: ["status", "invoice status", "state"] },
    { key: "total", label: "Total", aliases: ["total", "total amount", "amount", "invoice total", "grand total", "balance"] },
    { key: "paid", label: "Amount paid", aliases: ["paid", "amount paid", "paid amount", "payments", "amount received"] },
  ],
};

/** Normalize a header for matching: lowercase, collapse whitespace/punctuation. */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-./()]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-guess field → header mapping. Exact alias hit wins; a unique prefix
 * match ("Customer Email Address") is the fallback. Never maps two fields to
 * the same column.
 */
export function guessMapping(entity: MigrateEntity, headers: string[]): Record<string, string | null> {
  const fields = MIGRATE_FIELDS[entity];
  const normed = headers.map(normHeader);
  const used = new Set<number>();
  const mapping: Record<string, string | null> = {};

  for (const f of fields) {
    let hit = -1;
    const aliases = f.aliases.map(normHeader);
    for (let i = 0; i < normed.length; i++) {
      if (used.has(i)) continue;
      if (aliases.includes(normed[i])) { hit = i; break; }
    }
    if (hit === -1) {
      const candidates = normed
        .map((h, i) => ({ h, i }))
        .filter(({ h, i }) => !used.has(i) && aliases.some((a) => h.startsWith(a) || a.startsWith(h)));
      if (candidates.length === 1) hit = candidates[0].i;
    }
    if (hit !== -1) {
      used.add(hit);
      mapping[f.key] = headers[hit];
    } else {
      mapping[f.key] = null;
    }
  }
  return mapping;
}

/** Apply a field → header mapping to one raw row, producing field → value. */
export function applyMapping(
  mapping: Record<string, string | null>,
  headers: string[],
  row: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const idx = headers.indexOf(header);
    if (idx === -1) continue;
    out[field] = (row[idx] ?? "").trim();
  }
  return out;
}

// ── Value parsing + status mapping ──────────────────────────────────────────

/** "$12,345.67" → 1234567. Returns null when the cell isn't money. */
export function parseMoneyToCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Accounting negatives: (1,234.56)
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/** External status vocabularies → CRM_ESTIMATE_STATUSES. */
export function mapEstimateStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (["sent", "viewed", "open", "pending", "awaiting response", "awaiting approval", "in review"].includes(s)) return "sent";
  if (["approved", "accepted", "won", "converted", "paid", "complete", "completed"].includes(s)) return "approved";
  if (["declined", "rejected", "lost"].includes(s)) return "declined";
  if (["cancelled", "canceled", "void", "archived"].includes(s)) return "cancelled";
  return "draft";
}

/** External status vocabularies → CRM_INVOICE_STATUSES. */
export function mapInvoiceStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (["sent", "open", "unpaid", "overdue", "due", "awaiting payment", "viewed"].includes(s)) return "sent";
  if (["partial", "partially paid", "partial paid", "part paid"].includes(s)) return "partial";
  if (["paid", "closed", "settled"].includes(s)) return "paid";
  if (["void", "voided", "cancelled", "canceled"].includes(s)) return "void";
  if (["uncollectible", "bad debt", "written off", "write off"].includes(s)) return "uncollectible";
  return "draft";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Row-level validation, entity-aware. Returns human-readable problems. */
export function validateRecord(entity: MigrateEntity, rec: Record<string, string>): string[] {
  const errors: string[] = [];
  if (entity === "customers") {
    const hasName = Boolean(
      rec.displayName || rec.companyName || (rec.firstName ?? "").trim() || (rec.lastName ?? "").trim(),
    );
    if (!hasName) errors.push("no name (need a name, company, or first/last name)");
    if (rec.email && !EMAIL_RE.test(rec.email)) errors.push(`invalid email "${rec.email}"`);
  } else {
    if (!rec.customerName && !rec.customerEmail) {
      errors.push("no customer (need a customer name or email to attach this to)");
    }
    if (rec.total && parseMoneyToCents(rec.total) === null) {
      errors.push(`total "${rec.total}" is not a number`);
    }
    if (entity === "invoices" && rec.paid && parseMoneyToCents(rec.paid) === null) {
      errors.push(`amount paid "${rec.paid}" is not a number`);
    }
  }
  return errors;
}
