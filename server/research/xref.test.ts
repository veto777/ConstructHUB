import { describe, expect, it } from "vitest";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { researchOrderSchema, researchTierFor } from "@shared/research-reports";
import { addressMatches, idWords, queryWords, type IdQuery } from "./identifiers";
import { tokens } from "./licenses";
import {
  businessCore, businessNamed, crossReference, LicenseSet, MAX_BUSINESSES_PER_TIE, MAX_ID_SEARCHES, nameMatches, personNamed, samePerson,
  searchCustomerIds, subjectIds,
  type LicenseFinder,
} from "./xref";

// ── A fake source: an in-memory license file indexed the way the bulk index is, so nothing touches the network ──
const lic = (o: Partial<LicenseHit> & Pick<LicenseHit, "licenseNumber">): LicenseHit => ({
  state: "FL", source: "Fake board", sourceUrl: "https://example.test/board", businessName: null, licenseType: null, specialty: null,
  status: "Current", principal: null, city: null, expires: null, matchedOn: "business", ...o,
});

function fakeFinder(rows: LicenseHit[], enforcement: EnforcementHit[] = [], label = "Fake board"): LicenseFinder & { calls: string[] } {
  const calls: string[] = [];
  const keysOf = (h: LicenseHit) => idWords({ licenses: [h.licenseNumber], phones: [h.phone], addresses: [h.address] });
  return {
    state: "FL", label, calls,
    byName: async (name, kind) => {
      calls.push(`${kind}:${name}`);
      const want = tokens(name);
      const hits = rows.filter((h) => kind === "company"
        ? want.every((w) => tokens(h.businessName ?? "").includes(w))
        // like the bulk index: every word among ALL people's words, so the caller must re-check
        : want.every((w) => [h.principal, ...(h.people ?? []).map((p) => p.name)].flatMap((v) => tokens(v ?? "")).includes(w)));
      return { hits: hits.filter((h) => nameMatches(name, kind, h)).map((h) => ({ ...h })), searched: true, note: `${hits.length}` };
    },
    byId: async (q: IdQuery) => {
      calls.push(`${q.type}:${q.value}`);
      const want = queryWords(q).filter((w) => !w.startsWith("z:"));
      if (!want.length) return { licenses: [], enforcement: [] };
      return {
        licenses: rows.filter((h) => want.every((w) => keysOf(h).includes(w))).map((h) => ({ ...h })),
        enforcement: enforcement.filter((e) => want.every((w) => idWords({ licenses: [e.licenseNumber], phones: [e.phone], addresses: [e.address] }).includes(w))),
      };
    },
  };
}

const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "FL", source: "Fake orders", sourceUrl: "https://example.test/orders", category: "stop_work", name: null, id: null, date: "2024-01-02",
  endDate: null, status: "Order", city: null, detail: null, amount: null, adverse: true, ...o,
});

// The world: Acme Electric (subject) has license EC100, phone 813-555-0101, at 12 Palm Ave. Jane Doe qualifies Acme and
// also Bright Solar (EC200). Bright Solar Pool Co (EC300) shares Acme's phone. Gulf Roofing (CGC400) shares Acme's address.
const ROWS: LicenseHit[] = [
  lic({ licenseNumber: "EC100", businessName: "ACME ELECTRIC LLC", phone: "(813) 555-0101", address: "12 Palm Ave, Tampa FL 33602",
    people: [{ name: "JANE DOE", role: "Qualifier" }] }),
  lic({ licenseNumber: "EC200", businessName: "BRIGHT SOLAR INC", phone: "727 555 0199", address: "900 Gulf Blvd, Clearwater FL 33767",
    people: [{ name: "JANE DOE", role: "Qualifier" }] }),
  lic({ licenseNumber: "EC300", businessName: "SUNNY POOL CO", phone: "813.555.0101", address: "5 Bay St, Tampa FL 33606" }),
  lic({ licenseNumber: "CGC400", businessName: "GULF ROOFING CORP", phone: "813 555 0444", address: "12 Palm Avenue Suite 3, Tampa FL 33602" }),
  // Two different people whose words together spell "JOHN DOE": the bulk index matches it; the re-check must not.
  lic({ licenseNumber: "EC500", businessName: "OTHER CO", people: [{ name: "JOHN SMITH", role: "Officer" }, { name: "MARY DOE", role: "Officer" }] }),
];

