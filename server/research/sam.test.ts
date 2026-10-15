/** A9: SAM.gov's public Exclusions extract (firms only) and the optional Socrata app token. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { nationwideNow } from "@shared/research-coverage";
import { csvRecordsFrom } from "./bulk";
import { downloadUrl, newestExtract, samRow, SAM_EXCLUSIONS } from "./sam";
import { politeFetch, resetHostState, socrataAppToken } from "./http";
import { knowledgeBook, setKnowledgeFact } from "../hub/knowledge";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetHostState(); });

const row = (o: Record<string, string>): Record<string, string> => ({
  Classification: "Firm", Name: "106 Coronado, LLC", "Address 1": "3231 W Thunderbird Rd", City: "Phoenix", "State / Province": "AZ", Country: "USA",
  "Zip Code": "85053-5605", "Unique Entity ID": "Y8CHG5Y7Z488", "Exclusion Program": "Reciprocal", "Excluding Agency": "ICE", "CT Code": "",
  "Exclusion Type": "Ineligible (Proceedings Completed)", "Additional Comments": "", "Active Date": "2024-12-04", "Termination Date": "2029-12-03",
  "Record Status": "Active", "Cross-Reference": "(also Jason Junior Coleman, Kimberly Djai Coleman)", "SAM Number": "39e5ebc7-5766-41a9-9d6b-6956376b34ca", CAGE: "", ...o,
});

describe("SAM.gov exclusions: firms only, the publisher's own facts", () => {
  it("individuals, vessels and special entity designations never become rows", () => {
    for (const c of ["Individual", "Vessel", "Special Entity Designation", ""]) expect(samRow(row({ Classification: c, First: "Jason", Last: "Coleman" })), c).toBeNull();
  });
  it("a firm keeps its exclusion type, agency, dates, CT code, UEI and CAGE; the cross-reference's people are left out", () => {
    const h = samRow(row({ "CT Code": "Z1", CAGE: "1ABC2" }))!;
    expect(h).toMatchObject({ kind: "enforcement", business: "106 Coronado, LLC", person: null });
    expect(h.hit).toMatchObject({
      state: "US", category: "debarment", name: "106 Coronado, LLC", date: "2024-12-04", endDate: "2029-12-03",
      status: "Ineligible (Proceedings Completed), Active", city: "Phoenix, AZ", adverse: true, licenseNumber: "Y8CHG5Y7Z488",
    });
    expect(h.hit.detail).toContain("Excluding agency: ICE");
    expect(h.hit.detail).toContain("CT code: Z1");
    expect(h.keys?.licenses).toEqual(["Y8CHG5Y7Z488", "1ABC2"]);
    expect(JSON.stringify(h)).not.toMatch(/Coleman/);
  });
  it("adverse and dates come only from what is published", () => {
    expect(samRow(row({ "Termination Date": "Indefinite" }))!.hit).toMatchObject({ endDate: null, adverse: true });
    expect(samRow(row({ "Termination Date": "Indefinite" }))!.hit.detail).toContain("Termination: Indefinite");
    expect(samRow(row({ "Termination Date": "2020-01-01" }))!.hit.adverse).toBe(false);
    expect(samRow(row({ "Record Status": "" }))!.hit.adverse).toBeNull();
    expect(samRow(row({ "Active Date": "" }))!.hit.date).toBeNull();
  });
  it("picks the newest listed extract and downloads it through sam.gov", () => {
    const f = newestExtract([
      { displayKey: "SAM_Exclusions_Public_Extract_V2_26287.ZIP", key: "Exclusions/Public V2/SAM_Exclusions_Public_Extract_V2_26287.ZIP" },
      { displayKey: "SAM_Exclusions_Public_Extract_V2_26288.ZIP", key: "Exclusions/Public V2/SAM_Exclusions_Public_Extract_V2_26288.ZIP" },
      { displayKey: "readme.txt", key: "Exclusions/Public V2/readme.txt" },
    ])!;
    expect(downloadUrl(f)).toBe("https://sam.gov/api/prod/fileextractservices/v1/api/download/Exclusions/Public%20V2/SAM_Exclusions_Public_Extract_V2_26288.ZIP?privacy=Public");
    expect(newestExtract([])).toBeNull();
  });
  it("is a daily, company-only file with row shape 1", () => {
    expect(SAM_EXCLUSIONS).toMatchObject({ id: "us-sam-exclusions", state: "US", everyHours: 24, companiesOnly: true, rowShape: 1, category: "debarment" });
  });
  it("streams CSV records without a file", async () => {
    const chunks = Readable.from([Buffer.from('Classification,Name\nFirm,"Acme, ""Inc"""\n'), Buffer.from("Individual,Jane Doe\n")]);
    const out: Record<string, string>[] = [];
    for await (const r of csvRecordsFrom(chunks as AsyncIterable<Buffer>)) out.push(r);
    expect(out).toEqual([{ Classification: "Firm", Name: 'Acme, "Inc"' }, { Classification: "Individual", Name: "Jane Doe" }]);
  });
});

describe("SAM.gov is named only once its file has loaded", () => {
  it("the coverage page lists it only when the server says so", () => {
    const list = [{ label: "SAM", needs: "samExclusions" as const }, { label: "OSHA", needs: "osha" as const }];
    expect(nationwideNow(list, { osha: true, samExclusions: false }).map((x) => x.label)).toEqual(["OSHA"]);
    expect(nationwideNow(list, { osha: true, samExclusions: true }).map((x) => x.label)).toEqual(["SAM", "OSHA"]);
  });
  it("Hub's pack names it only after the fact is set", () => {
    setKnowledgeFact("samExclusions", false);
    expect(knowledgeBook().pack).not.toContain("SAM.gov");
    setKnowledgeFact("samExclusions", true);
    expect(knowledgeBook().pack).toContain("federal exclusions and debarments (SAM.gov)");
    setKnowledgeFact("samExclusions", false);
  });
});

describe("Socrata app token", () => {
  const capture = () => {
    const seen: { url: string; token: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      seen.push({ url, token: new Headers(init?.headers).get("x-app-token") });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    return seen;
  };
  it("unset: requests are exactly as before (no X-App-Token)", async () => {
    vi.stubEnv("SOCRATA_APP_TOKEN", "");
    const seen = capture();
    await politeFetch("https://data.example.test/resource/abcd-1234.json?$limit=1", {}, { minDelayMs: 0 });
    expect(seen).toEqual([{ url: "https://data.example.test/resource/abcd-1234.json?$limit=1", token: null }]);
  });
  it("set: sent on Socrata API paths only", async () => {
    vi.stubEnv("SOCRATA_APP_TOKEN", "test-token-value");
    const seen = capture();
    await politeFetch("https://data.example.test/resource/abcd-1234.json?$limit=1", {}, { minDelayMs: 0 });
    await politeFetch("https://arcgis.example.test/arcgis/rest/services/x/query?f=json", {}, { minDelayMs: 0 });
    expect(seen.map((s) => s.token)).toEqual(["test-token-value", null]);
    expect(socrataAppToken("https://data.example.test/api/views/abcd-1234/rows.csv")).toBe("test-token-value");
    expect(socrataAppToken("https://www.example.test/resource/page")).toBeNull();
  });
});

describe("robots.txt: a storage service's XML error is no challenge (A9)", () => {
  it("S3's AccessDenied XML reads as no robots file; a WAF page still refuses", async () => {
    const { challengePage } = await import("./http");
    expect(challengePage('<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message><RequestId>X</RequestId></Error>')).toBe(false);
    expect(challengePage("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>")).toBe(false);
    expect(challengePage("<html><head><title>Access Denied</title></head><body>Reference #18.1</body></html>")).toBe(true);
  });
});
