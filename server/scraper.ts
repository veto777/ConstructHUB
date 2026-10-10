import { existsSync } from "fs";
import { canScrapeGovernmentPortal } from "@shared/government-links";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright-core";
import * as cheerio from "cheerio";
import { storage } from "./storage";
// Keep the adapter importable by workers and tests without booting the HTTP
// server (and its database seeding/scheduled jobs) through a circular import.
function log(message: string, source = "scraper") {
  console.log(`${new Date().toLocaleTimeString("en-US")} [${source}] ${message}`);
}
import { liveSearchOutcome, scrapeFailureReason } from "./live-search-outcome";

// CHROMIUM_PATH wins. The Replit-era Nix build is used only where it exists;
// anywhere else playwright-core launches its own managed headless build (the
// one script/deploy-vb11.sh installs) instead of failing on a missing path.
const REPLIT_CHROMIUM = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || (existsSync(REPLIT_CHROMIUM) ? REPLIT_CHROMIUM : undefined);

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    if (browserInstance.isConnected()) {
      return browserInstance;
    }
    browserInstance = null;
    browserLaunchPromise = null;
  }
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }
  browserLaunchPromise = (async () => {
    try {
      // browserInstance is provably null here (getBrowser returns early or nulls
      // it before this IIFE runs), so no stale instance to close.
      browserInstance = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--no-first-run",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-translate",
          "--disable-features=site-per-process",
          "--js-flags=--max-old-space-size=256",
        ],
      });
      browserInstance.on("disconnected", () => {
        browserInstance = null;
        browserLaunchPromise = null;
      });
      return browserInstance;
    } finally {
      browserLaunchPromise = null;
    }
  })();
  return browserLaunchPromise;
}

async function createIsolatedPage(): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });
  context.setDefaultTimeout(60000);
  context.setDefaultNavigationTimeout(60000);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { page, context };
}

/** A fresh isolated browser context on the shared browser (permit alert adapters, server/scrapers/*). Caller closes it. */
export async function newBrowserContext(): Promise<BrowserContext> {
  const { context } = await createIsolatedPage();
  return context;
}