const noEnforcement = async () => ({ hits: [], sources: [] });

describe("order identifiers", () => {
  const base = { states: ["FL"], agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true };
  it("normalizes license numbers, phones and addresses, drops blanks and duplicates", () => {
    const r = researchOrderSchema.parse({ ...base, subjects: [{ name: "Acme Electric", kind: "company",
      licenseNumbers: ["ec 100", "", "EC 100"], phones: ["+1 813.555.0101", "  "], addresses: ["12  Palm Ave,  Tampa FL 33602"] }] });
    expect(r.subjects[0].licenseNumbers).toEqual(["EC 100"]);
    expect(r.subjects[0].phones).toEqual(["(813) 555-0101"]);
    expect(r.subjects[0].addresses).toEqual(["12 Palm Ave, Tampa FL 33602"]);
  });
  it("rejects values that are not identifiers, and too many of them", () => {
    const bad = (s: object) => researchOrderSchema.safeParse({ ...base, subjects: [{ name: "Acme", kind: "company", ...s }] });
    expect(bad({ phones: ["555-0101"] }).success).toBe(false);
    expect(bad({ licenseNumbers: ["ABC"] }).success).toBe(false);
    expect(bad({ addresses: ["Tampa FL"] }).success).toBe(false);
    expect(bad({ licenseNumbers: ["A1", "B2", "C3", "D4", "E5", "F6"].map((v) => `${v}00`) }).success).toBe(false);
    expect(bad({ phones: ["8135550101", "8135550102", "8135550103", "8135550104"] }).success).toBe(false);
  });
  it("keeps old orders (no identifiers) valid, and identifiers don't change the price", () => {
    const r = researchOrderSchema.parse({ ...base, subjects: [{ name: "Acme", kind: "company" }] });
    expect(r.subjects[0].licenseNumbers).toBeUndefined();
    expect(subjectIds(r.subjects[0])).toEqual([]);
    const withIds = researchOrderSchema.parse({ ...base, subjects: [{ name: "Acme", kind: "company", licenseNumbers: ["EC100", "EC200"], phones: ["8135550101"] }] });
    expect(researchTierFor(withIds.subjects.length, withIds.states.length)).toBe("standard");
  });
});

describe("person re-check", () => {
  it("needs every word in one person's name", () => {
    expect(personNamed("John Doe", ROWS[4])).toBe(false);
    expect(personNamed("Mary Doe", ROWS[4])).toBe(true);
    expect(personNamed("Jane Doe", { principal: "DOE, JANE A", people: [] })).toBe(true);
  });
});

describe("cross-reference name checks (cases seen in the FL ECLB file)", () => {
  it("a middle initial must agree when a name is the only link", () => {
    const who = (principal: string) => ({ principal, people: [] });
    expect(samePerson("DOUGLAS W SMITH", who("DOUGLAS W SMITH"))).toBe(true);
    expect(samePerson("DOUGLAS W SMITH", who("DOUGLAS WAYNE SMITH"))).toBe(true);
    // Only one side gives an initial: still a candidate (decision 6: initials must agree when both give one).
    expect(samePerson("DOUGLAS W SMITH", who("DOUGLAS SMITH"))).toBe(true);
    expect(samePerson("DOUGLAS W SMITH", who("DOUGLAS C SMITH"))).toBe(false);
    expect(samePerson("DOUGLAS W SMITH", who("JASON DOUGLAS SMITH"))).toBe(false);
    expect(samePerson("DOUGLAS SMITH", who("DOUGLAS LEE SMITH"))).toBe(true);
  });
  it("an enforcement record must name exactly the related business", () => {
    expect(businessCore("D & S Electric, Inc.")).toBe("D S ELECTRIC");
    expect(businessCore("REDWIRE, LLC DBA REDWIRE")).toBe("REDWIRE");
    expect(businessNamed("D & S ELECTRIC INC.", "SMITH, DOUGLAS / DBA D & S ELECTRIC INC")).toBe(true);
    expect(businessNamed("D & S ELECTRIC INC.", "HINCKLEY, JASON / DBA HINCKLEY ELECTRIC, INC")).toBe(false);
    expect(businessNamed("REDWIRE, LLC DBA REDWIRE", "REDWIRE LLC")).toBe(true);
    expect(businessNamed("INC", "ANY INC")).toBe(false);
  });
});

