/**
 * Small HTML helpers shared by the g4 state packs (AL, MS, LA, AR, KY, OK), whose boards publish their records as
 * plain server-rendered HTML pages and tables rather than open data.
 */
import { decodeEntities } from "../../bulk-sources";
import { clean } from "../../bulk";

/** The visible text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed; "" → null. */
export const text = (v: string | null | undefined): string | null =>
  clean(decodeEntities((v ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

/** The cells of every <tr> in a fragment, as text (cells keep their order; empty cells are null). */
export function tableRows(html: string): (string | null)[][] {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => text(c[1])));
}

/** "LAST, FIRST M" → "FIRST M LAST" (anything else unchanged). */
export const flipName = (v: string | null): string | null => {
  const m = v?.match(/^([^,]+),\s*(.+)$/);
  return m ? clean(`${m[2]} ${m[1]}`) : clean(v);
};

/** Words that mark a name as a business rather than one person. */
const BUSINESS = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PLLC|ENTERPRISES?|CONSTRUCTION|CONTRACTORS?|CONTRACTING|SERVICES?|BUILDERS?|HOMES?|GROUP|ROOFING|ELECTRIC(AL)?|PLUMBING|MECHANICAL|HEATING|AIR|DEVELOPMENT|PROPERTIES|INDUSTRIES|SOLUTIONS|DBA|D\/B\/A)\b|&/i;

/** A licensee name written "LAST, FIRST" with no business words: the board's form for one person. */
export const isPersonName = (v: string | null): boolean => !!v && /^[^,]+,\s*\S/.test(v) && !BUSINESS.test(v);

/** A dollar amount in a sentence ("a civil penalty in the amount of $2,797.29") → 2797.29; none → null. */
export function firstAmount(v: string | null): number | null {
  const m = v?.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** The hidden and text inputs and selected options of an ASP.NET WebForms page, as the browser would post them. */
export function aspxFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input[^>]*>/g))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = (tag.match(/type="([^"]+)"/)?.[1] ?? "text").toLowerCase();
    if (!name || !["hidden", "text"].includes(type)) continue;
    form.set(decodeEntities(name), decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const m of Array.from(html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))) {
    const opt = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/) ?? m[2].match(/<option[^>]*value="([^"]*)"/);
    form.set(decodeEntities(m[1]), opt ? decodeEntities(opt[1]) : "");
  }
  return form;
}

/** The name=value pairs of a response's Set-Cookie headers, for the next request in the same session. */
export const cookiesOf = (res: Response): string => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