async function closeIsolatedPage(page: Page, context: BrowserContext) {
  try { await page.close(); } catch {}
  try { await context.close(); } catch {}
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export interface ScrapeContact {
  type: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
}

export interface ScrapeResult {
  permitNumber: string | null;
  permitType: string | null;
  status: string | null;
  address: string | null;
  applicantName: string | null;
  contractorName: string | null;
  description: string | null;
  issuedDate: string | null;
  parcelNumber: string | null;
  expirationDate: string | null;
  finalizedDate: string | null;
  district: string | null;
  contacts: ScrapeContact[];
  caseId?: string | null;
}

function makeResult(partial: Partial<ScrapeResult>): ScrapeResult {
  return {
    permitNumber: partial.permitNumber ?? null,
    permitType: partial.permitType ?? null,
    status: partial.status ?? null,
    address: partial.address ?? null,
    applicantName: partial.applicantName ?? null,
    contractorName: partial.contractorName ?? null,
    description: partial.description ?? null,
    issuedDate: partial.issuedDate ?? null,
    parcelNumber: partial.parcelNumber ?? null,
    expirationDate: partial.expirationDate ?? null,
    finalizedDate: partial.finalizedDate ?? null,
    district: partial.district ?? null,
    contacts: partial.contacts ?? [],
    caseId: partial.caseId ?? null,
  };
}

export interface ScrapeProgress {
  databaseId: number;
  databaseName: string;
  status: "pending" | "running" | "completed" | "error";
  message: string;
  resultsFound: number;
  currentPage: number;
  totalPages: number;
}

const scrapeJobs = new Map<string, ScrapeProgress>();

export function getScrapeProgress(jobId: string): ScrapeProgress | undefined {
  return scrapeJobs.get(jobId);
}

export function getAllScrapeJobs(): Map<string, ScrapeProgress> {
  return scrapeJobs;
}

export interface LiveSearchJob {
  searchId: string;
  queryId: number;
  searchType: string;
  searchValue: string;
  status: "running" | "completed";
  databases: {
    id: number;
    name: string;
    jurisdiction: string | null;
    countyId: number;
    platform: string | null;
    jobId: string;
    status: "pending" | "running" | "completed" | "error" | "skipped";
    message: string;
    resultsFound: number;
  }[];
  totalResultsFound: number;
  startedAt: number;
}

const liveSearchJobs = new Map<string, LiveSearchJob>();

export function getLiveSearchJob(searchId: string): LiveSearchJob | undefined {
  return liveSearchJobs.get(searchId);
}

export async function startLiveSearch(
  searchId: string,
  queryId: number,
  searchType: string,
  searchValue: string,
  databases: { id: number; name: string; jurisdiction: string | null; countyId: number; platform: string | null; searchUrl: string | null; portalUrl: string | null; isActive: boolean }[]
): Promise<LiveSearchJob> {
  const activeDbs = databases.filter(db => db.isActive && canScrapeGovernmentPortal(db));

  const job: LiveSearchJob = {
    searchId,
    queryId,
    searchType,
    searchValue,
    status: "running",
    databases: activeDbs.map(db => ({
      id: db.id,
      name: db.name,
      jurisdiction: db.jurisdiction,
      countyId: db.countyId,
      platform: db.platform,
      jobId: `${searchId}-${db.id}`,
      status: "pending" as const,
      message: "Waiting...",
      resultsFound: 0,
    })),
    totalResultsFound: 0,
    startedAt: Date.now(),
  };

  liveSearchJobs.set(searchId, job);

  const mapSearchType = (platform: string | null, searchType: string): string => {
    if (platform === "SmartGov") return "address";
    return searchType;
  };

  const MAX_CONCURRENT = 4;

  const processDb = async (db: typeof activeDbs[0]) => {
    const dbEntry = job.databases.find(d => d.id === db.id)!;
    const effectiveSearchType = mapSearchType(db.platform, searchType);

    if (db.platform === "SmartGov" && searchType !== "address" && searchType !== "permit") {
      try {
        const cachedResults = await storage.searchLocalResultsByDatabase(searchType, searchValue, db.id);
        dbEntry.status = "completed";
        dbEntry.resultsFound = cachedResults.length;
        dbEntry.message = cachedResults.length > 0
          ? `Found ${cachedResults.length} cached results (SmartGov only supports address search on site)`
          : "No cached results (SmartGov only supports address search - try an address search first)";
        job.totalResultsFound = job.databases.reduce((sum, d) => sum + d.resultsFound, 0);
      } catch {
        dbEntry.status = "completed";
        dbEntry.resultsFound = 0;
        dbEntry.message = "SmartGov only supports address search on site";
      }
      liveSearchJobs.set(searchId, { ...job });
      return;
    }

    dbEntry.status = "running";
    dbEntry.message = "Scraping...";
    liveSearchJobs.set(searchId, { ...job });

    try {
      const url = db.searchUrl || db.portalUrl!;
      const jobId = dbEntry.jobId;

      const scrapeResults = await scrapeByPlatform(
        db.platform as ScraperPlatform,
        url,
        searchValue,
        effectiveSearchType,
        db.id,
        db.name,
        queryId,
        jobId
      );

      // Every adapter catches its own failure (browser launch, timeout, portal
      // change, login wall), records it on its scrape job and returns what it
      // had so far — usually []. Read that outcome back: a portal that was never
      // actually searched must not be reported as "Found 0 results".
      const outcome = liveSearchOutcome(scrapeResults.length, scrapeJobs.get(jobId));
      dbEntry.status = outcome.status;
      dbEntry.resultsFound = scrapeResults.length;
      dbEntry.message = outcome.message;
      job.totalResultsFound = job.databases.reduce((sum, d) => sum + d.resultsFound, 0);
      if (outcome.status === "error") log(`Live search error on ${db.name}: ${outcome.message}`, "scraper");
    } catch (err: any) {
      dbEntry.status = "error";
      dbEntry.message = `Not searched: ${scrapeFailureReason(err?.message)}`;
      log(`Live search error on ${db.name}: ${err.message}`, "scraper");
    }

    liveSearchJobs.set(searchId, { ...job });
  };

  const runWithConcurrency = async () => {
    const executing = new Set<Promise<void>>();
    for (const db of activeDbs) {
      const p = processDb(db).then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= MAX_CONCURRENT) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  };

  runWithConcurrency().then(() => {
    job.status = "completed";
    liveSearchJobs.set(searchId, { ...job });
    log(`Live search ${searchId} completed: ${job.totalResultsFound} total results across ${activeDbs.length} databases`, "scraper");

    setTimeout(() => liveSearchJobs.delete(searchId), 5 * 60 * 1000);
  });

  return job;
}

async function saveResultsBatch(
  results: ScrapeResult[],
  databaseId: number,
  queryId: number
): Promise<number> {
  let newCount = 0;
  for (const result of results) {
    const existing = await storage.findExistingResult(databaseId, result.permitNumber);
    if (existing) {
      const resultRawData = (result as any).rawData;
      const existingRawData = existing.rawData as Record<string, any> | null;
      const hasNewDetailUrl = resultRawData?.detailUrl && !existingRawData?.detailUrl;
      const hasNewData = (result.contacts?.length && !existing.contacts) ||
        (result.parcelNumber && !existing.parcelNumber) ||
        (result.contractorName && !existing.contractorName) ||
        (result.expirationDate && !existing.expirationDate) ||
        (result.finalizedDate && !existing.finalizedDate) ||
        (result.district && !existing.district) ||
        hasNewDetailUrl;
      if (hasNewData) {
        const updates: Record<string, any> = {};
        if (result.contacts?.length && !existing.contacts) updates.contacts = result.contacts;
        if (result.parcelNumber && !existing.parcelNumber) updates.parcelNumber = result.parcelNumber;
        if (result.contractorName && !existing.contractorName) updates.contractorName = result.contractorName;
        if (result.applicantName && !existing.applicantName) updates.applicantName = result.applicantName;
        if (result.expirationDate && !existing.expirationDate) updates.expirationDate = result.expirationDate;
        if (result.finalizedDate && !existing.finalizedDate) updates.finalizedDate = result.finalizedDate;
        if (result.district && !existing.district) updates.district = result.district;
        if (result.description && !existing.description) updates.description = result.description;
        if (hasNewDetailUrl) {
          updates.rawData = { ...(existingRawData || {}), ...resultRawData };
        }
        if (Object.keys(updates).length > 0) {
          await storage.updateSearchResult(existing.id, updates);
        }
      }
      continue;
    }
    const rawDataObj: Record<string, any> = { ...result };
    if ((result as any).rawData) {
      Object.assign(rawDataObj, (result as any).rawData);
    }
    await storage.createSearchResult({
      queryId,
      databaseId,
      permitNumber: result.permitNumber,
      permitType: result.permitType,
      status: result.status,
      address: result.address,
      applicantName: result.applicantName,
      contractorName: result.contractorName,
      description: result.description,
      issuedDate: result.issuedDate,
      parcelNumber: result.parcelNumber,
      expirationDate: result.expirationDate,
      finalizedDate: result.finalizedDate,
      district: result.district,
      contacts: result.contacts?.length ? result.contacts : null,
      rawData: rawDataObj,
    });
    newCount++;
  }
  return newCount;
}

async function finalizeScrape(
  totalResults: number,
  newResults: number,
  databaseId: number,
  databaseName: string,
  jobId: string,
  progress: ScrapeProgress
) {
  await storage.updateDatabase(databaseId, { lastScrapedAt: new Date() });

  progress.status = "completed";
  progress.message = `Completed: found ${totalResults} results (${newResults} new)`;
  scrapeJobs.set(jobId, { ...progress });

  log(`Scraper: Found ${totalResults} results (${newResults} new) on ${databaseName}`, "scraper");
}

async function saveResults(
  allResults: ScrapeResult[],
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string,
  progress: ScrapeProgress
) {
  const newResults = await saveResultsBatch(allResults, databaseId, queryId);
  await finalizeScrape(allResults.length, newResults, databaseId, databaseName, jobId, progress);
}

function initProgress(databaseId: number, databaseName: string, searchTerm: string, jobId: string): ScrapeProgress {
  const progress: ScrapeProgress = {
    databaseId,
    databaseName,
    status: "running",
    message: `Searching for "${searchTerm}"...`,
    resultsFound: 0,
    currentPage: 1,
    totalPages: 1,
  };
  scrapeJobs.set(jobId, progress);
  return progress;
}

export async function scrapeSmartGov(
  baseUrl: string,
  searchTerm: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    ({ page, context } = await createIsolatedPage());

    let searchUrl: string;
    if (baseUrl.includes("ApplicationSearch")) {
      searchUrl = baseUrl;
    } else {
      const origin = new URL(baseUrl).origin;
      searchUrl = `${origin}/ApplicationPublic/ApplicationSearch/Search`;
    }

    log(`Scraper: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);

    const queryInput = page.locator("#query, input[name='query'], input.search-input-control").first();
    await queryInput.waitFor({ state: "visible", timeout: 20000 });
    await queryInput.fill(searchTerm);

    progress.message = `Clicking search for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const searchBtn = page.locator("#Search, button:has-text('Search'), button:has-text('SEARCH')").first();
    await searchBtn.click();
    await page.waitForTimeout(5000);

    const hasResults = await page.locator("#search-results, .search-results, .alert-info").first().isVisible().catch(() => false);
    if (!hasResults) {
      await page.waitForTimeout(3000);
    }

    const html = await page.content();
    const results = parseSmartGovResults(html);
    allResults.push(...results);
    progress.resultsFound = results.length;
    progress.message = `Found ${results.length} results on page 1`;

    const newFromFirstPage = await saveResultsBatch(results, databaseId, queryId);
    totalNewResults += newFromFirstPage;

    const pageLinks = await page.locator(".pagination a, .pager a").count().catch(() => 0);
    if (pageLinks > 0) progress.totalPages = pageLinks;

    let currentPage = 2;
    while (true) {
      const nextPageExists = await page.locator(`a:has-text("${currentPage}"), .pagination a:has-text("${currentPage}")`).first().isVisible().catch(() => false);
      if (!nextPageExists) break;

      progress.currentPage = currentPage;
      progress.message = `Scraping page ${currentPage}...`;
      scrapeJobs.set(jobId, { ...progress });

      await page.locator(`a:has-text("${currentPage}")`).first().click();
      await page.waitForTimeout(2000);

      const pageHtml = await page.content();
      const pageResults = parseSmartGovResults(pageHtml);
      if (pageResults.length === 0) break;

      allResults.push(...pageResults);
      progress.resultsFound = allResults.length;

      const newFromPage = await saveResultsBatch(pageResults, databaseId, queryId);
      totalNewResults += newFromPage;

      currentPage++;
    }

    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Scraper error on ${databaseName}: ${error.message}`, "scraper");
  }

  return allResults;
}

function parseSmartGovResults(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];

  const noResults = $(".alert-info").text().trim();
  if (noResults.includes("No results found")) return results;

  $("article[role='navigation'], article").each((_i, el) => {
    const $el = $(el);
    const permitNumber = $el.find(".search-result-title a").text().trim() || null;
    if (!permitNumber) return;

    const cols = $el.find(".row .col-lg-3");
    let description: string | null = null;
    let status: string | null = null;
    let issuedDate: string | null = null;
    let address: string | null = null;
    let city: string | null = null;
    let applicantName: string | null = null;
    let contractorName: string | null = null;
    let permitType: string | null = null;

    if (cols.length >= 1) {
      const col1Divs = cols.eq(0).find("div");
      if (col1Divs.length >= 1) description = col1Divs.eq(0).text().trim() || null;
      if (col1Divs.length >= 2) {
        const statusText = col1Divs.eq(1).text().trim();
        const datePart = statusText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (datePart) issuedDate = datePart[1];
        status = statusText.replace(/,?\s*\d{1,2}\/\d{1,2}\/\d{4}/, "").trim() || null;
      }
    }

    if (cols.length >= 2) {
      const col2Divs = cols.eq(1).find("div");
      if (col2Divs.length >= 1) address = col2Divs.eq(0).text().trim() || null;
      if (col2Divs.length >= 2) {
        city = col2Divs.eq(1).text().trim() || null;
        if (address && city) address = `${address}, ${city}`;
      }
    }

    if (cols.length >= 3) {
      const col3Divs = cols.eq(2).find("div");
      const names: string[] = [];
      col3Divs.each((_j, nameEl) => {
        const name = $(nameEl).text().trim();
        if (name) names.push(name);
      });
      for (const name of names) {
        const upper = name.toUpperCase();
        if (upper.includes("LLC") || upper.includes("INC") || upper.includes("CORP") ||
            upper.includes("COMPANY") || upper.includes("SERVICES") || upper.includes("HEATING") ||
            upper.includes("PLUMBING") || upper.includes("ELECTRIC") || upper.includes("CONSTRUCTION") ||
            upper.includes("CONTRACTING") || upper.includes("ROOFING") || upper.includes("SOLAR") ||
            upper.includes("MECHANICAL") || upper.includes("HVAC") || upper.includes("ENERGY")) {
          contractorName = name;
        } else if (!applicantName) {
          applicantName = name;
        }
      }
    }

    if (description) {
      const ptKeywords = ["Mechanical", "Building", "Plumbing", "Electrical", "Demolition", "Grading", "Land Use", "Fire", "Sign", "Residential", "Commercial"];
      for (const kw of ptKeywords) {
        if (description.toLowerCase().includes(kw.toLowerCase())) {
          permitType = kw;
          break;
        }
      }
    }

    results.push(makeResult({ permitNumber, permitType, status, address, applicantName, contractorName, description, issuedDate }));
  });

  return results;
}

export async function scrapeSkagitCounty(
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    ({ page, context } = await createIsolatedPage());

    let searchTypeParam = "0";
    if (searchType === "permit_number" || searchType === "permit") searchTypeParam = "2";
    else if (searchType === "name" || searchType === "company_name" || searchType === "company") searchTypeParam = "3";
    else if (searchType === "parcel") searchTypeParam = "1";
    else if (searchType === "keyword") searchTypeParam = "2";

    const searchUrl = `https://www.skagitcounty.net/Search/Permits/Search.aspx?SearchType=${searchTypeParam}`;
    log(`Scraper: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    if (searchTypeParam === "3") {
      const lastNameInput = page.locator("#content_txtLastName, input[id*='txtLastName'], input[name*='txtLastName']").first();
      await lastNameInput.waitFor({ state: "visible", timeout: 20000 });
      const parts = searchTerm.split(",").map(s => s.trim());
      await lastNameInput.fill(parts[0] || searchTerm);
      if (parts.length > 1) {
        const firstNameInput = page.locator("#content_txtFirstName, input[id*='txtFirstName'], input[name*='txtFirstName']").first();
        const fnVisible = await firstNameInput.isVisible().catch(() => false);
        if (fnVisible) await firstNameInput.fill(parts[1]);
      }
    } else if (searchTypeParam === "2") {
      const permitInput = page.locator("#content_txtPermit, input[id*='txtPermit'], input[name*='txtPermit']").first();
      await permitInput.waitFor({ state: "visible", timeout: 20000 });
      await permitInput.fill(searchTerm);
    } else if (searchTypeParam === "1") {
      const parcelInput = page.locator("#content_txtParcelID, input[id*='txtParcel'], input[name*='txtParcel']").first();
      await parcelInput.waitFor({ state: "visible", timeout: 20000 });
      await parcelInput.fill(searchTerm);
    } else {
      const houseInput = page.locator("#content_txtHouse, input[id*='txtHouse'], input[name*='txtHouse']").first();
      await houseInput.waitFor({ state: "visible", timeout: 20000 });
      const parts = searchTerm.split(/\s+/);
      await houseInput.fill(parts[0] || searchTerm);
      if (parts.length > 1) {
        const roadInput = page.locator("#content_txtRoad, input[id*='txtRoad'], input[name*='txtRoad']").first();
        const roadVisible = await roadInput.isVisible().catch(() => false);
        if (roadVisible) await roadInput.fill(parts.slice(1).join(" "));
      }
    }

    progress.message = `Clicking search for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const searchBtn = page.locator("input[name='Search'], input[id='Search'], input[type='submit'][value='Search']").first();
    await searchBtn.click();

    await page.waitForTimeout(5000);

    const html = await page.content();
    const results = parseSkagitResults(html);
    allResults.push(...results);
    progress.resultsFound = results.length;
    progress.message = `Found ${results.length} results`;
    scrapeJobs.set(jobId, { ...progress });

    const newFromFirstPage = await saveResultsBatch(results, databaseId, queryId);
    totalNewResults += newFromFirstPage;

    const totalPagesMatch = html.match(/Page \d+ of (\d+)/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : 1;
    progress.totalPages = totalPages;
    scrapeJobs.set(jobId, { ...progress });

    let pageNum = 2;
    while (pageNum <= totalPages) {
      progress.currentPage = pageNum;
      progress.message = `Scraping page ${pageNum} of ${totalPages}...`;
      scrapeJobs.set(jobId, { ...progress });

      const nextBtn = page.locator("input[value='Next']").first();
      const nextExists = await nextBtn.isVisible().catch(() => false);
      if (!nextExists) break;

      const nextDisabled = await nextBtn.getAttribute("disabled").catch(() => null);
      if (nextDisabled) break;

      await nextBtn.click();
      await page.waitForTimeout(4000);

      const pageHtml = await page.content();
      const pageResults = parseSkagitResults(pageHtml);
      if (pageResults.length === 0) break;

      allResults.push(...pageResults);
      progress.resultsFound = allResults.length;

      const newFromPage = await saveResultsBatch(pageResults, databaseId, queryId);
      totalNewResults += newFromPage;

      pageNum++;
    }

    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Scraper error on ${databaseName}: ${error.message}`, "scraper");
  }

  return allResults;
}

function parseSkagitResults(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];

  const listTable = $("table.List");
  if (listTable.length === 0) return results;

  const headerRows = listTable.find("tr.Header");
  if (headerRows.length < 2) return results;

  const headers: string[] = [];
  headerRows.eq(1).find("td").each((_i, el) => {
    headers.push($(el).text().trim().toLowerCase());
  });

  listTable.find("tr.tr1, tr.tr2").each((_i, row) => {
    const $row = $(row);
    const cells: string[] = [];
    $row.find("td").each((_j, cell) => {
      const link = $(cell).find("a[href*='Permit.aspx']").first();
      if (link.length > 0) {
        cells.push(link.text().trim());
      } else {
        cells.push($(cell).text().trim());
      }
    });

    if (cells.length < 5) return;

    const getCol = (keyword: string): string | null => {
      const idx = headers.findIndex(h => h.includes(keyword));
      if (idx >= 0 && idx < cells.length && cells[idx]) return cells[idx];
      return null;
    };

    const permitNumber = getCol("permit") || cells[0] || null;
    if (!permitNumber) return;

    const permitType = getCol("type");
    const status = getCol("status");
    const address = getCol("address");
    const applicantName = getCol("owner");
    const issuedDate = getCol("applied");

    results.push(makeResult({
      permitNumber,
      permitType,
      status,
      address: address || null,
      applicantName: applicantName || null,
      issuedDate: issuedDate || null,
    }));
  });

  return results;
}

function extractEnerGovAddress(item: any): string | null {
  if (item.Addresses && Array.isArray(item.Addresses) && item.Addresses.length > 0) {
    const addr = item.Addresses[0];
    return addr.FullAddress || [addr.AddressLine1, addr.AddressLine2, addr.AddressLine3].filter(Boolean).join(" ").trim() || null;
  }
  const raw = item.Address || item.MainAddress || item.Location || item.FullAddress || null;
  if (raw && typeof raw === "object") {
    return raw.FullAddress || [raw.AddressLine1, raw.AddressLine2].filter(Boolean).join(" ").trim() || null;
  }
  return typeof raw === "string" ? raw : null;
}

// Shared portal hosts (aca-prod.accela.com, tylerhost.net) answer the odd request with a momentary 502/503/504.
// One retry keeps a daily schedule from missing its day over a blip; a portal that stays down still fails.
async function gotoRetryingGatewayErrors(page: Page, url: string) {
  const open = () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const first = await open();
  if (!first || ![502, 503, 504].includes(first.status())) return first;
  await page.waitForTimeout(5_000);
  return open();
}

export function enerGovApplicationUrl(searchUrl: string): string {
  const url = new URL(searchUrl);
  const match = url.pathname.match(/^(.*\/selfservice)(?:\/|$)/i);
  if (!match) throw new Error('Configured portal is not an EnerGov Self Service application');
  return `${url.origin}${match[1]}`;
}

export function enerGovSearchRequest(template: any, searchTerm: string, searchType: string): any {
  const payload = structuredClone(template);
  if (!payload.PermitCriteria) throw new Error('EnerGov UI did not provide permit criteria');
  const advanced = ['address', 'permit', 'parcel'].includes(searchType);
  payload.SearchModule = advanced ? 2 : 1;
  payload.FilterModule = advanced ? 1 : 2;
  payload.Keyword = advanced ? '' : searchTerm;
  payload.PermitCriteria.Address = searchType === 'address' ? searchTerm : null;
  payload.PermitCriteria.PermitNumber = searchType === 'permit' ? searchTerm : null;
  payload.PermitCriteria.ParcelNumber = searchType === 'parcel' ? searchTerm : null;
  payload.PermitCriteria.PageNumber = advanced ? 1 : 0;
  payload.PermitCriteria.PageSize = advanced ? 50 : 0;
  payload.PageNumber = advanced ? 0 : 1;
  payload.PageSize = advanced ? 0 : 50;
  return payload;
}

export function enerGovReplayHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => {
    return !key.startsWith(':') && !['content-length', 'host', 'connection', 'cookie'].includes(key.toLowerCase());
  }));
}

export function enerGovPageRequest(template: any, pageNumber: number): any {
  const payload = structuredClone(template);
  // Basic search pages at the root; advanced permit search pages inside PermitCriteria.
  const criteria = payload.SearchModule === 2 ? payload.PermitCriteria : payload;
  if (!criteria || (payload.SearchModule !== 2 && payload.FilterModule !== 2)) {
    throw new Error('EnerGov request is not scoped to permits');
  }
  criteria.PageNumber = pageNumber;
  return payload;
}

export function parseEnerGovResponse(data: any): { results: ScrapeResult[]; totalPages: number } {
  if (data?.Success === false || !Array.isArray(data?.Result?.EntityResults)) {
    throw new Error(`EnerGov search failed: ${data?.ErrorMessage || data?.ValidationErrorMessage || 'invalid search response'}`);
  }
  const result = data.Result;
  const results = result.EntityResults.map((item: any) => {
    if (item.ModuleName != null && Number(item.ModuleName) !== 2) {
      throw new Error('EnerGov returned non-permit records for a permit search');
    }
    if (!item.CaseNumber && !item.PermitNumber) throw new Error('EnerGov record has no permit number');
    return makeResult({
      permitNumber: String(item.CaseNumber || item.PermitNumber),
      permitType: item.CaseType || item.PermitType || item.CaseWorkclass,
      status: item.CaseStatus || item.Status,
      address: extractEnerGovAddress(item),
      applicantName: item.ApplicantName || item.ContactName,
      contractorName: item.ContractorName || item.CompanyName,
      description: item.Description || item.WorkDescription || item.ProjectName,
      issuedDate: item.IssueDate || item.IssuedDate,
      expirationDate: item.ExpireDate || item.ExpirationDate,
      finalizedDate: item.FinalDate,
      parcelNumber: item.MainParcel || item.ParcelNumber,
      caseId: item.CaseId || item.EntityId,
    });
  });
  const totalPages = Number(result.TotalPages);
  if (!Number.isInteger(totalPages) || totalPages < 0) throw new Error('EnerGov response has invalid pagination');
  return { results, totalPages };
}

export function assertEnerGovTenant(searchUrl: string, tenants: any[], headers: Record<string, string>): void {
  if (!tenants.length) return; // Older installations do not expose GetTenants.
  const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const selected = tenants.find(t => String(t.TenantID) === normalized.tenantid && t.TenantName === normalized.tenantname);
  if (!selected) throw new Error('EnerGov tenant headers do not match the portal tenant list');
  const app = enerGovApplicationUrl(searchUrl);
  const suffix = decodeURIComponent(new URL(searchUrl).pathname.slice(new URL(app).pathname.length)).replace(/^\/|\/$/g, '');
  if (suffix && ![selected.TenantUrl, selected.TenantName].some(v => String(v).toLowerCase() === suffix.toLowerCase())) {
    throw new Error('EnerGov selected a different tenant from the configured portal');
  }
  if (tenants.length > 1 && !suffix) throw new Error('EnerGov portal has multiple tenants; a jurisdiction-specific tenant URL is required');
}

export async function scrapeEnerGov(
  searchTerm: string, searchType: string, databaseId: number, databaseName: string,
  queryId: number, jobId: string, portalSearchUrl?: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let page: Page | null = null;
  let context: BrowserContext | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    if (!portalSearchUrl) throw new Error('EnerGov requires a jurisdiction-specific portal URL');
    if (!searchTerm.trim()) throw new Error('Search value is empty');
    const applicationUrl = enerGovApplicationUrl(portalSearchUrl);
    ({ page, context } = await createIsolatedPage());
    const activeContext = context;
    deadline = setTimeout(() => { expired = true; void activeContext.close().catch(() => {}); }, 120_000);
    page.setDefaultTimeout(20_000);
    const tenantResponses: Promise<any[]>[] = [];
    page.on('response', response => {
      if (/\/api\/Home\/GetTenants(?:\?|$)/i.test(response.url()) && response.ok()) {
        tenantResponses.push(response.json().then(data => Array.isArray(data.Result) ? data.Result : []).catch(() => []));
      }
    });
    const url = new URL(portalSearchUrl);
    url.hash = '/search';
    const landing = await gotoRetryingGatewayErrors(page, url.href);
    if (landing && !landing.ok()) throw new Error(`EnerGov portal returned HTTP ${landing.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.locator('#SearchModule option').filter({ hasText: /^Permit$/ }).waitFor({ state: 'attached' });
    // Secondary data initializes the form asynchronously after the first options appear.
    await page.waitForTimeout(1000);
    await page.locator('#SearchModule').selectOption({ label: 'Permit' });
    await page.locator('#button-Advanced').waitFor({ state: 'visible' });
    if (!['address', 'permit', 'parcel', 'keyword', 'name', 'company', 'company_name'].includes(searchType)) {
      throw new Error(`EnerGov does not support ${searchType} search`);
    }
    // Bootstrap from a real permit keyword request. Its complete template and
    // tenant headers also serve the advanced address/permit/parcel endpoint.
    // Public name/company searches use this same keyword index.
    await page.locator('#SearchKeyword').fill(searchTerm);
    await page.locator('#button-Search').focus();
    await page.waitForTimeout(750);
    const responsePromise = page.waitForResponse(r => {
      if (!/\/api\/energov\/search\/search(?:\?|$)/i.test(r.url()) || r.request().method() !== 'POST') return false;
      // Selecting the module can itself start a search. Ignore those late
      // responses and capture only the request submitted with this term.
      return r.request().postDataJSON()?.Keyword === searchTerm;
    }, { timeout: 30_000 });
    const [response] = await Promise.all([responsePromise, page.locator('#button-Search').click()]);
    if (!response.ok()) throw new Error(`EnerGov search returned HTTP ${response.status()}`);
    const apiUrl = response.url();
    if (new URL(apiUrl).origin !== new URL(applicationUrl).origin ||
        !new URL(apiUrl).pathname.toLowerCase().startsWith(new URL(applicationUrl).pathname.toLowerCase() + '/api/')) {
      throw new Error('EnerGov search redirected outside the configured application');
    }
    const headers = enerGovReplayHeaders(await response.request().allHeaders());
    const tenants = (await Promise.all(tenantResponses)).find(t => t.length) || [];
    assertEnerGovTenant(portalSearchUrl, tenants, headers);
    // Reuse the complete live UI payload, including version-specific criteria.
    // Guessing a reduced payload causes HTTP 500 on current Self Service releases.
    // Build the observed advanced request explicitly; the bootstrap keyword
    // response is not the user's address search and must never be saved.
    const template = enerGovSearchRequest(response.request().postDataJSON(), searchTerm, searchType);
    const first = await context.request.post(apiUrl, { headers, data: template, timeout: 20_000 });
    if (!first.ok()) throw new Error(`EnerGov search returned HTTP ${first.status()}`);
    let data = await first.json();
    const seen = new Set<string>();
    for (let pg = 1; pg <= 100; pg++) {
      const parsed = parseEnerGovResponse(data);
      const fresh = parsed.results.filter(r => !seen.has(r.caseId || r.permitNumber!));
      if (parsed.results.length && !fresh.length) throw new Error('EnerGov pagination repeated a page');
      for (const r of fresh) { seen.add(r.caseId || r.permitNumber!); allResults.push(r); }
      progress.currentPage = pg;
      progress.totalPages = parsed.totalPages;
      progress.resultsFound = allResults.length;
      progress.message = `Found ${allResults.length} permits; reading page ${pg} of ${parsed.totalPages}`;
      scrapeJobs.set(jobId, { ...progress });
      if (pg >= parsed.totalPages) break;
      if (!parsed.results.length) throw new Error('EnerGov pagination ended before the advertised last page');
      if (pg === 100) throw new Error('EnerGov search exceeds 100 pages; narrow the search');
      // BrowserContext.request carries the same cookies as the portal session.
      const next = await context.request.post(apiUrl, {
        headers, data: enerGovPageRequest(template, pg + 1), timeout: 20_000,
      });
      if (!next.ok()) throw new Error(`EnerGov page ${pg + 1} returned HTTP ${next.status()}`);
      data = await next.json();
    }
    const newCount = await saveResultsBatch(allResults, databaseId, queryId);
    await finalizeScrape(allResults.length, newCount, databaseId, databaseName, jobId, progress);
  } catch (error: any) {
    if (allResults.length) await saveResultsBatch(allResults, databaseId, queryId);
    progress.status = 'error';
    progress.message = expired ? 'EnerGov search exceeded 120 seconds; narrow the search' : `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`EnerGov scraper error on ${databaseName}: ${progress.message}`, 'scraper');
  } finally {
    clearTimeout(deadline);
    if (page && context) await closeIsolatedPage(page, context);
  }
  return allResults;
}

export async function scrapeETRAKiT(
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    ({ page, context } = await createIsolatedPage());

    let searchUrl: string;
    if (searchType === "company_name" || searchType === "company" || searchType === "name") {
      searchUrl = "https://permits.cob.org/eTRAKiT/Search/contractor.aspx";
    } else {
      searchUrl = "https://permits.cob.org/eTRAKiT/Search/permit.aspx";
    }
    log(`Scraper: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);

    const onSearchPage = await page.locator("input[id*='txtSearchString'], input[id*='txtSearch'], #cphBody_txtSearchString").first().isVisible().catch(() => false);

    if (!onSearchPage) {
      const guestLink = page.locator("a:has-text('Guest'), a:has-text('guest'), a:has-text('Continue as Guest'), a:has-text('Search'), button:has-text('Guest')").first();
      const guestVisible = await guestLink.isVisible().catch(() => false);
      if (guestVisible) {
        await guestLink.click();
        await page.waitForTimeout(3000);

        if (searchType === "company_name" || searchType === "company" || searchType === "name") {
          await page.goto("https://permits.cob.org/eTRAKiT/Search/contractor.aspx", { waitUntil: "networkidle", timeout: 45000 });
          await page.waitForTimeout(2000);
        }
      } else {
        if (searchType === "company_name" || searchType === "company" || searchType === "name") {
          const contractorLink = page.locator("a[href*='contractor'], a:has-text('Contractor'), a:has-text('Contractor Search')").first();
          const clVisible = await contractorLink.isVisible().catch(() => false);
          if (clVisible) {
            await contractorLink.click();
            await page.waitForTimeout(3000);
          }
        } else {
          const permitSearchLink = page.locator("a[href*='permit'], a:has-text('Permit Search'), a:has-text('Permits')").first();
          const linkVisible = await permitSearchLink.isVisible().catch(() => false);
          if (linkVisible) {
            await permitSearchLink.click();
            await page.waitForTimeout(3000);
          }
        }
      }
    }

    const searchInput = page.locator("input[id*='txtSearchString'], input[id*='txtSearch'], #cphBody_txtSearchString, input[name*='SearchString']").first();
    const inputVisible = await searchInput.isVisible().catch(() => false);

    if (!inputVisible) {
      progress.status = "error";
      progress.message = "eTRAKiT requires login to search permits. Please visit the site directly.";
      scrapeJobs.set(jobId, { ...progress });
      await closeIsolatedPage(page, context);
      return allResults;
    }

    await searchInput.fill(searchTerm);

    progress.message = `Searching ${searchType === "company_name" || searchType === "name" ? "contractors" : "permits"} for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const searchBtn = page.locator("input[id*='btnSearch'], button[id*='btnSearch'], #cphBody_btnSearch, input[type='submit'][value='Search']").first();
    await searchBtn.click();
    await page.waitForTimeout(5000);

    const html = await page.content();
    log(`eTRAKiT HTML length for "${searchTerm}" (${searchType}): ${html.length}`, "scraper");

    const results = parseETRAKiTResults(html);
    allResults.push(...results);

    if (results.length === 0 && (searchType === "company_name" || searchType === "name")) {
      log(`eTRAKiT contractor search found 0 results for "${searchTerm}", checking for contractor links...`, "scraper");

      const contractorRows = page.locator("table tr a, #cphBody_dgSearchResults a, table[id*='SearchResults'] a");
      const contractorCount = await contractorRows.count();
      log(`eTRAKiT found ${contractorCount} contractor links`, "scraper");

      if (contractorCount > 0 && contractorCount <= 5) {
        for (let i = 0; i < Math.min(contractorCount, 3); i++) {
          try {
            const link = contractorRows.nth(i);
            const linkText = await link.textContent();
            if (!linkText || linkText.trim().length < 2) continue;

            progress.message = `Checking contractor "${linkText?.trim()}" permits...`;
            scrapeJobs.set(jobId, { ...progress });

            await link.click();
            await page.waitForTimeout(3000);
            const detailHtml = await page.content();
            const detailResults = parseETRAKiTResults(detailHtml);
            for (const r of detailResults) {
              if (!r.contractorName) r.contractorName = linkText?.trim() || null;
              allResults.push(r);
            }
            log(`eTRAKiT contractor "${linkText?.trim()}" had ${detailResults.length} permits`, "scraper");
            await page.goBack({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(2000);
          } catch (err: any) {
            log(`eTRAKiT contractor detail error: ${err.message}`, "scraper");
          }
        }
      }

      if (allResults.length === 0) {
        log(`eTRAKiT contractor search found nothing, trying permit search with "${searchTerm}"...`, "scraper");
        progress.message = `Trying permit search for "${searchTerm}"...`;
        scrapeJobs.set(jobId, { ...progress });

        await page.goto("https://permits.cob.org/eTRAKiT/Search/permit.aspx", { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(2000);
        const permitInput = page.locator("input[id*='txtSearchString'], input[id*='txtSearch'], #cphBody_txtSearchString, input[name*='SearchString']").first();
        const piVisible = await permitInput.isVisible().catch(() => false);
        if (piVisible) {
          await permitInput.fill(searchTerm);
          const pSearchBtn = page.locator("input[id*='btnSearch'], button[id*='btnSearch'], #cphBody_btnSearch, input[type='submit'][value='Search']").first();
          await pSearchBtn.click();
          await page.waitForTimeout(5000);
          const permitHtml = await page.content();
          const permitResults = parseETRAKiTResults(permitHtml);
          allResults.push(...permitResults);
          log(`eTRAKiT permit search fallback found ${permitResults.length} results for "${searchTerm}"`, "scraper");
        }
      }
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });

    const newFromBatch = await saveResultsBatch(allResults, databaseId, queryId);
    totalNewResults += newFromBatch;
    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Scraper error on ${databaseName}: ${error.message}`, "scraper");
  }

  return allResults;
}

function parseETRAKiTResults(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];

  $("table[id*='SearchResults'] tr, table[id*='dgResults'] tr, #cphBody_dgSearchResults tr").each((_i, row) => {
    const $row = $(row);
    if ($row.find("th").length > 0) return;

    const cells: string[] = [];
    $row.find("td").each((_j, cell) => {
      cells.push($(cell).text().trim());
    });

    if (cells.length < 2) return;

    const permitLink = $row.find("a").first().text().trim();
    const permitNumber = permitLink || cells[0] || null;
    if (!permitNumber) return;

    results.push(makeResult({
      permitNumber,
      permitType: cells.length > 1 ? cells[1] : null,
      status: cells.length > 2 ? cells[2] : null,
      address: cells.length > 3 ? cells[3] : null,
      applicantName: cells.length > 4 ? cells[4] : null,
      description: cells.length > 5 ? cells[5] : null,
      issuedDate: cells.length > 6 ? cells[6] : null,
    }));
  });

  return results;
}

// Module names are jurisdiction-specific (Building, Permits, DevServices, ...).
// Only follow links within the configured agency, even on shared Accela hosts.
export function accelaSearchUrl(searchUrl: string, html: string): string {
  const source = new URL(searchUrl);
  const agency = source.pathname.split('/').filter(Boolean)[0];
  if (!agency) throw new Error('Accela portal has no agency path');
  if (/\/Cap\/CapHome\.aspx$/i.test(source.pathname)) return source.href;
  const $ = cheerio.load(html);
  const candidates: { url: string; label: string }[] = [];
  $('a[href]').each((_i, element) => {
    const href = $(element).attr('href')!;
    try {
      const target = new URL(href, source);
      if (target.origin === source.origin && target.pathname.split('/')[1]?.toLowerCase() === agency.toLowerCase()
          && /\/Cap\/CapHome\.aspx$/i.test(target.pathname)) {
        target.searchParams.delete('IsToShowInspection');
        target.searchParams.delete('globalsearch');
        candidates.push({ url: target.href, label: $(element).text().trim() });
      }
    } catch {}
  });
  const permitLink = candidates.find(c => /building|^permits$|development services/i.test(c.label));
  if (permitLink) return permitLink.url;
  return new URL(`/${agency}/Cap/CapHome.aspx?module=Building&TabName=Home`, source).href;
}

export function parseAccelaResults(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];
  // A single match redirects to CapDetail instead of rendering a results grid.
  const detailNumber = $('#ctl00_PlaceHolderMain_lblPermitNumber').text().trim();
  if (detailNumber) {
    return [makeResult({
      permitNumber: detailNumber,
      permitType: $('#ctl00_PlaceHolderMain_lblPermitType').text().trim() || null,
      status: $('#ctl00_PlaceHolderMain_lblRecordStatus').text().trim() || null,
      address: $("[id$='_workLocation_updatePanel']").text().replace(/\s+/g, ' ').trim().replace(/\s*\*$/, '').trim() || null,
    })];
  }
  $("table[id*='gdvPermitList'], table[id*='GridView'], table[id*='dgPermit']").each((_i, table) => {
    const rows = $(table).children('tbody').children('tr').add($(table).children('tr'));
    const header = rows.filter((_j, row) => $(row).children('th').length > 0).first();
    const headers = header.children('th').map((_j, th) => $(th).text().trim().toLowerCase()).get();
    rows.each((_j, row) => {
      const cells = $(row).children('td');
      if (!headers.length || cells.length !== headers.length) return;
      const value = (pattern: RegExp) => {
        const i = headers.findIndex(h => pattern.test(h));
        return i >= 0 ? cells.eq(i).text().replace(/\s+/g, ' ').trim() || null : null;
      };
      const permitNumber = value(/^(record|permit|application) (number|#)$/);
      if (!permitNumber || !/\d/.test(permitNumber)) return;
      results.push(makeResult({
        permitNumber,
        permitType: value(/^(record|permit|application) type$/),
        status: value(/^status$/),
        address: value(/address|location/) || $(row).find("[id$='_lblPermitAddress']").text().replace(/\s+/g, ' ').trim() || value(/^general description$/),
        description: value(/^(permit |work )?description$/) || value(/^project name$/),
        // Application/updated dates must not be mislabeled as issuance dates.
        issuedDate: value(/^issue(d)? date$/),
        expirationDate: value(/^expiration date$/),
        applicantName: value(/applicant|owner/),
        contractorName: value(/contractor|business name/),
      }));
    });
  });
  return [...new Map(results.map(r => [r.permitNumber, r])).values()];
}

export async function scrapeAccela(
  searchUrl: string, searchTerm: string, searchType: string,
  databaseId: number, databaseName: string, queryId: number, jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let page: Page | null = null;
  let context: BrowserContext | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    ({ page, context } = await createIsolatedPage());
    const activeContext = context;
    deadline = setTimeout(() => { expired = true; void activeContext.close().catch(() => {}); }, 120_000);
    page.setDefaultTimeout(15_000);
    const landing = await gotoRetryingGatewayErrors(page, searchUrl);
    if (landing && !landing.ok()) throw new Error(`Accela portal returned HTTP ${landing.status()}`);
    const target = accelaSearchUrl(searchUrl, await page.content());
    if (page.url() !== target) {
      const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (response && !response.ok()) throw new Error(`Accela search returned HTTP ${response.status()}`);
    }
    // A redirect must never silently switch to another agency on a shared host.
    const configured = new URL(searchUrl);
    const actual = new URL(page.url());
    if (actual.origin !== configured.origin || actual.pathname.split('/')[1]?.toLowerCase() !== configured.pathname.split('/')[1]?.toLowerCase()) {
      throw new Error('Accela redirected outside the configured agency');
    }
    const form = page.locator("a[id*='btnNewSearch']").first();
    await form.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (!(await form.isVisible())) throw new Error('Accela permit search unavailable (login required or invalid module)');
    let selector: string;
    let value = searchTerm.trim();
    if (!value) throw new Error('Search value is empty');
    if (searchType === 'address') {
      const parts = value.match(/^(\d+)\s+(.+)$/);
      if (parts) {
        await page.locator("input[id*='txtGSNumber_ChildControl0'], input[id*='txtHouseNumberFrom']").first().fill(parts[1]);
        value = parts[2];
      }
      selector = "input[id*='txtGSStreetName'], input[id*='txtStreetName']";
    } else if (searchType === 'permit') {
      selector = "input[id*='txtGSPermitNumber'], input[id*='txtPermitNumber']";
    } else if (searchType === 'keyword') {
      selector = "input[id*='txtGSProjectName']";
    } else if (searchType === 'name') {
      selector = "input[id*='txtGSLastName']";
    } else if (searchType === 'company' || searchType === 'company_name') {
      selector = "input[id*='txtGSBusiName']";
    } else {
      throw new Error(`Accela does not support ${searchType} search`);
    }
    const input = page.locator(selector).first();
    if (!(await input.isVisible())) throw new Error(`Accela does not expose a public ${searchType} search field`);
    await input.fill(value);
    // Submit through WebForms so viewstate, cookies and event validation remain intact.
    const submit = async (button: ReturnType<Page['locator']>) => {
      const responsePromise = page!.waitForResponse(r => r.request().method() === 'POST' && /CapHome\.aspx/i.test(r.url()), { timeout: 30_000 });
      const [response] = await Promise.all([responsePromise, button.click()]);
      if (!response.ok()) throw new Error(`Accela search returned HTTP ${response.status()}`);
      await response.finished();
      await page!.waitForLoadState('domcontentloaded');
      await page!.waitForFunction(() => {
        const manager = (window as any).Sys?.WebForms?.PageRequestManager?.getInstance();
        return !manager?.get_isInAsyncPostBack();
      });
    };
    await submit(form);
    // A one-record WebForms response can trigger a second navigation to CapDetail.
    // Wait for the actual result instead of reading the transient CapHome document.
    await page.waitForFunction(() => {
      return !!document.querySelector("#ctl00_PlaceHolderMain_lblPermitNumber, table[id*='gdvPermitList'] [id*='lblPermitNumber']") ||
        /no records found|no records match|no results found|search returned no results/i.test(document.body?.innerText || '');
    }, undefined, { timeout: 15_000 });
    const seen = new Set<string>();
    for (let pg = 1; pg <= 100; pg++) {
      const html = await page.content();
      const batch = parseAccelaResults(html);
      const fresh = batch.filter(r => !seen.has(r.permitNumber!));
      if (batch.length && !fresh.length) throw new Error('Accela pagination repeated a page');
      for (const r of fresh) { seen.add(r.permitNumber!); allResults.push(r); }
      progress.resultsFound = allResults.length;
      progress.currentPage = pg;
      progress.totalPages = pg;
      progress.message = `Found ${allResults.length} records; reading page ${pg}`;
      scrapeJobs.set(jobId, { ...progress });
      if (!batch.length) {
        const text = cheerio.load(html)('body').text();
        if (!/no records found|no record(s)? (were )?found|no results found|no records match|search returned no results/i.test(text)) {
          throw new Error('Accela did not return a results grid or an explicit no-results response');
        }
        break;
      }
      const next = page.locator("table[id*='gdvPermitList'] a, table[id*='GridView'] a").filter({ hasText: /^Next\s*>?$/ }).first();
      if (!(await next.isVisible()) || !(await next.getAttribute('href')) || await next.getAttribute('disabled') !== null) break;
      if (pg === 100) throw new Error('Accela search exceeds 100 pages; narrow the search');
      const previous = batch.map(r => r.permitNumber).join('|');
      await submit(next);
      if (parseAccelaResults(await page.content()).map(r => r.permitNumber).join('|') === previous) {
        throw new Error('Accela pagination did not advance');
      }
    }
    const newCount = await saveResultsBatch(allResults, databaseId, queryId);
    await finalizeScrape(allResults.length, newCount, databaseId, databaseName, jobId, progress);
  } catch (error: any) {
    // Preserve retrieved pages, but expose the incomplete search to callers.
    if (allResults.length) await saveResultsBatch(allResults, databaseId, queryId);
    progress.status = 'error';
    progress.message = expired ? 'Accela search exceeded 120 seconds; narrow the search' : `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Accela scraper error on ${databaseName}: ${progress.message}`, 'scraper');
  } finally {
    clearTimeout(deadline);
    if (page && context) await closeIsolatedPage(page, context);
  }
  return allResults;
}

