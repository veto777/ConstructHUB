/**
 * Cross-reference every client against the lead forms, the HOVER jobs and the HouseCall Pro estimate addresses, so
 * each one has a real name and an address (owner, 2026-10-18).
 *
 *   npx tsx --env-file=.env scripts/crossref-clients.ts --org=<orgId> --hover-names=<names.json> [--apply] [--out=report.json]
 *
 * Sources, by trust:
 *   1. lead forms (crm_leads) — typed by the client, so their spelling wins: linked to the client, else at the same
 *      street address (house number + normalized street), else the same email/phone pointing at exactly one client;
 *   2. the HOVER job (name written by whoever ordered the capture — often misspelled), from <names.json>
 *      ([{ customerId, measurementId, jobId, name }], GET /api/v3/jobs/:id);
 *   3. the HouseCall Pro estimate address (crm_estimates.custom_fields.hcpAddress) for a client with no address.
 * What it changes:
 *   - a client named by its street (a HOVER placeholder) or with no usable name takes the form's name, else the
 *     HOVER job's name; a real name already on a client is never replaced;
 *   - a client without an address takes the form's, else its HOVER capture's, else its HCP estimate's;
 *   - a client without email/phone takes them from a form matched by link or address (never from a contact match);
 *   - a HOVER placeholder whose street address is ONE existing named client's merges into that client (captures,
 *     photos and report move; the placeholder is archived).
 * Without --apply nothing is written; the report lists every proposed change with its source.
 */
import fs from "fs";

const arg = (f: string) => process.argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);
const ORG = arg("--org");
const NAMES = arg("--hover-names");
const APPLY = process.argv.includes("--apply");
const OUT = arg("--out") ?? `crossref-${Date.now()}.json`;
if (!ORG || !NAMES) { console.error("--org and --hover-names are required"); process.exit(1); }

const { pool } = await import("../server/db");

