/** Sales Agents (server/sales-agents.ts + client/src/lib/sales-leads-import.ts): the pure parts — no engine, no DB. */
import { describe, expect, it } from "vitest";
import { leadsQuery, salesAgentsBaseUrl } from "./sales-agents";
import { chunk, parseCsv, parseLeadFile } from "@/lib/sales-leads-import";

describe("sales agents proxy", () => {
  it("forwards only the known lead filters and clamps paging", () => {
    const q = new URLSearchParams(leadsQuery({ status: "ready", trade: " HVAC ", token: "x", limit: "9999", offset: "-5" }));
    expect(q.get("status")).toBe("ready");
    expect(q.get("trade")).toBe("HVAC");
    expect(q.get("token")).toBeNull();
    expect(q.get("limit")).toBe("500");
    expect(q.get("offset")).toBe("0");
  });
  it("defaults the engine address", () => {
    const before = process.env.SALES_AGENTS_API_URL;
    delete process.env.SALES_AGENTS_API_URL;
    expect(salesAgentsBaseUrl()).toBe("https://sales.constructhub.us");
    process.env.SALES_AGENTS_API_URL = "http://localhost:9000/";
    expect(salesAgentsBaseUrl()).toBe("http://localhost:9000");
    if (before === undefined) delete process.env.SALES_AGENTS_API_URL; else process.env.SALES_AGENTS_API_URL = before;
  });
});

describe("lead file import", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("maps common column names and skips rows without a phone", () => {
    const csv = "Company,Phone Number,Category,City,State,URL,Owner\nCool Air,+18135550123,HVAC,Tampa,FL,coolair.com,Mike\nNo Phone Co,,Roofing,,,,\n";
    const p = parseLeadFile("list.csv", csv);
    expect(p.skipped).toBe(1);
    expect(p.leads).toEqual([{ business: "Cool Air", phone: "+18135550123", trade: "HVAC", city: "Tampa", state: "FL", website: "coolair.com", contact_name: "Mike" }]);
  });
  it("reads JSON lists and {source, leads}", () => {
    expect(parseLeadFile("a.json", '[{"tel":"555","name":"A"}]').leads).toEqual([{ phone: "555", business: "A" }]);
    const p = parseLeadFile("b.txt", '{"source":"scraper-x","leads":[{"phone_number":"1"},{"x":1}]}');
    expect(p.source).toBe("scraper-x");
    expect(p.leads.length).toBe(1);
    expect(p.skipped).toBe(1);
  });
  it("chunks into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