function parseClick2GovResultsTable(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];

  $("table").each((_ti, table) => {
    const $table = $(table);
    const headers: string[] = [];
    $table.find("thead th, tr:first-child th").each((_j, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    $table.find("tbody tr, tr").each((_i, row) => {
      const $row = $(row);
      if ($row.find("th").length > 0) return;
      const cells: string[] = [];
      $row.find("td").each((_j, cell) => {
        const linkText = $(cell).find("a").first().text().trim();
        cells.push(linkText || $(cell).text().trim());
      });
      if (cells.length < 4) return;

      let permitNumber: string | null = null;
      let address: string | null = null;
      let parcelNumber: string | null = null;
      let applicantName: string | null = null;
      let permitType: string | null = null;
      let status: string | null = null;

      if (headers.length >= 4) {
        for (let j = 0; j < cells.length && j < headers.length; j++) {
          const h = headers[j];
          const v = cells[j];
          if (!v) continue;
          if (h.includes("application") || h.includes("permit") || h.includes("number")) {
            if (!permitNumber) permitNumber = v;
          } else if (h.includes("address") || h.includes("location")) {
            address = v;
          } else if (h.includes("parcel")) {
            parcelNumber = v;
          } else if (h.includes("name") || h.includes("owner") || h.includes("contractor")) {
            applicantName = v;
          } else if (h.includes("type") || h.includes("description")) {
            permitType = v;
          } else if (h.includes("status")) {
            status = v;
          }
        }
      } else {
        permitNumber = cells[0] || null;
        address = cells.length > 1 ? cells[1] : null;
        parcelNumber = cells.length > 2 ? cells[2] : null;
        applicantName = cells.length > 3 ? cells[3] : null;
        permitType = cells.length > 4 ? cells[4] : null;
        status = cells.length > 5 ? cells[5] : null;
      }

      if (!permitNumber || permitNumber.toLowerCase().includes("showing") || permitNumber.toLowerCase().includes("previous")) return;

      results.push(makeResult({
        permitNumber,
        address,
        parcelNumber,
        applicantName,
        permitType,
        status,
      }));
    });
  });

  return results;
}

export async function scrapeClick2Gov(
  searchUrl: string,
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  const MAX_PAGES = 500;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    ({ page, context } = await createIsolatedPage());
    const activeContext = context;
    deadline = setTimeout(() => { expired = true; void activeContext.close().catch(() => {}); }, 90_000);
    page.setDefaultTimeout(10_000);

    log(`Click2Gov: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#searchMethod").isVisible())) {
      const selectPermit = page.getByRole('link', { name: 'Select Permit', exact: true });
      if (!(await selectPermit.isVisible())) throw new Error('Click2Gov public permit search is unavailable');
      await selectPermit.click();
    }
    await page.locator('#searchMethod').waitFor({ state: 'visible', timeout: 10_000 });

    const searchMethodSelect = page.locator("#searchMethod, select[name='searchMethod']").first();
    const hasMethodDropdown = await searchMethodSelect.isVisible().catch(() => false);
    log(`Click2Gov: hasMethodDropdown=${hasMethodDropdown}`, "scraper");

    let formDivId = "";

    if (searchType === "address") {
      formDivId = "is1";
      if (hasMethodDropdown) {
        await searchMethodSelect.selectOption("1");
        await page.waitForTimeout(1500);
      }
      const streetNumInput = page.locator("#parcel\\.streetNumber, input[name='parcel.streetNumber']").first();
      const streetNameInput = page.locator("#parcel\\.streetName, input[name='parcel.streetName']").first();
      const hasSplitFields = await streetNumInput.isVisible().catch(() => false);

      if (hasSplitFields) {
        const parts = searchTerm.match(/^(\d+)\s+(.+)/);
        if (parts) {
          await streetNumInput.fill(parts[1]);
          if (await streetNameInput.isVisible().catch(() => false)) {
            await streetNameInput.fill(parts[2]);
          }
        } else {
          if (await streetNameInput.isVisible().catch(() => false)) {
            await streetNameInput.fill(searchTerm);
          }
        }
        log(`Click2Gov: Filled address fields (split mode)`, "scraper");
      } else {
        const singleAddrInput = page.locator("input[name*='address'], input[name*='Address'], input[id*='address']").first();
        if (await singleAddrInput.isVisible().catch(() => false)) {
          await singleAddrInput.fill(searchTerm);
          log(`Click2Gov: Filled address field (single mode)`, "scraper");
        }
      }
    } else if (searchType === "permit" || searchType === "keyword") {
      formDivId = "is0";
      if (hasMethodDropdown) {
        await searchMethodSelect.selectOption("0");
        await page.waitForTimeout(1500);
      }
      const yearMatch = searchTerm.match(/^(\d{2})[-\s]?(\d+)/);
      if (yearMatch) {
        const yearInput = page.locator("#permit\\.appYear, input[name='permit.appYear']").first();
        const numInput = page.locator("#permit\\.appNumber, input[name='permit.appNumber']").first();
        if (await yearInput.isVisible().catch(() => false)) {
          await yearInput.fill(yearMatch[1]);
        }
        if (await numInput.isVisible().catch(() => false)) {
          await numInput.fill(yearMatch[2]);
        }
        log(`Click2Gov: Filled app year=${yearMatch[1]} number=${yearMatch[2]}`, "scraper");
      } else {
        const appNumInput = page.locator("#permit\\.appNumber, input[name='permit.appNumber'], input[name*='appNumber']").first();
        if (await appNumInput.isVisible().catch(() => false)) {
          await appNumInput.fill(searchTerm);
        }
      }
    } else if (searchType === "parcel") {
      formDivId = "is2";
      if (hasMethodDropdown) {
        await searchMethodSelect.selectOption("2");
        await page.waitForTimeout(1500);
      }
      const sectionInput = page.locator("#is2 input[name*='section'], #is2 input:first-of-type").first();
      if (await sectionInput.isVisible().catch(() => false)) {
        await sectionInput.fill(searchTerm);
        log(`Click2Gov: Filled parcel field`, "scraper");
      }
    } else if (searchType === "name" || searchType === "company" || searchType === "company_name") {
      formDivId = "is3";
      if (hasMethodDropdown) {
        await searchMethodSelect.selectOption("3");
        await page.waitForTimeout(1500);
      }
      const matchSelect = page.locator("#searchNameSearchType, select[name='searchNameSearchType']").first();
      if (await matchSelect.isVisible().catch(() => false)) {
        await matchSelect.selectOption("C");
        log(`Click2Gov: Set match type to Contains`, "scraper");
      }
      const nameInput = page.locator("#searchName, input[name='searchName']").first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(searchTerm);
        log(`Click2Gov: Filled name field with "${searchTerm}"`, "scraper");
      }
    }

    progress.message = `Searching Click2Gov for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const activeFormDiv = formDivId ? page.locator(`#${formDivId}`) : page;
    const continueBtn = activeFormDiv.locator("#continue, input[value*='Continue'], input[type='submit']").first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      log(`Click2Gov: Clicked Continue button in form #${formDivId}`, "scraper");
    } else {
      const anySubmit = page.locator("input[value*='Continue'], input[type='submit']").first();
      if (await anySubmit.isVisible().catch(() => false)) {
        await anySubmit.click();
      } else {
        await page.keyboard.press("Enter");
      }
    }
    await page.waitForTimeout(3000);

    // Locator.textContent() on a missing DataTables widget used to wait 30s
    // on every poll. Wait once for an actual outcome, including plain HTML results.
    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      return !!document.querySelector('table tbody tr td a') ||
        /no matching records|no records (to display|found)|search returned no results|no data available in table|error occurred/i.test(text) ||
        !!document.querySelector('.dataTables_info');
    }, undefined, { timeout: 15_000 }).catch(() => {
      throw new Error('Click2Gov did not return permit results within 15 seconds');
    });
    const bodyText = await page.locator('body').innerText();
    if (/error occurred/i.test(bodyText)) throw new Error('Click2Gov reported a portal error');
    let totalEntries = 0;
    const showingText = await page.locator('.dataTables_info').allTextContents();
    const match = showingText.join(' ').match(/of\s+(\d[\d,]*)/i);
    if (match) totalEntries = Number(match[1].replace(/,/g, ''));
    if (/no matching records|no records (to display|found)|search returned no results|no data available in table/i.test(bodyText)) {
      await finalizeScrape(0, 0, databaseId, databaseName, jobId, progress);
      return allResults;
    }

    const lengthSelect = page.locator("select[name*='_length'], select[name$='_length'], .dataTables_length select").first();
    if (await lengthSelect.isVisible().catch(() => false)) {
      try {
        await lengthSelect.selectOption("100");
        log(`Click2Gov: Changed page length to 100`, "scraper");
        await page.waitForTimeout(5000);
      } catch {
        log(`Click2Gov: Could not change page length to 100`, "scraper");
      }
    }

    async function readVisibleTableRows(): Promise<ScrapeResult[]> {
      const rowData = await page!.evaluate(() => {
        const results: Array<{cells: string[], detailUrl: string | null}> = [];
        const tables = document.querySelectorAll("table");
        for (const table of tables) {
          const rows = table.querySelectorAll("tbody tr");
          if (rows.length === 0) continue;
          for (const row of rows) {
            const htmlRow = row as HTMLTableRowElement;
            if (htmlRow.style.display === "none") continue;
            if (htmlRow.querySelector("th")) continue;
            const cells: string[] = [];
            let detailUrl: string | null = null;
            htmlRow.querySelectorAll("td").forEach((td, idx) => {
              const link = td.querySelector("a");
              if (link) {
                cells.push(link.textContent?.trim() || "");
                if (idx === 0 && link.href) {
                  detailUrl = link.href;
                }
              } else {
                cells.push(td.textContent?.trim() || "");
              }
            });
            if (cells.length >= 4) {
              results.push({ cells, detailUrl });
            }
          }
        }
        return results;
      });

      const parsed: ScrapeResult[] = [];
      for (const { cells, detailUrl } of rowData) {
        const permitNumber = cells[0] || null;
        if (!permitNumber || permitNumber.toLowerCase().includes("showing") || permitNumber.toLowerCase().includes("previous")) continue;
        const result = makeResult({
          permitNumber,
          address: cells.length > 1 ? cells[1] || null : null,
          parcelNumber: cells.length > 2 ? cells[2] || null : null,
          applicantName: cells.length > 3 ? cells[3] || null : null,
          permitType: cells.length > 4 ? cells[4] || null : null,
          status: cells.length > 5 ? cells[5] || null : null,
        });
        if (detailUrl) {
          (result as any).rawData = { detailUrl, platform: "Click2Gov" };
        }
        parsed.push(result);
      }
      return [...new Map(parsed.map(r => [r.permitNumber, r])).values()];
    }

    const pageResults = await readVisibleTableRows();
    if (!pageResults.length) throw new Error('Click2Gov results table could not be parsed');
    allResults.push(...pageResults);
    log(`Click2Gov page 1: parsed ${pageResults.length} results`, "scraper");

    const newFromFirstPage = await saveResultsBatch(pageResults, databaseId, queryId);
    totalNewResults += newFromFirstPage;

    const updatedShowingText = (await page.locator(".dataTables_info").allTextContents()).join(" ");
    if (updatedShowingText) {
      const m = updatedShowingText.match(/of (\d+)/);
      if (m) {
        totalEntries = parseInt(m[1]);
        log(`Click2Gov: Updated totalEntries=${totalEntries} after page length change`, "scraper");
      }
    }

    const hasNextBtn = await page.locator(".dataTables_paginate li.next:not(.disabled) a, .dataTables_paginate > a.next:not(.disabled), a.paginate_button.next:not(.disabled)").first().isVisible().catch(() => false);
    const hasPaginationLinks = totalEntries > allResults.length || hasNextBtn;

    if (hasPaginationLinks && pageResults.length > 0) {
      const perPage = pageResults.length || 10;
      const totalPages = totalEntries > 0
        ? Math.min(Math.ceil(totalEntries / perPage), MAX_PAGES)
        : MAX_PAGES;
      progress.message = `Found ${totalEntries || 'multiple pages of'} results, scraping pages (max ${totalPages})...`;
      scrapeJobs.set(jobId, { ...progress });

      let consecutiveEmpty = 0;
      for (let pg = 2; pg <= totalPages; pg++) {
        try {
          const prevShowingText = (await page.locator(".dataTables_info").allTextContents()).join(" ");

          const nextBtn = page.locator(".dataTables_paginate li.next:not(.disabled) a, .dataTables_paginate > a.next:not(.disabled), a.paginate_button.next:not(.disabled)").first();
          const pageLink = page.locator(`.dataTables_paginate a.paginate_button:has-text("${pg}"), .dataTables_paginate span a:has-text("${pg}")`).first();

          if (await pageLink.isVisible().catch(() => false)) {
            await pageLink.click();
          } else if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click();
          } else {
            log(`Click2Gov: Could not find page ${pg} navigation, stopping`, "scraper");
            break;
          }

          await page!.waitForFunction(
            (prev: string | null) => {
              const el = document.querySelector(".dataTables_info");
              return !!(el && el.textContent !== prev);
            },
            prevShowingText,
            { timeout: 15000 }
          ).catch(() => page!.waitForTimeout(3000));

          await page.waitForTimeout(1000);

          const pgResults = await readVisibleTableRows();

          const existingKeys = new Set(allResults.map(r => r.permitNumber || `${r.address}|${r.applicantName}`));
          const newResults = pgResults.filter(r => {
            const key = r.permitNumber || `${r.address}|${r.applicantName}`;
            return !existingKeys.has(key);
          });

          if (newResults.length === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 2) {
              log(`Click2Gov: 2 consecutive empty pages, stopping at page ${pg}`, "scraper");
              break;
            }
          } else {
            consecutiveEmpty = 0;
          }

          allResults.push(...newResults);

          progress.resultsFound = allResults.length;
          progress.message = `Scraped page ${pg}/${totalPages} (${allResults.length} results so far)...`;
          scrapeJobs.set(jobId, { ...progress });

          if (newResults.length > 0) {
            const newFromPage = await saveResultsBatch(newResults, databaseId, queryId);
            totalNewResults += newFromPage;
          }

          log(`Click2Gov page ${pg}: parsed ${pgResults.length} rows, ${newResults.length} new (${allResults.length} total)`, "scraper");
        } catch (pgErr: any) {
          log(`Click2Gov pagination error on page ${pg}: ${pgErr.message}`, "scraper");
          throw pgErr;
        }
      }
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Click2Gov total results for "${searchTerm}" on ${databaseName}: ${allResults.length}`, "scraper");

    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
  } catch (error: any) {
    progress.status = "error";
    progress.message = expired ? "Click2Gov search exceeded 90 seconds; narrow the search" : `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Click2Gov scraper error on ${databaseName}: ${error.message}`, "scraper");
  } finally {
    clearTimeout(deadline);
    if (page && context) await closeIsolatedPage(page, context);
  }

  return allResults;
}

export async function scrapeFTGPortal(
  searchUrl: string,
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    ({ page, context } = await createIsolatedPage());

    log(`FTG Portal: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);

    if (searchType === "address") {
      const addrInput = page.locator("input[id*='Location'], input[id*='location'], input[name*='Location'], input[id*='Street'], input[name*='Street']").first();
      if (await addrInput.isVisible().catch(() => false)) {
        await addrInput.fill(searchTerm);
      }
    } else if (searchType === "permit" || searchType === "keyword") {
      const permitInput = page.locator("input[id*='PermitNumber'], input[id*='permit'], input[id*='ApplicationID'], input[name*='PermitNumber']").first();
      if (await permitInput.isVisible().catch(() => false)) {
        await permitInput.fill(searchTerm);
      }
    } else if (searchType === "name" || searchType === "company" || searchType === "company_name") {
      const contractorInput = page.locator("input[id*='txtContractor'], input[id*='Contractor']").first();
      const businessInput = page.locator("input[id*='txtBusinessName'], input[id*='BusinessName']").first();
      const ownerInput = page.locator("input[id*='txtOwnerName'], input[id*='Owner']").first();
      
      if (await contractorInput.isVisible().catch(() => false)) {
        await contractorInput.fill(searchTerm);
        log(`FTG Portal: Filled Contractor/Agent with "${searchTerm}"`, "scraper");
      } else if (await businessInput.isVisible().catch(() => false)) {
        await businessInput.fill(searchTerm);
        log(`FTG Portal: Filled Business Name with "${searchTerm}"`, "scraper");
      } else if (await ownerInput.isVisible().catch(() => false)) {
        await ownerInput.fill(searchTerm);
        log(`FTG Portal: Filled Owner Name with "${searchTerm}"`, "scraper");
      }
    }

    progress.message = `Searching FTG Portal for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const searchBtn = page.locator("input[id*='btnSearch'][value='Search'], input[value='Search']").first();
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click();
    } else {
      const altBtn = page.locator("input[type='submit'], button[type='submit']").first();
      if (await altBtn.isVisible().catch(() => false)) {
        await altBtn.click();
      }
    }
    await page.waitForTimeout(8000);

    const html = await page.content();
    const $ = cheerio.load(html);

    $("table.GeneralGrid tr, table[id*='dgExisting'] tr, table[id*='Grid'] tr").each((_i, row) => {
      const $row = $(row);
      if ($row.find("th").length > 0) return;
      const cells: string[] = [];
      $row.find("td").each((_j, cell) => {
        const linkText = $(cell).find("a").first().text().trim();
        cells.push(linkText || $(cell).text().trim());
      });
      if (cells.length < 3) return;

      const permitNumber = cells.find(c => /^\d{4}-\d{3,}/.test(c)) || cells.find(c => /^[A-Z0-9]{2,}[-\s]?\d+/i.test(c)) || cells[0] || null;
      if (!permitNumber || permitNumber.length < 4) return;

      const dateCell = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c));
      const statusCell = cells.find(c => /issued|active|pending|approved|closed|expired|finaled|withdrawn|complete/i.test(c));
      let address: string | null = null;
      let permitType: string | null = null;
      let description: string | null = null;

      for (const c of cells) {
        if (c === permitNumber || c === dateCell || c === statusCell) continue;
        if (/\d+\s+[A-Z]/i.test(c) && c.length > 5 && c.length < 100) address = c;
        else if (/building|over the counter|construction|residential|commercial|electrical|plumbing|mechanical|roofing|window|door|solar|pool/i.test(c)) {
          if (!permitType) permitType = c;
          else if (!description) description = c;
        }
      }

      allResults.push(makeResult({
        permitNumber,
        permitType,
        status: statusCell || null,
        address,
        description,
        issuedDate: dateCell || null,
      }));
    });

    if (allResults.length === 0) {
      $("table tr").each((_i, row) => {
        const $row = $(row);
        if ($row.find("th").length > 0) return;
        const cells: string[] = [];
        $row.find("td").each((_j, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length < 2) return;
        const permitNumber = cells[0];
        if (!permitNumber || permitNumber.length < 4 || !/\d/.test(permitNumber)) return;
        
        allResults.push(makeResult({
          permitNumber,
          permitType: cells[1] || null,
          status: cells.find(c => /issued|active|pending|approved|closed|expired|finaled|withdrawn|complete/i.test(c)) || null,
          address: cells.find(c => /\d+\s+[A-Z]/i.test(c) && c.length > 5) || null,
          issuedDate: cells.find(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || null,
        }));
      });
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });
    log(`FTG Portal total results for "${searchTerm}" on ${databaseName}: ${allResults.length}`, "scraper");

    const newFromBatch = await saveResultsBatch(allResults, databaseId, queryId);
    totalNewResults += newFromBatch;
    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`FTG Portal scraper error on ${databaseName}: ${error.message}`, "scraper");
  }

  return allResults;
}

export interface PermitDetail {
  [key: string]: string | null;
}

export async function scrapeClick2GovDetail(
  searchUrl: string,
  permitNumber: string
): Promise<PermitDetail | null> {
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    ({ page, context } = await createIsolatedPage());
    log(`Click2Gov Detail: Navigating to ${searchUrl} for permit ${permitNumber}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    const searchMethodSelect = page.locator("#searchMethod");
    const hasMethodDropdown = await searchMethodSelect.isVisible().catch(() => false);
    log(`Click2Gov Detail: hasMethodDropdown=${hasMethodDropdown}`, "scraper");
    if (hasMethodDropdown) {
      await searchMethodSelect.selectOption("0");
      await page.waitForTimeout(1000);
    }

    let inputFilled = false;

    const appYearInput = page.locator("#permit\\.appYear, input[name='permit.appYear']").first();
    const appNumberInput = page.locator("#permit\\.appNumber, input[name='permit.appNumber']").first();
    const hasYearField = await appYearInput.isVisible().catch(() => false);
    const hasNumberField = await appNumberInput.isVisible().catch(() => false);

    if (hasYearField && hasNumberField) {
      const parts = permitNumber.split("-");
      if (parts.length >= 2) {
        const year = parts[0];
        const number = parts.slice(1).join("-");
        await appYearInput.fill(year);
        await appNumberInput.fill(number);
        inputFilled = true;
        log(`Click2Gov Detail: Filled split fields - year="${year}", number="${number}"`, "scraper");
      } else {
        await appYearInput.fill("");
        await appNumberInput.fill(permitNumber);
        inputFilled = true;
        log(`Click2Gov Detail: No dash in permit, filled number field only: ${permitNumber}`, "scraper");
      }
    }

    if (!inputFilled) {
      const is0Div = page.locator("#is0");
      const is0Visible = await is0Div.isVisible().catch(() => false);
      if (is0Visible) {
        const appInput = is0Div.locator("input[type='text']").first();
        if (await appInput.isVisible().catch(() => false)) {
          await appInput.fill(permitNumber);
          inputFilled = true;
          log(`Click2Gov Detail: Filled #is0 input with: ${permitNumber}`, "scraper");
        }
      }
    }

    if (!inputFilled) {
      const anyTextInput = page.locator("input[type='text']:visible").first();
      if (await anyTextInput.isVisible().catch(() => false)) {
        await anyTextInput.fill(permitNumber);
        inputFilled = true;
        log(`Click2Gov Detail: Filled first visible input with: ${permitNumber}`, "scraper");
      }
    }

    if (!inputFilled) {
      log(`Click2Gov Detail: Could not find any input field to fill`, "scraper");
      await closeIsolatedPage(page, context);
      return null;
    }

    const continueBtnSelectors = [
      "#is0 #continue",
      "#is0 input[value*='Continue']",
      "#continue",
      "input[value*='Continue']",
      "input[type='submit']",
      "button[type='submit']",
    ];
    let submitted = false;
    for (const sel of continueBtnSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        submitted = true;
        log(`Click2Gov Detail: Clicked button via selector: ${sel}`, "scraper");
        break;
      }
    }
    if (!submitted) {
      await page.keyboard.press("Enter");
      log(`Click2Gov Detail: Pressed Enter to submit`, "scraper");
    }

    for (let wait = 0; wait < 6; wait++) {
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      const bodySnippet = await page.evaluate(() => document.body?.textContent?.substring(0, 500) || "").catch(() => "");
      const hasDetail = bodySnippet.includes("Status Detail") || bodySnippet.includes("Parcel ID");
      const hasResults = bodySnippet.includes("Permit Search Results") || bodySnippet.includes("entries");
      if (hasDetail || hasResults) {
        log(`Click2Gov Detail: Page loaded (hasDetail=${hasDetail}, hasResults=${hasResults}, url=${currentUrl})`, "scraper");
        break;
      }
      if (wait === 5) {
        log(`Click2Gov Detail: Timed out waiting for page load. URL=${currentUrl}`, "scraper");
      }
    }

    const pageTitle = await page.title().catch(() => "");
    const currentUrl = page.url();
    const bodyText = await page.locator("body").textContent().catch(() => "");
    const hasStatusDetail = bodyText?.includes("Status Detail") || bodyText?.includes("Parcel ID") || false;
    const hasSearchResults = bodyText?.includes("Permit Search Results") || bodyText?.includes("entries") || false;
    log(`Click2Gov Detail: After submit - title="${pageTitle}", url="${currentUrl}", hasStatusDetail=${hasStatusDetail}, hasSearchResults=${hasSearchResults}`, "scraper");

    let onDetailPage = hasStatusDetail;

    if (!onDetailPage && hasSearchResults) {
      await page.waitForTimeout(3000);
      const permitLink = page.locator(`table a`).filter({ hasText: permitNumber }).first();
      const linkVisible = await permitLink.isVisible().catch(() => false);
      log(`Click2Gov Detail: Looking for link with text "${permitNumber}" - found=${linkVisible}`, "scraper");
      if (linkVisible) {
        await permitLink.click();
        await page.waitForTimeout(4000);
        onDetailPage = await page.locator("text=/Status Detail/i").first().isVisible().catch(() => false);
        log(`Click2Gov Detail: After clicking link - onDetailPage=${onDetailPage}`, "scraper");
      }
    }

    if (!onDetailPage) {
      const firstLink = page.locator("table tbody tr td:first-child a").first();
      const firstVisible = await firstLink.isVisible().catch(() => false);
      log(`Click2Gov Detail: Trying first table link - found=${firstVisible}`, "scraper");
      if (firstVisible) {
        await firstLink.click();
        await page.waitForTimeout(4000);
        onDetailPage = await page.locator("text=/Status Detail/i").first().isVisible().catch(() => false);
      }
    }

    if (!onDetailPage) {
      const debugHtml = await page.evaluate(() => {
        const body = document.body;
        const forms = body?.querySelectorAll("form");
        const inputs = body?.querySelectorAll("input");
        const selects = body?.querySelectorAll("select");
        const links = body?.querySelectorAll("a");
        const tables = body?.querySelectorAll("table");
        return {
          url: window.location.href,
          title: document.title,
          formCount: forms?.length || 0,
          inputCount: inputs?.length || 0,
          selectCount: selects?.length || 0,
          linkCount: links?.length || 0,
          tableCount: tables?.length || 0,
          bodyText: body?.textContent?.substring(0, 800)?.replace(/\s+/g, " ") || "",
          inputDetails: Array.from(inputs || []).map(i => ({
            id: i.id, name: i.name, type: i.type, value: i.value?.substring(0, 50)
          })).slice(0, 10)
        };
      }).catch(() => null);
      log(`Click2Gov Detail: Page debug: ${JSON.stringify(debugHtml)}`, "scraper");
      log(`Click2Gov Detail: Could not reach detail page for ${permitNumber}`, "scraper");
      await closeIsolatedPage(page, context);
      return null;
    }

    log(`Click2Gov Detail: On Status Detail page for ${permitNumber}`, "scraper");

    const details: PermitDetail = {};

    for (let waitLoop = 0; waitLoop < 8; waitLoop++) {
      const contentLoaded = await page.evaluate(() => {
        const spans = document.querySelectorAll("span");
        const labelSpans = ["Parcel ID:", "Address:", "Owner:", "Application #:", "Application Type:", "Valuation:"];
        for (const span of spans) {
          const text = span.textContent?.trim() || "";
          if (labelSpans.includes(text)) {
            const next = span.nextElementSibling || span.parentElement?.nextElementSibling;
            if (next) {
              const val = next.textContent?.trim() || "";
              if (val && val !== "*" && !val.endsWith(":") && val.length > 1) {
                return { loaded: true, sample: `${text} ${val}` };
              }
            }
          }
        }
        const bodyText = document.body?.textContent || "";
        const hasValues = /\d{2}\/\d{2}\/\d{4}/.test(bodyText) || /\$[\d,]+/.test(bodyText);
        return { loaded: hasValues, sample: bodyText.substring(0, 200) };
      }).catch(() => ({ loaded: false, sample: "" }));
      log(`Click2Gov Detail: Content check ${waitLoop}: loaded=${contentLoaded.loaded}, sample=${contentLoaded.sample?.substring(0, 100)}`, "scraper");
      if (contentLoaded.loaded) break;
      await page.waitForTimeout(2000);
    }

    const detailPairs = await page.evaluate(() => {
      const pairs: Array<{label: string, value: string}> = [];

      const knownLabels = [
        "Parcel ID", "Address", "Application Date", "Owner",
        "Application #", "Application Type", "Valuation",
        "Issue Date", "Expiration Date", "Finaled Date",
        "Status", "Description", "Sq Footage", "Square Footage",
        "Contractor", "General Contractor", "Work Description",
        "Permit Type", "Permit #", "Job Value", "Total Fees",
        "District", "Zoning", "Subdivision", "Lot", "Block",
        "Legal Description", "Inspector", "CO Date", "CO Number"
      ];

      const bodyText = document.body?.innerText || "";

      for (const label of knownLabels) {
        const regex = new RegExp(label + "\\s*:\\s*(.+?)(?=\\n|$)", "i");
        const match = bodyText.match(regex);
        if (match) {
          let value = match[1].trim();
          for (const otherLabel of knownLabels) {
            const idx = value.indexOf(otherLabel + ":");
            if (idx > 0) {
              value = value.substring(0, idx).trim();
            }
          }
          value = value.replace(/^\*\s*/, "").replace(/\s*\*$/, "").trim();
          if (value && value.length > 0 && value.length < 300 && value !== "*") {
            pairs.push({ label, value });
          }
        }
      }

      if (pairs.length === 0) {
        const allSpans = document.querySelectorAll("span");
        const spanTexts: string[] = [];
        for (const span of allSpans) {
          const text = span.textContent?.trim() || "";
          if (text && text.length > 1) spanTexts.push(text);
        }

        for (let i = 0; i < spanTexts.length; i++) {
          const text = spanTexts[i];
          if (!text.endsWith(":")) continue;
          const label = text.replace(/:$/, "").trim();
          if (label.length < 2 || label.length > 50) continue;
          const skipSet = new Set(["toggle application navigation", "building permits", "home", "accessibility", "contact us", "new user", "login", "select permit", "status detail"]);
          if (skipSet.has(label.toLowerCase())) continue;
          for (let j = i + 1; j < Math.min(i + 5, spanTexts.length); j++) {
            const val = spanTexts[j];
            if (val === "*") continue;
            if (val.endsWith(":")) break;
            if (val.length > 0 && val.length < 300) {
              pairs.push({ label, value: val });
              break;
            }
          }
        }
      }

      return pairs;
    });

    const skipValues = new Set(["structure detail", "status detail", "select permit"]);
    for (const { label, value } of detailPairs) {
      if (!details[label]) {
        if (skipValues.has(value.toLowerCase())) continue;
        let cleanValue = value;
        if (/^0+$/.test(cleanValue)) cleanValue = "0";
        details[label] = cleanValue;
      }
    }

    log(`Click2Gov Detail: Scraped ${Object.keys(details).length} fields: ${Object.keys(details).join(", ")}`, "scraper");
    await closeIsolatedPage(page, context);
    return Object.keys(details).length > 0 ? details : null;
  } catch (error: any) {
    log(`Click2Gov Detail error for ${permitNumber}: ${error.message}`, "scraper");
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    return null;
  }
}

