/**
 * The acceptance run's recall check (script/research-acceptance.ts), on its own so it can be tested without running
 * the script.
 */
import type { LicenseHit, ResearchSubjectReport } from "@shared/research-reports";
import { personNamed } from "../../server/research/xref";
import type { Golden } from "./pick";

export const norm = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};
/**
 * Whether the report holds the golden record, as the subject's own (round 8, finding 8: by the record's own source and
 * record id, never a number alone). A license: the same source and license number, and the same holder (the business
 * name, or the named person); a record the publisher gives no number is matched by its source and name. An
 * enforcement record: the same source, the same id when the golden record has one, and the same name.
 */
export function recall(g: Golden, s: ResearchSubjectReport): { found: boolean; where: string | null; issue: string | null } {
  const e = g.expected;
  if (e.kind === "license") {
    const holder = (h: LicenseHit) => e.matchedOn === "business" ? sameName(h.businessName, e.businessName)
      : [h.principal, ...(h.people ?? []).map((p) => p.name)].some((n) => sameName(n, e.person) || personNamed(e.person ?? "", h));
    const same = (h: LicenseHit) => h.source === e.source && (e.licenseNumber ? norm(h.licenseNumber) === norm(e.licenseNumber) : true) && holder(h);
    const own = s.licenses.find(same);
    if (own) {
      if (own.matchedOn !== e.matchedOn) return { found: true, where: `licenses (matched on ${own.matchedOn})`, issue: `found, but matched on "${own.matchedOn}", expected "${e.matchedOn}"` };
      return { found: true, where: `licenses: ${own.source}`, issue: null };
    }
    const rel = (s.relatedLicenses ?? []).find(same);
    if (rel) return { found: false, where: `related licenses (${rel.relatedVia ?? "?"})`, issue: `license ${e.licenseNumber} listed only as a related record (${rel.relatedVia ?? "no tie"}), not as the subject's own` };
    return { found: false, where: null, issue: `license ${e.licenseNumber ?? `"${e.businessName ?? e.person}" (no number published)`} (${e.source}) not in the report` };
  }
  if (e.kind === "enforcement") {
    const match = (h: { source: string; id: string | null; name: string | null }) =>
      h.source === e.source && (e.id ? norm(h.id) === norm(e.id) : true) && (sameName(h.name, e.name) || sameName(h.name, g.name));
    const own = (s.enforcement ?? []).find(match);
    if (own) {
      if (own.category !== e.category) return { found: true, where: `enforcement (${own.category})`, issue: `found under category "${own.category}", expected "${e.category}"` };
      return { found: true, where: `enforcement: ${own.source}`, issue: null };
    }
    const rel = (s.relatedEnforcement ?? []).find(match);
    if (rel) return { found: false, where: "related enforcement", issue: `record ${e.id ?? e.name} listed only as related (${rel.relatedVia ?? "no tie"})` };
    return { found: false, where: null, issue: `enforcement record ${e.id ?? ""} "${e.name}" (${e.source}, ${e.category}) not in the report` };
  }
  const own = (s.complaints ?? []).find((c) => c.source === e.source && ((e.id && c.id === e.id) || sameName(c.business, e.business)));
  return own ? { found: true, where: `complaints: ${own.source}`, issue: null } : { found: false, where: null, issue: `complaint ${e.id ?? ""} "${e.business}" (${e.source}) not in the report` };
}

