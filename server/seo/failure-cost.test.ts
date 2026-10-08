/** A report whose required call fails must still account for what the other calls cost. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataforseoDeps, API_BASE } from "./dataforseo";
import { fetchDomainReport } from "./explorer";
import { fetchKeywordOverview } from "./reports";

const originalFetch = dataforseoDeps.fetch, originalEnv = dataforseoDeps.env;
beforeEach(() => { dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "login@example.com", DATAFORSEO_PASSWORD: "secret" }); });
afterEach(() => { dataforseoDeps.fetch = originalFetch; dataforseoDeps.env = originalEnv; });

const ok = (cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ items: [] }] }] });
const failed = (cost: number) => ({ status_code: 20000, tasks: [{ status_code: 40400, status_message: "Not Found.", cost }] });

/** Answers every path; the failing one answers first, the rest a tick later (the order that used to lose their cost). */
function mock(failPath: string) {
  const paths: string[] = [];
  dataforseoDeps.fetch = (async (url: any) => {
    const path = String(url).replace(API_BASE, "");
    paths.push(path);
    if (path !== failPath) await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify(path === failPath ? failed(0.02) : ok(0.01)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return paths;
}

describe("cost of a failed report", () => {
  it("Site Explorer: the error carries the failed call's cost plus every other call's", async () => {
    const paths = mock("/dataforseo_labs/google/domain_rank_overview/live");
    const e: any = await fetchDomainReport({ domain: "example.com", locationCode: 2840, languageCode: "en" }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(paths).toHaveLength(9);
    expect(e.costUsd).toBeCloseTo(0.02 + 8 * 0.01, 6);
  });
  it("Keywords Explorer: a failed overview still counts the results call", async () => {
    mock("/dataforseo_labs/google/keyword_overview/live");
    const e: any = await fetchKeywordOverview({ keyword: "roof repair", locationCode: 2840, languageCode: "en" }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.costUsd).toBeCloseTo(0.03, 6);
  });
  it("Keywords Explorer: a failed results call is reported as missing, not as an empty top ten", async () => {
    mock("/serp/google/organic/live/advanced");
    const out = await fetchKeywordOverview({ keyword: "roof repair", locationCode: 2840, languageCode: "en" });
    expect(out.data.missing).toEqual(["results"]);
    expect(out.costUsd).toBeCloseTo(0.03, 6);
  });
});