// Detail adapters use fresh anonymous sessions. Never trust cached contact data or
// record URLs from rawData: the portal must confirm both jurisdiction and number.
export function assertAccelaAgency(searchUrl: string, recordUrl: string): void {
  const source = new URL(searchUrl);
  const target = new URL(recordUrl);
  const agency = source.pathname.split('/')[1]?.toLowerCase();
  if (!agency || target.origin !== source.origin || target.pathname.split('/')[1]?.toLowerCase() !== agency ||
      [...target.searchParams].some(([key, value]) => /^(agencyCode|agency)$/i.test(key) && value.toLowerCase() !== agency)) {
    throw new Error(`Accela redirected outside the configured agency: ${target.origin}${target.pathname}`);
  }
}

export function assertEnerGovApplication(searchUrl: string, targetUrl: string): void {
  const app = new URL(enerGovApplicationUrl(searchUrl));
  const target = new URL(targetUrl);
  if (target.origin !== app.origin || !target.pathname.toLowerCase().startsWith(app.pathname.toLowerCase() + '/api/')) {
    throw new Error('EnerGov detail redirected outside the configured application');
  }
}

function detailText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

function addDetail(details: PermitDetail, key: string, value: unknown) {
  const text = detailText(value);
  if (text) details[key] = [...new Set([...(details[key]?.split('; ') || []), text])].join('; ');
}