describe("dedupe", () => {
  it("merges two copies of one license from one board, keeping the first, filling gaps and keeping everyone named", () => {
    const set = new LicenseSet();
    expect(set.add(lic({ licenseNumber: "EC-100", businessName: "ACME ELECTRIC LLC", principal: "JOHN ROE" }))).toBe(true);
    expect(set.add(lic({ licenseNumber: "ec100", businessName: "Acme Electric", phone: "8135550101", principal: "MARY POE", people: [{ name: "Jane Doe", role: "Qualifier" }] }))).toBe(false);
    expect(set.list).toHaveLength(1);
    expect(set.list[0].principal).toBe("JOHN ROE");
    expect(set.list[0].phone).toBe("8135550101");
    // Both copies' people survive the merge (a CSLB license with several officers).
    expect(set.list[0].people).toEqual([{ name: "Jane Doe", role: "Qualifier" }, { name: "MARY POE", role: null }]);
  });
  it("keeps two boards' license 12345 apart even when both names share a word like LLC (audit: dedupe by source and type)", () => {
    const set = new LicenseSet();
    set.add(lic({ licenseNumber: "12345", businessName: "ALPHA ELECTRIC LLC", source: "Electrical board", phone: "8135550101" }));
    set.add(lic({ licenseNumber: "12345", businessName: "BETA PLUMBING LLC", source: "Plumbing board", phone: "8135550199" }));
    set.add(lic({ licenseNumber: "12345", businessName: "ALPHA ELECTRIC LLC", source: "Electrical board", licenseType: "Journeyman" }));
    set.add(lic({ licenseNumber: "12345", businessName: "ACME ELECTRIC", state: "TX" }));
    expect(set.list).toHaveLength(4);
    expect(set.list[0].phone).toBe("8135550101");
    // Within one board, LLC alone is not a shared name.
    const one = new LicenseSet();
    one.add(lic({ licenseNumber: "12345", businessName: "ALPHA ELECTRIC LLC" }));
    one.add(lic({ licenseNumber: "12345", businessName: "BETA PLUMBING LLC" }));
    expect(one.list).toHaveLength(2);
  });
  it("keeps two unnumbered records of one board apart when their streets differ", () => {
    const set = new LicenseSet();
    set.add(lic({ licenseNumber: null, businessName: "ACME ELECTRIC", address: "12 Palm Ave Tampa FL" }));
    set.add(lic({ licenseNumber: null, businessName: "ACME ELECTRIC", address: "40 Oak St Miami FL" }));
    expect(set.list).toHaveLength(2);
  });
});