// ── Pure helpers ────────────────────────────────────────────────────────────
const SUFFIX: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", drive: "dr", road: "rd", lane: "ln", court: "ct", place: "pl",
  boulevard: "blvd", circle: "cir", terrace: "ter", highway: "hwy", parkway: "pkwy", way: "way", trail: "trl",
  north: "n", south: "s", east: "e", west: "w", northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se",
};
/** "1718 Humboldt Street, Bellingham" → "1718 humboldt st" (house number + street, no city/unit). */
export function streetKey(line1?: string | null): string | null {
  const first = String(line1 ?? "").split(",")[0].toLowerCase().replace(/[.#]/g, " ").replace(/\b(apt|unit|suite|ste)\b.*$/, "");
  const words = first.split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] ?? w);
  if (words.length < 2 || !/^\d+[a-z]?$/.test(words[0])) return null;
  return words.join(" ");
}
const zip5 = (z?: string | null) => (String(z ?? "").match(/\d{5}/)?.[0] ?? null);
const digits10 = (p?: string | null) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
const emailKey = (e?: string | null) => (e && e.includes("@") ? e.trim().toLowerCase() : null);
/** A usable person/company name: not empty, not a street address, not a placeholder. */
export function usableName(n?: string | null): string | null {
  const s = String(n ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || /^(n\/?a|na|none|unknown|test|hover import)( n\/?a)?$/i.test(s)) return null;
  if (streetKey(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}\b/.test(s)) return null; // "2025-01-24 Vanderbilt …" is a job label, not a person
  return s;
}
/** "2320 Queen St, Bellingham, WA 98229" → parts (best effort; never invents a value). */
function parseAddress(a?: string | null) {
  const parts = String(a ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length || !streetKey(parts[0])) return null;
  const tail = parts.slice(1).join(" ");
  const st = tail.match(/\b([A-Z]{2})\b(?=\s*\d{5}|\s*$)/)?.[1] ?? null;
  return { addressLine1: parts[0], city: parts[1] && !/^\w{2}\s*\d{5}/.test(parts[1]) ? parts[1].replace(/\s+[A-Z]{2}(\s+\d{5})?$/, "").trim() || null : null, state: st, postalCode: zip5(tail) };
}
const titleCase = (s: string) => (s === s.toLowerCase() || s === s.toUpperCase() ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// ── Load ────────────────────────────────────────────────────────────────────
const q = async <T = any>(sql: string, p: any[] = []) => (await pool.query(sql, p)).rows as T[];
const customers = await q(`select id, display_name, email, phone, address_line1, city, state, postal_code, custom_fields
  from crm_customers where org_id = $1 and archived_at is null`, [ORG]);
const leads = await q(`select id, customer_id, name, email, phone, address_line1, city, state, postal_code, received_at
  from crm_leads where org_id = $1 order by received_at desc`, [ORG]);
const measurements = await q(`select id, customer_id, external_id, address_line1, city, state, postal_code, raw_payload->>'pdfAttachmentId' pdf
  from crm_measurements where org_id = $1 and provider = 'hover'`, [ORG]);
const hcpAddr = await q(`select customer_id, custom_fields->>'hcpAddress' a from crm_estimates
  where org_id = $1 and coalesce(custom_fields->>'hcpAddress', '') <> '' order by created_at desc`, [ORG]);
const hoverNames: { customerId: string | null; measurementId: string; jobId: string; name: string | null }[] = JSON.parse(fs.readFileSync(NAMES, "utf8"));

const isPlaceholder = (c: any) => {
  const f = c.custom_fields ?? {};
  return !usableName(c.display_name) || (!!f.hoverAutoCreated && streetKey(c.display_name) !== null);
};
const leadsByCustomer = new Map<string, any[]>();
const leadsByStreet = new Map<string, any[]>();
const leadsByEmail = new Map<string, any[]>();
const leadsByPhone = new Map<string, any[]>();
const push = (m: Map<string, any[]>, k: string | null, v: any) => { if (k) m.set(k, [...(m.get(k) ?? []), v]); };
for (const l of leads) {
  push(leadsByCustomer, l.customer_id, l);
  push(leadsByStreet, streetKey(l.address_line1), l);
  push(leadsByEmail, emailKey(l.email), l);
  push(leadsByPhone, digits10(l.phone), l);
}
const clientsByEmail = new Map<string, string[]>();
const clientsByPhone = new Map<string, string[]>();
const namedByStreet = new Map<string, any[]>();
for (const c of customers) {
  push(clientsByEmail as any, emailKey(c.email), c.id);
  push(clientsByPhone as any, digits10(c.phone), c.id);
  if (!isPlaceholder(c)) push(namedByStreet, streetKey(c.address_line1), c);
}
const measByCustomer = new Map<string, any[]>();
for (const m of measurements) push(measByCustomer, m.customer_id, m);
const hoverNameByMeasurement = new Map(hoverNames.map((h) => [h.measurementId, usableName(h.name)]));
const hcpAddrByCustomer = new Map<string, string>();
for (const r of hcpAddr) if (!hcpAddrByCustomer.has(r.customer_id)) hcpAddrByCustomer.set(r.customer_id, r.a);

/** A form agrees with a client when it is linked, or sits at the same street (same ZIP when both have one). */
function formsFor(c: any): { lead: any; via: string }[] {
  const out: { lead: any; via: string }[] = [];
  const seen = new Set<string>();
  const add = (l: any, via: string) => { if (!seen.has(l.id)) { seen.add(l.id); out.push({ lead: l, via }); } };
  for (const l of leadsByCustomer.get(c.id) ?? []) add(l, "linked form");
  const keys = [streetKey(c.address_line1), ...(measByCustomer.get(c.id) ?? []).map((m) => streetKey(m.address_line1))].filter(Boolean) as string[];
  const zips = new Set([zip5(c.postal_code), ...(measByCustomer.get(c.id) ?? []).map((m) => zip5(m.postal_code))].filter(Boolean));
  for (const k of keys) for (const l of leadsByStreet.get(k) ?? []) {
    const z = zip5(l.postal_code);
    if (z && zips.size && !zips.has(z)) continue;
    add(l, "form at the same address");
  }
  // Contact: only a form whose email/phone points at exactly this one client.
  const e = emailKey(c.email), p = digits10(c.phone);
  if (e && (clientsByEmail.get(e) ?? []).length === 1) for (const l of leadsByEmail.get(e) ?? []) add(l, "form with the same email");
  if (p && (clientsByPhone.get(p) ?? []).length === 1) for (const l of leadsByPhone.get(p) ?? []) add(l, "form with the same phone");
  return out;
}

// ── Decide ──────────────────────────────────────────────────────────────────
type Change = { customerId: string; was: string; set: Record<string, string | null>; sources: Record<string, string>; mergeInto?: { id: string; name: string } };
const changes: Change[] = [];
for (const c of customers) {
  const forms = formsFor(c);
  const set: Record<string, string | null> = {};
  const sources: Record<string, string> = {};
  const placeholder = isPlaceholder(c);

  if (placeholder) {
    // A placeholder at ONE named client's street is that client.
    const twins = [streetKey(c.address_line1)].filter(Boolean).flatMap((k) => namedByStreet.get(k!) ?? [])
      .filter((d) => d.id !== c.id && (!zip5(d.postal_code) || !zip5(c.postal_code) || zip5(d.postal_code) === zip5(c.postal_code)));
    if (twins.length === 1) {
      changes.push({ customerId: c.id, was: c.display_name, set: {}, sources: { merge: "a named client at the same address" }, mergeInto: { id: twins[0].id, name: twins[0].display_name } });
      continue;
    }
    const formName = forms.map((f) => usableName(f.lead.name)).find(Boolean);
    const hoverName = (measByCustomer.get(c.id) ?? []).map((m) => hoverNameByMeasurement.get(m.id)).find(Boolean);
    if (formName) { set.display_name = titleCase(formName); sources.display_name = forms.find((f) => usableName(f.lead.name))!.via + (hoverName ? ` (HOVER says "${hoverName}")` : ""); }
    else if (hoverName) { set.display_name = titleCase(hoverName); sources.display_name = "HOVER job name"; }
  }
  if (!c.address_line1) {
    const f = forms.find((x) => streetKey(x.lead.address_line1));
    const m = (measByCustomer.get(c.id) ?? []).find((x) => streetKey(x.address_line1));
    const h = parseAddress(hcpAddrByCustomer.get(c.id));
    const pick = f ? { addressLine1: f.lead.address_line1, city: f.lead.city, state: f.lead.state, postalCode: f.lead.postal_code, src: f.via }
      : m ? { addressLine1: m.address_line1, city: m.city, state: m.state, postalCode: m.postal_code, src: "HOVER capture" }
      : h ? { ...h, src: "HouseCall Pro estimate" } : null;
    if (pick) {
      // A form often carries the whole address in one line ("5590 Starry Rd.\r\nBellingham, WA 98226"): split it.
      const whole = pick.city ? null : parseAddress(String(pick.addressLine1).replace(/[\r\n]+/g, ", "));
      set.address_line1 = whole?.addressLine1 ?? String(pick.addressLine1).split(/[\r\n,]/)[0].trim();
      set.city = pick.city ?? whole?.city ?? null; set.state = pick.state ?? whole?.state ?? null; set.postal_code = pick.postalCode ?? whole?.postalCode ?? null;
      sources.address = pick.src;
    }
  }
  const trusted = forms.filter((f) => f.via === "linked form" || f.via === "form at the same address");
  if (!c.email) { const f = trusted.find((x) => emailKey(x.lead.email)); if (f) { set.email = f.lead.email.trim(); sources.email = f.via; } }
  if (!c.phone) { const f = trusted.find((x) => digits10(x.lead.phone)); if (f) { set.phone = f.lead.phone.trim(); sources.phone = f.via; } }
  if (Object.keys(set).length) changes.push({ customerId: c.id, was: c.display_name, set, sources });
}

const summary = {
  clients: customers.length,
  renamed: changes.filter((x) => x.set.display_name).length,
  renamedFromForms: changes.filter((x) => x.sources.display_name && !x.sources.display_name.startsWith("HOVER")).length,
  addressesFilled: changes.filter((x) => x.set.address_line1).length,
  emailsFilled: changes.filter((x) => x.set.email).length,
  phonesFilled: changes.filter((x) => x.set.phone).length,
  merges: changes.filter((x) => x.mergeInto).length,
  stillPlaceholders: customers.filter((c) => isPlaceholder(c) && !changes.some((x) => x.customerId === c.id && (x.set.display_name || x.mergeInto))).length,
  stillNoAddress: customers.filter((c) => !c.address_line1 && !changes.some((x) => x.customerId === c.id && x.set.address_line1)).length,
};
fs.writeFileSync(OUT, JSON.stringify({ summary, changes }, null, 1));
console.log(summary);

// ── Apply ───────────────────────────────────────────────────────────────────
if (APPLY) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const ch of changes) {
      if (ch.mergeInto) {
        const to = ch.mergeInto.id;
        await client.query(`update crm_measurements set customer_id = $1, updated_at = now() where org_id = $2 and customer_id = $3`, [to, ORG, ch.customerId]);
        await client.query(`update crm_attachments set ref_id = $1 where org_id = $2 and ref_id = $3 and kind in ('photo','measurement')`, [to, ORG, ch.customerId]);
        await client.query(`update crm_projects set customer_id = $1 where org_id = $2 and customer_id = $3`, [to, ORG, ch.customerId]);
        await client.query(`update crm_customers set archived_at = now(), custom_fields = coalesce(custom_fields, '{}') || jsonb_build_object('mergedInto', $1::text) where id = $2`, [to, ch.customerId]);
        continue;
      }
      const cols = Object.keys(ch.set);
      await client.query(`update crm_customers set ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now(),
        custom_fields = coalesce(custom_fields, '{}') || jsonb_build_object('crossref', $${cols.length + 2}::jsonb)
        where id = $1`, [ch.customerId, ...cols.map((k) => ch.set[k]), JSON.stringify({ at: new Date().toISOString(), was: ch.was, sources: ch.sources })]);
    }
    await client.query("commit");
    console.log(`applied ${changes.length} changes`);
  } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
}
process.exit(0);
