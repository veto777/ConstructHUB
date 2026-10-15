/**
 * Paged reads of whole city and county datasets for ../local.ts bulk sources: a Socrata dataset through its SODA
 * resource endpoint, and an ArcGIS feature-service layer or table through its query API. One request at a time per
 * host (politeFetch), the rows in the publisher's own field names.
 */
import { politeFetch, sleep } from "../../http";
import { clean } from "../../bulk";

type Row = Record<string, unknown>;

/** Every row of a SODA resource matching `where`, 50,000 at a time in a stable order. */
export async function* sodaAll(url: string, where?: string, pageSize = 50_000): AsyncIterable<Row> {
  for (let offset = 0; ; offset += pageSize) {
    const q = new URL(url);
    if (where) q.searchParams.set("$where", where);
    q.searchParams.set("$order", ":id");
    q.searchParams.set("$limit", String(pageSize));
    q.searchParams.set("$offset", String(offset));
    const res = await politeFetch(q.toString(), { headers: { Accept: "application/json" } }, { minDelayMs: 1000, timeoutMs: 180_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`unexpected payload from ${url}`);
    yield* rows as Row[];
    if (rows.length < pageSize) return;
  }
}

/** Every feature of an ArcGIS layer (".../FeatureServer/0") matching `where`, in object-id order, attributes only. */
export async function* arcgisAll(layerUrl: string, where = "1=1", outFields = "*", pageSize = 2000): AsyncIterable<Row> {
  const meta = await (await politeFetch(`${layerUrl}?f=json`, { headers: { Accept: "application/json" } }, { minDelayMs: 1000 })).json();
  if (meta?.error) throw new Error(`ArcGIS layer error: ${JSON.stringify(meta.error).slice(0, 200)}`);
  const oid: string = meta?.objectIdField ?? meta?.fields?.find((f: any) => f.type === "esriFieldTypeOID")?.name ?? "OBJECTID";
  const size = Math.min(pageSize, Number(meta?.maxRecordCount) || pageSize);
  for (let offset = 0; ; offset += size) {
    const body = new URLSearchParams({
      where, outFields, returnGeometry: "false", orderByFields: `${oid} ASC`,
      resultOffset: String(offset), resultRecordCount: String(size), f: "json",
    });
    // A hosted layer now and then answers one page with a transient 400 or 5xx: try that page again before giving up.
    let page: any = null;
    for (let attempt = 0; ; attempt++) {
      const res = await politeFetch(`${layerUrl}/query`, {
        method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      }, { minDelayMs: 1000, timeoutMs: 120_000 });
      page = res.ok ? await res.json().catch(() => null) : null;
      if (page && !page.error) break;
      if (attempt >= 3) throw new Error(res.ok ? `ArcGIS query error at offset ${offset}: ${JSON.stringify(page?.error ?? page).slice(0, 200)}` : `HTTP ${res.status} for ${layerUrl}`);
      await sleep(5000 * (attempt + 1));
    }
    const feats: { attributes: Row }[] = page?.features ?? [];
    for (const f of feats) yield f.attributes;
    if (!feats.length || (feats.length < size && !page.exceededTransferLimit)) return;
  }
}

/** A field as trimmed text (null when empty). */
export const txt = (r: Row, k: string): string | null => clean(r[k] == null ? null : String(r[k]));

/** An ISO date, an ArcGIS epoch-milliseconds date or MM/DD/YYYY, as YYYY-MM-DD. */
export function isoDay(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Street, city, state and ZIP joined into one address line ("12 MAIN ST, BRONX, NY 10462"); null without a street. */
export function addressLine(street: (string | null)[], city: string | null, state: string | null, zip: string | null): string | null {
  const s = clean(street.filter(Boolean).join(" "));
  if (!s) return null;
  return [s, city, clean([state, zip].filter(Boolean).join(" "))].filter(Boolean).join(", ");
}

/** "FIRST MIDDLE LAST" from its parts. */
export const fullName = (...parts: (string | null | undefined)[]): string | null => clean(parts.filter(Boolean).join(" "));