describe("identifier search and cross-reference (fake source)", () => {
  it("finds the subject's own record by the customer's license number; another name found by a phone is only 'matched by the phone you gave'", async () => {
    const f = fakeFinder(ROWS);
    const r = await searchCustomerIds([f], [{ type: "license", value: "ec 100" }, { type: "phone", value: "8135550444" }], { name: "Acme Electric", kind: "company" });
    expect(r.licenses.map((h) => [h.licenseNumber, h.matchedOn])).toEqual([["EC100", "license"]]);
    expect(r.matched.map((h) => [h.licenseNumber, h.matchedOn, h.relatedTie, h.byYourIdentifier])).toEqual([["CGC400", "phone", "phone", true]]);
    expect(r.matched[0].relatedVia).toBe("matched by the phone you gave (8135550444)");
    expect(r.searches.map((s) => s.found)).toEqual([1, 1]);
    expect(r.used).toBe(2);
  });

  it("the common-tie limit applies to the customer's identifiers too", async () => {
    const many = Array.from({ length: MAX_BUSINESSES_PER_TIE + 1 }, (_, i) => lic({ licenseNumber: `EC8${String(i).padStart(2, "0")}`, businessName: `SUITE ${String.fromCharCode(65 + i)} CO`, phone: "813 555 0777" }));
    const r = await searchCustomerIds([fakeFinder(many)], [{ type: "phone", value: "8135550777" }], { name: "Acme Electric", kind: "company" });
    expect(r.matched).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/shared by 13 businesses/);
  });

  it("a source that can't search an identifier is 'not searched', never 'searched, 0 found'", async () => {
    const unloaded: LicenseFinder = { state: "FL", label: "Florida file", byId: async () => ({ licenses: [], enforcement: [], searched: false, note: "not loaded yet" }) };
    const r = await searchCustomerIds([unloaded, fakeFinder(ROWS)], [{ type: "license", value: "EC100" }], { name: "Acme Electric", kind: "company" });
    expect(r.searches[0].note).toBe("1 source(s) searched; not searched: Florida file (not loaded yet)");
  });

  it("a company: links its officer's other business, same-phone and same-address licenses, each with its tie", async () => {
    const f = fakeFinder(ROWS, [enf({ name: "BRIGHT SOLAR INC", id: "SWO-1" }), enf({ name: "SUNNY POOL CO", id: "SWO-2", phone: "8135550101" })]);
    const own = new LicenseSet();
    for (const h of (await f.byName!("Acme Electric", "company")).hits) own.add(h);
    expect(own.list.map((h) => h.licenseNumber)).toEqual(["EC100"]);
    const searchedFor: string[] = [];
    const x = await crossReference({
      subject: { name: "Acme Electric", kind: "company" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 0,
      enforcementSearch: async (name) => { searchedFor.push(name); return { hits: name === "BRIGHT SOLAR INC" ? [enf({ name, id: "SWO-1" })] : [], sources: [] }; },
    });
    const by = Object.fromEntries(x.related.map((h) => [h.licenseNumber, h]));
    expect(Object.keys(by).sort()).toEqual(["CGC400", "EC200", "EC300"]);
    expect(by.EC300.relatedTie).toBe("phone");
    expect(by.EC300.relatedVia).toBe("same phone as license EC100, (813) 555-0101");
    expect(by.EC200.relatedTie).toBe("person");
    expect(by.EC200.relatedVia).toBe("JANE DOE (qualifier) is named on both this license and license EC100");
    expect(by.CGC400.relatedTie).toBe("address");
    expect(by.CGC400.relatedVia).toContain("same address as license EC100");
    // Never the subject's own record, and every related record says why it is here.
    expect(x.related.every((h) => h.relatedVia && h.licenseNumber !== "EC100")).toBe(true);
    // Strongest ties first; enforcement searched for the related businesses, marked with the tie.
    expect(x.related.map((h) => h.relatedTie)).toEqual(["phone", "person", "address"]);
    // Each business by its name and by its name without "Co"/"Inc"/"Corp" (agencies file under either).
    expect(searchedFor).toEqual(["SUNNY POOL CO", "SUNNY POOL", "BRIGHT SOLAR INC", "BRIGHT SOLAR", "GULF ROOFING CORP", "GULF ROOFING"]);
    const swo = x.relatedEnforcement.map((e) => [e.id, e.relatedTie]);
    expect(swo).toContainEqual(["SWO-2", "phone"]); // found by the phone itself
    expect(swo).toContainEqual(["SWO-1", "person"]);
    expect(x.relatedEnforcement.every((e) => e.relatedVia)).toBe(true);
  });

  it("a person: the businesses they're named on and those businesses' licenses; never any enforcement (FCRA), not even for a related business", async () => {
    const f = fakeFinder([...ROWS, lic({ licenseNumber: "EC201", businessName: "BRIGHT SOLAR INC", phone: "727 555 0199" })], [enf({ name: "BRIGHT SOLAR INC", id: "SWO-9", phone: "7275550199" })]);
    const own = new LicenseSet();
    for (const h of (await f.byName!("Jane Doe", "person")).hits) own.add(h);
    expect(own.list.map((h) => h.licenseNumber).sort()).toEqual(["EC100", "EC200"]);
    // An enforcement search that really returns records for these businesses: it must never be called for a person.
    const searchedFor: string[] = [];
    const realEnforcement = async (name: string) => { searchedFor.push(name); return { hits: [enf({ name: "BRIGHT SOLAR INC", id: "SWO-1" }), enf({ name: "ACME ELECTRIC LLC", id: "SWO-3" })], sources: [] }; };
    const x = await crossReference({ subject: { name: "Jane Doe", kind: "person" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: realEnforcement });
    expect(searchedFor).toEqual([]);
    const ec201 = x.related.find((h) => h.licenseNumber === "EC201")!;
    expect(ec201.relatedTie).toBe("phone");
    expect(ec201.relatedVia).toContain("same phone as license EC200");
    expect(ec201.relatedVia).toContain("held by BRIGHT SOLAR INC, the business on license EC200, where Jane Doe is named");
    expect(x.relatedEnforcement).toEqual([]);
    expect(x.notes.join(" ")).toContain("searched for companies only");
  });

  it("the same company's enforcement search does run (the guard is for people only)", async () => {
    const f = fakeFinder(ROWS);
    const own = new LicenseSet();
    own.add({ ...ROWS[0] });
    const x = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 0,
      enforcementSearch: async (name) => ({ hits: name.startsWith("BRIGHT SOLAR") ? [enf({ name: "BRIGHT SOLAR INC", id: "SWO-1" })] : [], sources: [{ source: "Fake court", scope: "FL", searched: false, note: "Could not search: HTTP 503" }] }) });
    expect(x.relatedEnforcement.map((e) => e.id)).toContain("SWO-1");
    // A source that failed during the hop is said, not dropped.
    expect(x.notes.join(" ")).toContain("not searched: Fake court (Could not search: HTTP 503)");
  });

  it("a name hop in a file that isn't loaded is reported as not searched", async () => {
    const f = fakeFinder(ROWS);
    const unloaded: LicenseFinder = { state: "FL", label: "Florida file", byName: async () => ({ hits: [], searched: false, note: "Not loaded yet" }) };
    const own = new LicenseSet();
    own.add({ ...ROWS[0] });
    const x = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [unloaded, f], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: noEnforcement });
    expect(x.notes.join(" ")).toContain(`Not searched: "JANE DOE" in Florida file (Not loaded yet)`);
  });

  it("an address on another side of the street is no tie (123 N Main St is not 123 S Main Ave)", async () => {
    const rows = [lic({ licenseNumber: "EC100", businessName: "ACME ELECTRIC LLC", address: "123 N Main St Tampa FL 33602" }), lic({ licenseNumber: "EC700", businessName: "OTHER ROOFING LLC", address: "123 S Main Ave Tampa FL 33602" })];
    const own = new LicenseSet();
    own.add({ ...rows[0] });
    const keyed: LicenseFinder = { ...fakeFinder(rows), byId: async (q) => ({ licenses: q.type === "address" ? rows.filter((h) => addressMatches(q.value, h.address)) : [], enforcement: [] }) };
    const x = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [keyed], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: noEnforcement });
    expect(x.related.map((h) => h.licenseNumber)).toEqual([]);
  });

  it("drops a tie shared by too many businesses (a shared building), and says so", async () => {
    const many = Array.from({ length: MAX_BUSINESSES_PER_TIE + 1 }, (_, i) => lic({ licenseNumber: `EC9${String(i).padStart(2, "0")}`, businessName: `TENANT ${String.fromCharCode(65 + i)} CO`, address: "12 Palm Ave Tampa FL 33602" }));
    const f = fakeFinder([ROWS[0], ...many]);
    const own = new LicenseSet();
    own.add({ ...ROWS[0], people: [] });
    const x = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: noEnforcement });
    expect(x.related.filter((h) => h.relatedTie === "address")).toEqual([]);
    expect(x.notes.join(" ")).toMatch(/shared by \d+ businesses/);
  });

  it("caps identifier searches per subject and logs what was left out", async () => {
    const f = fakeFinder(ROWS);
    const own = new LicenseSet();
    for (const h of ROWS.slice(0, 4)) own.add({ ...h, people: [] });
    const x = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: MAX_ID_SEARCHES - 2, enforcementSearch: noEnforcement });
    expect(x.idSearches).toBe(MAX_ID_SEARCHES);
    expect(f.calls.filter((c) => /^(license|phone|address):/.test(c))).toHaveLength(2);
    expect(x.notes.join(" ")).toContain("were not searched (limit of 25 identifier searches per name)");
  });
});
