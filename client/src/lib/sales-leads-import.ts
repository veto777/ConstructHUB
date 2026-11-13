/**
 * Lead files for the Sales Agents import (/admin/sales-agents/leads): a CSV with a header row or a JSON list
 * (a bare array, or {source?, leads:[…]}), parsed in the browser and mapped onto the engine's lead fields.
 * Common column names are understood (phone / phone_number / tel, business / name / company, …).
 */

export type ImportLead = {
  phone: string;
  business?: string;
  trade?: string;
  city?: string;
  state?: string;
  website?: string;
  email?: string;
  contact_name?: string;
};

type Field = keyof ImportLead;

/** Normalised column name → lead field. */
const COLUMN_ALIASES: Record<string, Field> = {
  phone: "phone", phone_number: "phone", phonenumber: "phone", tel: "phone", telephone: "phone", phone_no: "phone", number: "phone",
  business: "business", name: "business", company: "business", business_name: "business", company_name: "business",
  trade: "trade", category: "trade",
  city: "city",
  state: "state",
  website: "website", url: "website", site: "website", web: "website",
  email: "email", e_mail: "email", email_address: "email",
  contact: "contact_name", owner: "contact_name", contact_name: "contact_name", owner_name: "contact_name",
};

export const normaliseColumn = (h: string): string => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export const leadFieldFor = (column: string): Field | undefined => COLUMN_ALIASES[normaliseColumn(column)];

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** One record (CSV row as an object, or a JSON object) → a lead, or null without a phone. */
export function toLead(record: Record<string, unknown>): ImportLead | null {
  const lead: Partial<ImportLead> = {};
  for (const [key, raw] of Object.entries(record)) {
    const f = leadFieldFor(key);
    if (!f || lead[f]) continue;
    const v = raw == null ? "" : String(raw).trim();
    if (v) lead[f] = v;
  }
  return lead.phone ? (lead as ImportLead) : null;
}

export type ParsedLeads = { leads: ImportLead[]; skipped: number; source?: string; columns: string[] };

/** Parse a file's text. `name` decides CSV vs JSON (JSON also when the text starts with [ or {). */
export function parseLeadFile(name: string, text: string): ParsedLeads {
  const trimmed = text.trim();
  const json = /\.json$/i.test(name) || trimmed.startsWith("[") || trimmed.startsWith("{");
  if (json) {
    const data = JSON.parse(trimmed);
    const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.leads) ? data.leads : [];
    const leads: ImportLead[] = [];
    let skipped = 0;
    for (const item of list) {
      const lead = item && typeof item === "object" ? toLead(item as Record<string, unknown>) : null;
      if (lead) leads.push(lead); else skipped++;
    }
    const columns = list[0] && typeof list[0] === "object" ? Object.keys(list[0] as object) : [];
    return { leads, skipped, source: typeof data?.source === "string" ? data.source : undefined, columns };
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return { leads: [], skipped: 0, columns: [] };
  const header = rows[0].map((h) => h.trim());
  const leads: ImportLead[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ""; });
    const lead = toLead(rec);
    if (lead) leads.push(lead); else skipped++;
  }
  return { leads, skipped, columns: header };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
