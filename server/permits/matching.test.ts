import { describe, expect, it } from "vitest";
import {
  normalizeAddress, addressesMatch, streetKey, contractorMatches, matchedTrades, haversineMiles, matchWatch, contentHash, normalizeParcel,
} from "./matching";
import type { PermitRecord } from "../scrapers/types";

const permit = (p: Partial<PermitRecord>): PermitRecord => ({ permitNumber: "B-1", jurisdiction: "Springfield, OR", databaseId: 1, ...p });

describe("address normalization", () => {
  it("abbreviates street words, drops punctuation and case", () => {
    expect(normalizeAddress("123 North Main Street, Apt. 4")).toBe("123 n main st apt 4");
    expect(normalizeAddress("123 N. MAIN ST #4")).toBe("123 n main st 4");
    expect(normalizeAddress("45 First Avenue")).toBe("45 1st ave");
  });
  it("matches the same house on spelling variants, not a different number", () => {
    expect(addressesMatch("123 North Main Street", "123 N Main St")).toBe(true);
    expect(addressesMatch("123 N Main St, Springfield OR 97477", "123 North Main Street")).toBe(true);
    expect(addressesMatch("123 N Main St", "124 N Main St")).toBe(false);
    expect(addressesMatch("123 N Main St", "123 N Elm St")).toBe(false);
    expect(addressesMatch("", "123 N Main St")).toBe(false);
  });
  it("streetKey keeps number + street, drops unit and city tails", () => {
    expect(streetKey(normalizeAddress("123 N Main St Apt 4 Springfield"))).toBe("123 n main st");
  });
  it("normalizes parcels to alphanumerics", () => {
    expect(normalizeParcel("17-03-25-11-00300")).toBe("170325110030" + "0");
  });
});

describe("contractor matching", () => {
  it("ignores LLC/Inc noise and word order, requires every significant word", () => {
    expect(contractorMatches({ contractorName: "Acme Roofing LLC" }, permit({ contractorName: "ACME ROOFING, INC." }))).toBe(true);
    expect(contractorMatches({ contractorName: "Acme Roofing" }, permit({ contractorName: "Roofing Acme Co" }))).toBe(true);
    expect(contractorMatches({ contractorName: "Acme Roofing" }, permit({ contractorName: "Acme Plumbing" }))).toBe(false);
    expect(contractorMatches({ contractorName: "Acme" }, permit({ contractorName: "Acme Plumbing" }))).toBe(false);
    expect(contractorMatches({ contractorName: "Acme" }, permit({ contractorName: "ACME LLC" }))).toBe(true);
  });
  it("matches on license exactly, and falls back to the applicant", () => {
    expect(contractorMatches({ contractorLicense: "CCB-12345" }, permit({ contractorLicense: "ccb 12345" }))).toBe(true);
    expect(contractorMatches({ contractorLicense: "CCB-12345" }, permit({ contractorLicense: "CCB-12346" }))).toBe(false);
    expect(contractorMatches({ contractorName: "Acme Roofing" }, permit({ applicantName: "Acme Roofing LLC" }))).toBe(true);
  });
});

describe("trades", () => {
  it("finds trade keywords in type, class and description", () => {
    expect(matchedTrades({ trades: ["roofing", "solar"] }, permit({ permitType: "Residential Re-Roof" }))).toEqual(["Roofing"]);
    expect(matchedTrades({ trades: ["hvac"] }, permit({ description: "Replace furnace and A/C" }))).toEqual(["HVAC"]);
    expect(matchedTrades({ trades: ["pool"] }, permit({ description: "Kitchen remodel" }))).toEqual([]);
    expect(matchedTrades({ keywords: ["ADU"] }, permit({ description: "Detached ADU 600 sf" }))).toEqual(["ADU"]);
  });
});

describe("radius", () => {
  it("haversine: Portland to Salem is about 45 miles", () => {
    const miles = haversineMiles(45.5152, -122.6784, 44.9429, -123.0351);
    expect(miles).toBeGreaterThan(42);
    expect(miles).toBeLessThan(48);
  });
});

describe("matchWatch", () => {
  it("address watch: parcel or normalized address", () => {
    expect(matchWatch({ kind: "address", params: { address: "123 N Main St" } }, permit({ address: "123 North Main Street" })).matched).toBe(true);
    expect(matchWatch({ kind: "address", params: { address: "123 N Main St" } }, permit({ address: "9 Oak Ave" })).matched).toBe(false);
    expect(matchWatch({ kind: "address", params: { parcel: "17-03-25" } }, permit({ parcel: "170325" })).matched).toBe(true);
  });
  it("trade_area: within radius when both sides have coordinates, else by jurisdiction", () => {
    const w = { kind: "trade_area" as const, params: { trades: ["roofing" as const], lat: 45.5152, lng: -122.6784, radiusMiles: 10 } };
    expect(matchWatch(w, permit({ permitType: "Re-roof", lat: 45.52, lng: -122.68 })).matched).toBe(true);
    expect(matchWatch(w, permit({ permitType: "Re-roof", lat: 44.9429, lng: -123.0351 })).matched).toBe(false);
    expect(matchWatch(w, permit({ permitType: "Re-roof" })).matched).toBe(true);
    expect(matchWatch(w, permit({ permitType: "Pool", lat: 45.52, lng: -122.68 })).matched).toBe(false);
    // No trades = every permit in the area.
    expect(matchWatch({ kind: "trade_area", params: {} }, permit({ permitType: "Anything" })).matched).toBe(true);
  });
  it("contractor watch", () => {
    expect(matchWatch({ kind: "contractor", params: { contractorName: "Acme Roofing" } }, permit({ contractorName: "Acme Roofing LLC" })).matched).toBe(true);
    expect(matchWatch({ kind: "contractor", params: { contractorName: "Acme Roofing" } }, permit({ contractorName: "Bob's Pools" })).matched).toBe(false);
  });
  it("content hash changes with the record's fields only", () => {
    const a = permit({ status: "Issued" });
    expect(contentHash(a)).toBe(contentHash({ ...a, raw: { x: 1 } }));
    expect(contentHash(a)).not.toBe(contentHash({ ...a, status: "Finaled" }));
  });
});