export function parseAccelaDetail(html: string, permitNumber: string, searchUrl: string, recordUrl: string): PermitDetail | null {
  assertAccelaAgency(searchUrl, recordUrl);
  if (!/\/Cap\/CapDetail\.aspx$/i.test(new URL(recordUrl).pathname)) return null;
  const $ = cheerio.load(html);
  const number = $('#ctl00_PlaceHolderMain_lblPermitNumber').text().trim();
  if (!permitNumber.trim() || number !== permitNumber.trim()) return null;
  const details: PermitDetail = { Permit: number };
  addDetail(details, 'Type', $('#ctl00_PlaceHolderMain_lblPermitType').text());
  addDetail(details, 'Status', $('#ctl00_PlaceHolderMain_lblRecordStatus').text());
  const location = $("[id$='_workLocation_updatePanel']").clone();
  location.find('script, style').remove();
  addDetail(details, 'Address', location.text().replace(/\s*\*\s*$/, ''));
  // Role sections are siblings of their headings; do not scrape unrelated
  // condition notices, login forms, or other records' names from the page.
  $("[id$='_TBPermitDetailTest'] h1").each((_i, heading) => {
    const label = $(heading).text().trim().replace(/:$/, '');
    const section = $(heading).next('span');
    if (/^Project Description$/i.test(label)) {
      addDetail(details, 'Description', section.text());
    } else if (/^Applicant$/i.test(label)) {
      section.find('.contactinfo_firstname').each((_j, first) => {
        const parent = $(first).parent();
        addDetail(details, 'Applicant', parent.find('.contactinfo_firstname, .contactinfo_middlename, .contactinfo_lastname').map((_k, el) => $(el).text().trim()).get().join(' '));
      });
      section.find('.contactinfo_businessname, .contactinfo_organizationname').each((_j, el) => addDetail(details, 'Applicant', $(el).text()));
    } else if (/^Owner$/i.test(label)) {
      // The owner template puts the name in the first row, followed by address
      // rows. A bare asterisk is a redacted name, not a contact.
      section.find('table').filter((_j, el) => $(el).find('table').length === 0).each((_j, table) => {
        addDetail(details, 'Owner', $(table).find('tr').first().text().replace(/\s*\*\s*$/, ''));
      });
    } else if (/^Licensed Professional(s)?$/i.test(label)) {
      section.find("table[id='tbl_licensedps'] > tbody > tr > td:last-child").each((_j, cell) => {
        const body = $(cell).clone();
        body.find('table').remove();
        body.find('br').replaceWith('\n');
        const lines = body.text().split('\n').map(detailText).filter(Boolean);
        // Name and optional company precede the mailing address. Licenses
        // follow the phone table in Accela's public licensed-professional template.
        const names: string[] = [];
        for (const line of lines.slice(0, 2)) {
          if (/^\d+\s|,.*\d|^P\.?\s*O\.?\s*Box\b|^ZBL#|\b(?:contractor|electrician)\s+\d/i.test(line)) break;
          names.push(line);
        }
        addDetail(details, 'Contractor', names.join(' / '));
        const license = lines.find(line => /^(?:contractor|electrician|electrical|plumber|plumbing|mechanical|general building|general engineering|building contractor)\b.*\s[\w-]*\d[\w-]*$/i.test(line));
        addDetail(details, 'Contractor license', license);
        $(cell).find('.ACA_PhoneNumberLTR').each((_k, el) => addDetail(details, 'Contractor phone', $(el).text()));
        const email = $(cell).text().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
        email?.forEach(value => addDetail(details, 'Contractor email', value));
      });
    }
  });
  const labels: Record<string, string> = {
    'application date': 'Applied', 'applied date': 'Applied', 'issue date': 'Issued', 'issued date': 'Issued',
    'expiration date': 'Expires', 'finaled date': 'Finaled', 'finalized date': 'Finaled',
    'job value': 'Job value', 'job valuation': 'Job value', 'valuation': 'Job value', 'parcel number': 'Parcel',
  };
  $('.MoreDetail_ItemCol1').each((_i, el) => {
    const key = labels[$(el).text().trim().replace(/:$/, '').toLowerCase()];
    if (key) addDetail(details, key, $(el).next('.MoreDetail_ItemCol2').text());
  });
  return details;
}

export function parseEnerGovDetail(data: any, contacts: any, permitNumber: string, caseId: string): PermitDetail | null {
  const record = data?.Result;
  if (data?.Success !== true || !permitNumber.trim() || record?.PermitNumber !== permitNumber.trim() ||
      typeof record?.PermitId !== 'string' || record.PermitId.toLowerCase() !== caseId.toLowerCase()) return null;
  const details: PermitDetail = {};
  const fields: Record<string, string> = {
    PermitNumber: 'Permit', PermitType: 'Type', PermitStatus: 'Status', Description: 'Description',
    ApplyDate: 'Applied', IssueDate: 'Issued', ExpireDate: 'Expires', FinalizeDate: 'Finaled',
    MainAddress: 'Address', MainParcelNumber: 'Parcel',
  };
  // EnerGov sends UTC instants: a date is the jurisdiction's local midnight ("2003-03-24T06:00:00Z"), a finalize is
  // a real time. Shown as the calendar date the way Accela and Click2Gov print it. Every US zone is 4-10 h behind
  // UTC, so shifting by 4 h keeps local midnights (04-10Z) on their day and moves 00-04Z back to the local evening.
  const usDate = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return v;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return v;
    const [y, m, d] = new Date(t - 4 * 3_600_000).toISOString().slice(0, 10).split('-');
    return `${m}/${d}/${y}`;
  };
  for (const [field, label] of Object.entries(fields)) addDetail(details, label, /Date$/.test(field) ? usDate(record[field]) : record[field]);
  if (record.ShowValue === true) addDetail(details, 'Job value', record.Value);
  if (contacts?.Success === true && Array.isArray(contacts.Result)) {
    for (const contact of contacts.Result) {
      // Reject mixed-case or cross-record responses rather than merging names.
      if (contact.ModuleId !== 1 || typeof contact.EntityId !== 'string' || contact.EntityId.toLowerCase() !== caseId.toLowerCase()) return null;
      const type = detailText(contact.ContactTypeName);
      const role = /contractor|licensed professional/i.test(type) ? 'Contractor' : /applicant/i.test(type) ? 'Applicant' : /owner/i.test(type) ? 'Owner' : ({ agent: 'Agent', architect: 'Architect', engineer: 'Engineer' } as Record<string, string>)[type.toLowerCase()];
      if (!role) continue;
      const person = [detailText(contact.FirstName), detailText(contact.LastName)].filter(Boolean).join(' ');
      const company = detailText(contact.GlobalEntityName);
      addDetail(details, role, [...new Set([person, company].filter(Boolean))].join(' / '));
      // Title is a free-text job title, even where a portal stores a license in
      // it; do not relabel it as a verified contractor license.
    }
  }
  return details;
}

