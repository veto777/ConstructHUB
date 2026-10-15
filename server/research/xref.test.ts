import { describe, expect, it } from "vitest";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { researchOrderSchema, researchTierFor } from "@shared/research-reports";
import { idWords, queryWords, type IdQuery } from "./identifiers";
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
    expect(samePerson("DOUGLAS W SMITH", who("DOUGLAS SMITH"))).toBe(false);
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
  it("merges one license from two sources by state + license number, keeping the first and filling gaps", () => {
    const set = new LicenseSet();
    expect(set.add(lic({ licenseNumber: "EC-100", businessName: "ACME ELECTRIC LLC", source: "A" }))).toBe(true);
    expect(set.add(lic({ licenseNumber: "ec100", businessName: "Acme Electric", source: "B", phone: "8135550101", people: [{ name: "Jane Doe", role: "Qualifier" }] }))).toBe(false);
    expect(set.list).toHaveLength(1);
    expect(set.list[0].source).toBe("A");
    expect(set.list[0].phone).toBe("8135550101");
    expect(set.list[0].people).toEqual([{ name: "Jane Doe", role: "Qualifier" }]);
  });
  it("keeps two boards' records apart when only the number is shared, and other states apart", () => {
    const set = new LicenseSet();
    set.add(lic({ licenseNumber: "12345", businessName: "ACME ELECTRIC" }));
    set.add(lic({ licenseNumber: "12345", businessName: "ZEBRA PLUMBING" }));
    set.add(lic({ licenseNumber: "12345", businessName: "ACME ELECTRIC", state: "TX" }));
    expect(set.list).toHaveLength(3);
  });
});

describe("identifier search and cross-reference (fake source)", () => {
  it("finds the subject's own record by the customer's license number and phone", async () => {
    const f = fakeFinder(ROWS);
    const r = await searchCustomerIds([f], [{ type: "license", value: "ec 100" }, { type: "phone", value: "8135550444" }], "company");
    expect(r.licenses.map((h) => [h.licenseNumber, h.matchedOn])).toEqual([["EC100", "license"], ["CGC400", "phone"]]);
    expect(r.searches.map((s) => s.found)).toEqual([1, 1]);
    expect(r.used).toBe(2);
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

  it("a person: the businesses they're named on and those businesses' licenses; no enforcement by identifier", async () => {
    const f = fakeFinder([...ROWS, lic({ licenseNumber: "EC201", businessName: "BRIGHT SOLAR INC", phone: "727 555 0199" })], [enf({ name: "BRIGHT SOLAR INC", id: "SWO-9", phone: "7275550199" })]);
    const own = new LicenseSet();
    for (const h of (await f.byName!("Jane Doe", "person")).hits) own.add(h);
    expect(own.list.map((h) => h.licenseNumber).sort()).toEqual(["EC100", "EC200"]);
    const x = await crossReference({ subject: { name: "Jane Doe", kind: "person" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: noEnforcement });
    const ec201 = x.related.find((h) => h.licenseNumber === "EC201")!;
    expect(ec201.relatedTie).toBe("phone");
    expect(ec201.relatedVia).toContain("same phone as license EC200");
    expect(ec201.relatedVia).toContain("held by BRIGHT SOLAR INC, the business on license EC200, where Jane Doe is named");
    expect(x.relatedEnforcement).toEqual([]);
    expect(x.notes.join(" ")).toContain("searched for companies only");
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