async function boundedPermitDetail(work: (page: Page, context: BrowserContext) => Promise<PermitDetail | null>): Promise<PermitDetail | null> {
  let context: BrowserContext | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => { expired = true; void context?.close().catch(() => {}); resolve(null); }, 60_000);
    });
    const run = (async () => {
      const browser = await getBrowser();
      if (expired) return null;
      context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      if (expired) { await context.close(); return null; }
      context.setDefaultTimeout(15_000);
      context.setDefaultNavigationTimeout(25_000);
      const page = await context.newPage();
      return work(page, context);
    })();
    return await Promise.race([run, timeout]);
  } catch (error: any) {
    log(`Permit detail unavailable: ${error.message}`, 'scraper');
    return null;
  } finally {
    clearTimeout(timer);
    await context?.close().catch(() => {});
  }
}

export async function scrapeAccelaDetail(searchUrl: string, permitNumber: string): Promise<PermitDetail | null> {
  if (!permitNumber.trim()) return null;
  return boundedPermitDetail(async page => {
    const landing = await gotoRetryingGatewayErrors(page, searchUrl);
    if (landing && !landing.ok()) return null;
    assertAccelaAgency(searchUrl, page.url());
    const target = accelaSearchUrl(searchUrl, await page.content());
    if (page.url() !== target) await page.goto(target, { waitUntil: 'domcontentloaded' });
    assertAccelaAgency(searchUrl, page.url());
    await page.locator("input[id*='txtGSPermitNumber'], input[id*='txtPermitNumber']").first().fill(permitNumber.trim());
    const response = page.waitForResponse(r => r.request().method() === 'POST' && /\/Cap\/CapHome\.aspx$/i.test(new URL(r.url()).pathname));
    const [submitted] = await Promise.all([response, page.locator("a[id*='btnNewSearch']").first().click()]);
    if (!submitted.ok()) return null;
    assertAccelaAgency(searchUrl, submitted.url());
    await submitted.finished();
    await page.waitForFunction(() => !!document.querySelector("#ctl00_PlaceHolderMain_lblPermitNumber, table[id*='gdvPermitList'] [id*='lblPermitNumber']"));
    if (!/CapDetail\.aspx/i.test(page.url())) {
      // Use the exact matching record link, never the first approximate hit.
      const link = page.locator("table[id*='gdvPermitList'] a").filter({ hasText: new RegExp(`^\\s*${permitNumber.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
      if (await link.count() !== 1) return null;
      await link.click();
      await page.waitForURL(/\/Cap\/CapDetail\.aspx/i);
    }
    await page.locator('#ctl00_PlaceHolderMain_lblPermitNumber').waitFor();
    return parseAccelaDetail(await page.content(), permitNumber, searchUrl, page.url());
  });
}

export async function scrapeEnerGovDetail(searchUrl: string, permitNumber: string, rawData: Record<string, any> | null): Promise<PermitDetail | null> {
  if (!permitNumber.trim()) return null;
  return boundedPermitDetail(async (page, context) => {
    const app = enerGovApplicationUrl(searchUrl);
    const tenants: Promise<any[]>[] = [];
    page.on('response', response => {
      if (/\/api\/Home\/GetTenants(?:\?|$)/i.test(response.url()) && response.ok()) {
        tenants.push((async () => {
          assertEnerGovApplication(searchUrl, response.url());
          const data = await response.json();
          if (data.Success !== true || !Array.isArray(data.Result)) throw new Error('Invalid tenant list');
          return data.Result;
        })().catch(() => [{ TenantID: 'unverified', TenantName: 'unverified' }]));
      }
    });
    let caseId = typeof rawData?.caseId === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(rawData.caseId) ? rawData.caseId : '';
    const url = new URL(searchUrl);
    if (!caseId) {
      url.hash = '/search';
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.locator('#SearchModule option').filter({ hasText: /^Permit$/ }).waitFor({ state: 'attached' });
      await page.waitForTimeout(1000);
      await page.locator('#SearchModule').selectOption({ label: 'Permit' });
      await page.locator('#SearchKeyword').fill(permitNumber.trim());
      await page.locator('#button-Search').focus();
      await page.waitForTimeout(750);
      const pending = page.waitForResponse(r => /\/api\/energov\/search\/search(?:\?|$)/i.test(r.url()) && r.request().method() === 'POST' && r.request().postDataJSON()?.Keyword === permitNumber.trim());
      const [response] = await Promise.all([pending, page.locator('#button-Search').click()]);
      assertEnerGovApplication(searchUrl, response.url());
      const headers = enerGovReplayHeaders(await response.request().allHeaders());
      assertEnerGovTenant(searchUrl, (await Promise.all(tenants)).find(list => list.length) || [], headers);
      const search = await context.request.post(response.url(), { headers, data: enerGovSearchRequest(response.request().postDataJSON(), permitNumber.trim(), 'permit'), maxRedirects: 0 });
      if (!search.ok()) return null;
      const matches = parseEnerGovResponse(await search.json()).results.filter(r => r.permitNumber === permitNumber.trim());
      if (matches.length !== 1 || !matches[0].caseId) return null;
      caseId = matches[0].caseId;
    }
    url.hash = `/permit/${encodeURIComponent(caseId)}`;
    const pending = page.waitForResponse(r => /\/api\/energov\/permits\/permitdetail(?:\?|$)/i.test(r.url()) && r.request().method() === 'POST' && r.request().postDataJSON()?.EntityId?.toLowerCase() === caseId.toLowerCase());
    const [response] = await Promise.all([pending, page.goto(url.href, { waitUntil: 'domcontentloaded' })]);
    assertEnerGovApplication(searchUrl, response.url());
    const headers = enerGovReplayHeaders(await response.request().allHeaders());
    assertEnerGovTenant(searchUrl, (await Promise.all(tenants)).find(list => list.length) || [], headers);
    if (!response.ok()) return null;
    const data = await response.json();
    if (!parseEnerGovDetail(data, null, permitNumber, caseId)) return null;
    const contacts: any = { Success: true, Result: [] };
    for (let pg = 1; pg <= 100; pg++) {
      const result = await context.request.post(`${app}/api/energov/entity/contacts/search/search`, {
        headers, data: { PageNumber: pg, PageSize: 100, SortField: '', IsSortedInAscendingOrder: true, ModuleId: 1, EntityId: caseId },
        timeout: 15_000, maxRedirects: 0,
      });
      // Restricted contacts are deliberately omitted; never attempt login.
      if ([401, 403, 412].includes(result.status())) break;
      if (!result.ok()) throw new Error(`EnerGov contacts HTTP ${result.status()}`);
      const batch = await result.json();
      if (batch.Success === false && (batch.StatusCode === 412 || /must be a contact|log.?in|not authorized|permission/i.test(batch.ErrorMessage || ''))) break;
      if (batch.Success !== true || !Array.isArray(batch.Result)) throw new Error('Invalid EnerGov contacts');
      contacts.Result.push(...batch.Result);
      if (pg >= Number(batch.PageCount || 1)) break;
      if (!batch.Result.length || pg === 100) throw new Error('Incomplete EnerGov contacts');
    }
    return parseEnerGovDetail(data, contacts, permitNumber, caseId);
  });
}

export async function scrapePermitDetail(
  platform: string,
  searchUrl: string,
  permitNumber: string,
  rawData: Record<string, any> | null
): Promise<PermitDetail | null> {
  switch (platform) {
    case "Accela":
      return scrapeAccelaDetail(searchUrl, permitNumber);
    case "Tyler EnerGov":
      return scrapeEnerGovDetail(searchUrl, permitNumber, rawData);
    case "Click2Gov":
      return scrapeClick2GovDetail(searchUrl, permitNumber);
    default:
      log(`No detail scraper available for platform: ${platform}`, "scraper");
      return null;
  }
}

export type ScraperPlatform = "SmartGov" | "Skagit County" | "Tyler EnerGov" | "eTRAKiT" | "Accela" | "Click2Gov" | "FTG Portal" | string;

export async function scrapeByPlatform(
  platform: ScraperPlatform,
  searchUrl: string,
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string
): Promise<ScrapeResult[]> {
  if (!canScrapeGovernmentPortal({ platform, searchUrl, portalUrl: null })) {
    throw new Error("No verified adapter for this portal jurisdiction");
  }
  switch (platform) {
    case "SmartGov":
      return scrapeSmartGov(searchUrl, searchTerm, databaseId, databaseName, queryId, jobId);
    case "Skagit County":
    case "Custom / GovPlatform":
      return scrapeSkagitCounty(searchTerm, searchType, databaseId, databaseName, queryId, jobId);
    case "Tyler EnerGov":
    case "Tyler Technologies":
      return scrapeEnerGov(searchTerm, searchType, databaseId, databaseName, queryId, jobId, searchUrl);
    case "eTRAKiT":
      return scrapeETRAKiT(searchTerm, searchType, databaseId, databaseName, queryId, jobId);
    case "Accela":
      return scrapeAccela(searchUrl, searchTerm, searchType, databaseId, databaseName, queryId, jobId);
    case "Click2Gov":
      return scrapeClick2Gov(searchUrl, searchTerm, searchType, databaseId, databaseName, queryId, jobId);
    case "FTG Portal":
      return scrapeFTGPortal(searchUrl, searchTerm, searchType, databaseId, databaseName, queryId, jobId);
    default:
      log(`No scraper available for platform: ${platform} on ${databaseName}`, "scraper");
      return [];
  }
}
