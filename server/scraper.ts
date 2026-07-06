import { chromium, type Browser, type Page, type BrowserContext } from "playwright-core";
import * as cheerio from "cheerio";
import { storage } from "./storage";
import { log } from "./index";

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

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
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
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
  const activeDbs = databases.filter(db => db.isActive && (db.searchUrl || db.portalUrl) && db.platform && db.platform !== "Contact Required" && db.platform !== "LAMA");

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

      dbEntry.status = "completed";
      dbEntry.resultsFound = scrapeResults.length;
      dbEntry.message = `Found ${scrapeResults.length} results`;
      job.totalResultsFound = job.databases.reduce((sum, d) => sum + d.resultsFound, 0);
    } catch (err: any) {
      dbEntry.status = "error";
      dbEntry.message = err.message?.substring(0, 100) || "Scrape failed";
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

function deriveEnerGovBaseUrl(searchUrl: string): string {
  try {
    const u = new URL(searchUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://whatcomcountywa-energovweb.tylerhost.net";
  }
}

async function scrapeEnerGovViaAPI(
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string,
  progress: ScrapeProgress,
  portalSearchUrl?: string
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  const baseUrl = portalSearchUrl ? deriveEnerGovBaseUrl(portalSearchUrl) : "https://whatcomcountywa-energovweb.tylerhost.net";

  try {
    const searchPayloads: any[] = [];

    if (searchType === "company_name" || searchType === "name") {
      searchPayloads.push({
        Rone: JSON.stringify({
          SearchModule: 2,
          SearchMainType: 0,
          PlanningSearchType: 0,
          SearchText: searchTerm,
          StatusCode: "",
          ApplyDateFrom: "",
          ApplyDateTo: "",
          PermitSearchType: 0,
          Page: 1,
          PageSize: 50,
          SortBy: "relevance",
          SortOrder: "desc"
        })
      });
      searchPayloads.push({
        Rone: JSON.stringify({
          Tefft: searchTerm,
          SearchModule: 2,
          SearchText: searchTerm,
          Page: 1,
          PageSize: 50
        })
      });
    } else {
      searchPayloads.push({
        Rone: JSON.stringify({
          SearchModule: 2,
          SearchMainType: 0,
          SearchText: searchTerm,
          Page: 1,
          PageSize: 50,
          SortBy: "relevance",
          SortOrder: "desc"
        })
      });
    }

    const apiUrl = `${baseUrl}/apps/selfservice/api/energov/search/search`;
    const searchCriteria = {
      Keyword: searchTerm,
      ExactMatch: false,
      SearchModule: 2,
      FilterModule: 0,
      SearchMainAddress: false,
      PermitCriteria: {
        PermitNumber: null,
        PermitTypeId: null,
        PermitWorkclassId: null,
        PermitStatusId: null,
        ProjectName: null,
        ApplyDateFrom: null,
        ApplyDateTo: null,
        ExpireDateFrom: null,
        ExpireDateTo: null,
        FinalDateFrom: null,
        FinalDateTo: null,
        IssueDateFrom: null,
        IssueDateTo: null,
        Address: null,
        Description: searchTerm,
        SearchMainAddress: false,
        ContactId: null,
        ParcelNumber: null,
        TypeId: null,
        WorkClassIds: null,
        ExcludeCases: null,
        PageNumber: 0,
        PageSize: 50,
        SortBy: "relevance",
        SortOrder: "desc",
      },
    };

    progress.message = `Trying API search for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": baseUrl,
          "Referer": `${baseUrl}/apps/selfservice`,
        },
        body: JSON.stringify(searchCriteria),
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const data = await response.json();
        const items = data?.Result?.EntityResults;
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            const pNum = item.CaseNumber || item.PermitNumber || null;
            if (!pNum) continue;
            results.push(makeResult({
              permitNumber: String(pNum),
              permitType: item.CaseType || item.PermitType || item.CaseWorkclass || null,
              status: item.CaseStatus || item.Status || null,
              address: extractEnerGovAddress(item),
              applicantName: item.ApplicantName || item.ContactName || item.ProjectName || null,
              contractorName: item.ContractorName || item.Contractor || item.CompanyName || null,
              description: item.Description || item.WorkDescription || item.ProjectName || null,
              issuedDate: item.ApplyDate || item.IssuedDate || item.IssueDate || null,
              expirationDate: item.ExpireDate || item.ExpirationDate || null,
              finalizedDate: item.FinalDate || item.FinalizedDate || null,
              district: item.District || null,
              parcelNumber: item.MainParcel || item.ParcelNumber || (item.Parcels?.[0]?.ParcelNumber) || null,
              caseId: item.CaseId || item.GlobalEntityID || item.EntityId || null,
            }));
          }
          log(`EnerGov API found ${results.length} results via direct API call`, "scraper");

          await fetchEnerGovContacts(results, baseUrl, progress, jobId);
          return results;
        }
      }
    } catch (apiErr: any) {
      log(`EnerGov direct API attempt failed: ${apiErr.message}`, "scraper");
    }
  } catch (err: any) {
    log(`EnerGov API search failed: ${err.message}`, "scraper");
  }

  return results;
}

export async function scrapeEnerGov(
  searchTerm: string,
  searchType: string,
  databaseId: number,
  databaseName: string,
  queryId: number,
  jobId: string,
  portalSearchUrl?: string
): Promise<ScrapeResult[]> {
  const progress = initProgress(databaseId, databaseName, searchTerm, jobId);
  const allResults: ScrapeResult[] = [];
  let totalNewResults = 0;
  const baseUrl = portalSearchUrl ? deriveEnerGovBaseUrl(portalSearchUrl) : "https://whatcomcountywa-energovweb.tylerhost.net";
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    if (searchType === "company_name" || searchType === "name" || searchType === "keyword") {
      progress.message = `Trying API search for "${searchTerm}"...`;
      scrapeJobs.set(jobId, { ...progress });
      const apiResults = await scrapeEnerGovViaAPI(searchTerm, searchType, databaseId, databaseName, queryId, jobId, progress, portalSearchUrl);
      if (apiResults.length > 0) {
        allResults.push(...apiResults);
        progress.resultsFound = allResults.length;
        progress.message = `Found ${allResults.length} results via API`;
        scrapeJobs.set(jobId, { ...progress });
        const newFromBatch = await saveResultsBatch(apiResults, databaseId, queryId);
        totalNewResults += newFromBatch;
        await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
        return allResults;
      }
      log(`EnerGov API returned no results for "${searchTerm}", falling back to browser scrape`, "scraper");
    }

    ({ page, context } = await createIsolatedPage());

    const capturedResponses: any[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/") && (url.includes("search") || url.includes("Search") || url.includes("permit") || url.includes("Permit") || url.includes("case") || url.includes("Case"))) {
        try {
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("json")) {
            const json = await response.json().catch(() => null);
            if (json) {
              capturedResponses.push({ url, data: json });
              log(`EnerGov captured API response from ${url}: ${JSON.stringify(json).substring(0, 500)}`, "scraper");
            }
          }
        } catch {}
      }
    });

    let searchUrl: string;
    if (searchType === "keyword") {
      searchUrl = `${baseUrl}/apps/selfservice#/search?m=1&fm=1&ps=50&pn=1&em=true&st=${encodeURIComponent(searchTerm)}`;
    } else if (portalSearchUrl) {
      searchUrl = portalSearchUrl;
    } else {
      searchUrl = `${baseUrl}/apps/selfservice#/search`;
    }
    log(`Scraper: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);

    if (searchType !== "keyword") {
      const searchInput = page.locator("input[type='search'], input[placeholder*='Search'], input[placeholder*='search'], input.form-control, input[ng-model*='search'], input[aria-label*='Search']").first();
      await searchInput.waitFor({ state: "visible", timeout: 20000 });
      await searchInput.fill(searchTerm);
    }

    progress.message = `Searching for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    if (searchType !== "keyword") {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);

      const searchButton = page.locator("button:has-text('Search'), button:has-text('SEARCH'), a:has-text('Search')").first();
      const btnVisible = await searchButton.isVisible().catch(() => false);
      if (btnVisible) {
        await searchButton.click();
      }
    }

    await page.waitForTimeout(10000);

    const searchResponses = capturedResponses.filter(r =>
      r.url.includes("/search/search") || r.url.includes("/Search/Search")
    );

    for (const resp of searchResponses) {
      const data = resp.data;
      const entityResults = data?.Result?.EntityResults;
      if (!Array.isArray(entityResults) || entityResults.length === 0) continue;

      for (const item of entityResults) {
        const pNum = item.CaseNumber || item.PermitNumber || item.Number || null;
        if (!pNum) continue;
        allResults.push(makeResult({
          permitNumber: String(pNum),
          permitType: item.CaseType || item.PermitType || item.CaseWorkclass || null,
          status: item.CaseStatus || item.Status || null,
          address: extractEnerGovAddress(item),
          applicantName: item.ApplicantName || item.Applicant || item.ContactName || item.ProjectName || null,
          contractorName: item.ContractorName || item.Contractor || item.CompanyName || null,
          description: item.Description || item.WorkDescription || item.CaseDescription || item.ProjectName || null,
          issuedDate: item.ApplyDate || item.IssuedDate || item.IssueDate || null,
          expirationDate: item.ExpireDate || item.ExpirationDate || null,
          finalizedDate: item.FinalDate || item.FinalizedDate || null,
          district: item.District || null,
          parcelNumber: item.MainParcel || item.ParcelNumber || (item.Parcels?.[0]?.ParcelNumber) || null,
          caseId: item.CaseId || item.GlobalEntityID || item.EntityId || null,
        }));
      }
      if (allResults.length > 0) {
        log(`EnerGov API intercept parsed ${allResults.length} results from ${resp.url}`, "scraper");
      }
    }

    if (allResults.length === 0) {
      log(`EnerGov API intercept found 0 results, trying HTML parse...`, "scraper");
      const html = await page.content();
      const htmlResults = parseEnerGovResults(html);
      allResults.push(...htmlResults);
    }

    if (allResults.length === 0) {
      log(`EnerGov: trying visible text extraction for "${searchTerm}"...`, "scraper");
      const visibleResults = await page.evaluate(() => {
        const results: any[] = [];
        const rows = document.querySelectorAll("tr, [class*='result'], [class*='row'], md-list-item, .case-item");
        rows.forEach(row => {
          const text = row.textContent?.trim() || "";
          if (text.length < 10) return;
          const permitMatch = text.match(/([A-Z]{2,}\d*[-\s]\d{2,}[-\s]?\d*)/);
          if (permitMatch) {
            const links = row.querySelectorAll("a");
            const linkTexts: string[] = [];
            links.forEach(l => linkTexts.push(l.textContent?.trim() || ""));
            results.push({
              text,
              permit: permitMatch[1],
              links: linkTexts,
            });
          }
        });
        return results;
      });

      for (const vr of visibleResults) {
        const addressMatch = vr.text.match(/\d+\s+[A-Z][A-Za-z\s]+(?:ST|AVE|RD|DR|LN|WAY|BLVD|CT|PL|CIR)\b/i);
        allResults.push(makeResult({
          permitNumber: vr.permit,
          address: addressMatch ? addressMatch[0] : null,
        }));
      }
    }

    if (allResults.length > 0) {
      await fetchEnerGovContacts(allResults, baseUrl, progress, jobId);
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });
    log(`EnerGov total results for "${searchTerm}": ${allResults.length} (captured ${capturedResponses.length} API responses)`, "scraper");

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

async function fetchEnerGovContacts(
  results: ScrapeResult[],
  baseUrl: string,
  progress: ScrapeProgress,
  jobId: string
): Promise<void> {
  const resultsWithCaseId = results.filter(r => r.caseId);
  if (resultsWithCaseId.length === 0) return;

  const limit = Math.min(resultsWithCaseId.length, 25);
  progress.message = `Fetching contact details for ${limit} permits...`;
  scrapeJobs.set(jobId, { ...progress });

  for (let i = 0; i < limit; i++) {
    const result = resultsWithCaseId[i];
    try {
      const detailUrl = `${baseUrl}/apps/selfservice/api/energov/permit/details/${result.caseId}`;
      const resp = await fetch(detailUrl, {
        headers: {
          "Accept": "application/json",
          "Origin": baseUrl,
          "Referer": `${baseUrl}/apps/selfservice`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) continue;
      const data = await resp.json();
      const permit = data?.Result || data?.result || data;

      if (permit.MainParcel && !result.parcelNumber) {
        result.parcelNumber = permit.MainParcel;
      }
      if (permit.ExpireDate && !result.expirationDate) {
        result.expirationDate = permit.ExpireDate;
      }
      if (permit.FinalDate && !result.finalizedDate) {
        result.finalizedDate = permit.FinalDate;
      }
      if (permit.District && !result.district) {
        result.district = permit.District;
      }
      if (permit.IssueDate && !result.issuedDate) {
        result.issuedDate = permit.IssueDate;
      }
      if (permit.Description && !result.description) {
        result.description = permit.Description;
      }

      const contacts: ScrapeContact[] = [];
      const contactList = permit.Contacts || permit.contacts || [];
      if (Array.isArray(contactList)) {
        for (const c of contactList) {
          contacts.push({
            type: c.ContactType || c.Type || c.RoleDescription || "Unknown",
            company: c.CompanyName || c.Company || c.OrganizationName || null,
            firstName: c.FirstName || c.firstName || null,
            lastName: c.LastName || c.lastName || null,
            title: c.Title || c.title || null,
            phone: c.Phone || c.PhoneNumber || c.phone || null,
            email: c.Email || c.EmailAddress || c.email || null,
          });
        }
      }

      if (contacts.length > 0) {
        result.contacts = contacts;
        const contractor = contacts.find(c =>
          c.type.toLowerCase().includes("contractor")
        );
        if (contractor) {
          const parts = [contractor.company, [contractor.firstName, contractor.lastName].filter(Boolean).join(" ")].filter(Boolean);
          result.contractorName = parts.join(" - ") || result.contractorName;
        }
        const owner = contacts.find(c =>
          c.type.toLowerCase().includes("owner") || c.type.toLowerCase().includes("applicant")
        );
        if (owner && !result.applicantName) {
          result.applicantName = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || null;
        }
      }

      log(`EnerGov detail fetched for ${result.permitNumber}: ${contacts.length} contacts`, "scraper");
    } catch (err: any) {
      log(`EnerGov detail fetch failed for ${result.permitNumber}: ${err.message}`, "scraper");
    }
  }
}

function parseEnerGovResults(html: string): ScrapeResult[] {
  const $ = cheerio.load(html);
  const results: ScrapeResult[] = [];

  $("table tbody tr, .search-result, .result-item, .case-row, div[class*='result']").each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text || text.length < 5) return;

    const cells = $el.find("td");
    if (cells.length >= 2) {
      const cellTexts: string[] = [];
      cells.each((_j, cell) => cellTexts.push($(cell).text().trim()));

      const permitNumber = cellTexts[0] || null;
      if (!permitNumber || permitNumber.toLowerCase().includes("no results")) return;

      results.push(makeResult({
        permitNumber,
        permitType: cellTexts.length > 1 ? cellTexts[1] : null,
        status: cellTexts.length > 2 ? cellTexts[2] : null,
        address: cellTexts.length > 3 ? cellTexts[3] : null,
        applicantName: cellTexts.length > 4 ? cellTexts[4] : null,
        description: cellTexts.length > 5 ? cellTexts[5] : null,
        issuedDate: cellTexts.length > 6 ? cellTexts[6] : null,
      }));
      return;
    }

    const links = $el.find("a");
    let permitNumber: string | null = null;
    links.each((_j, link) => {
      const linkText = $(link).text().trim();
      if (linkText && /^[A-Z]{2,}[-\s]?\d+/i.test(linkText)) {
        permitNumber = linkText;
      }
    });

    if (!permitNumber) {
      const match = text.match(/([A-Z]{2,}\d*[-\s]\d{2,}[-\s]?\d*)/);
      if (match) permitNumber = match[1];
    }

    if (permitNumber) {
      const addressMatch = text.match(/\d+\s+[A-Z][A-Za-z\s]+(?:ST|AVE|RD|DR|LN|WAY|BLVD|CT|PL|CIR)\b/i);
      const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

      results.push(makeResult({
        permitNumber,
        address: addressMatch ? addressMatch[0] : null,
        issuedDate: dateMatch ? dateMatch[1] : null,
      }));
    }
  });

  return results;
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

export async function scrapeAccela(
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

    log(`Accela: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    if (searchType === "address") {
      const parts = searchTerm.match(/^(\d+)\s+(.+)/);
      if (parts) {
        const streetNum = parts[1];
        const streetName = parts[2];
        const numInput = page.locator("input[id*='txtHouseNumberFrom'], input[id*='HouseNumberFrom'], input[id*='txtStreetNo']").first();
        const nameInput = page.locator("input[id*='txtStreetName'], input[id*='StreetName']").first();
        if (await numInput.isVisible().catch(() => false)) {
          await numInput.fill(streetNum);
        }
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill(streetName);
        }
      } else {
        const nameInput = page.locator("input[id*='txtStreetName'], input[id*='StreetName']").first();
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill(searchTerm);
        }
      }
    } else if (searchType === "permit" || searchType === "keyword") {
      const permitInput = page.locator("input[id*='txtPermitNumber'], input[id*='PermitNumber'], input[id*='txtSearchCondition']").first();
      if (await permitInput.isVisible().catch(() => false)) {
        await permitInput.fill(`%${searchTerm}%`);
      } else {
        const projInput = page.locator("input[id*='txtProjectName'], input[id*='ProjectName']").first();
        if (await projInput.isVisible().catch(() => false)) {
          await projInput.fill(searchTerm);
        }
      }
    } else if (searchType === "name" || searchType === "company" || searchType === "company_name") {
      const busiNameInput = page.locator("input[id*='txtGSBusiName']").first();
      if (await busiNameInput.isVisible().catch(() => false)) {
        await busiNameInput.fill(searchTerm);
        log(`Accela: Filled Business Name with "${searchTerm}"`, "scraper");
      } else {
        const lastNameInput = page.locator("input[id*='txtGSLastName'], input[id*='LastName']").first();
        if (await lastNameInput.isVisible().catch(() => false)) {
          await lastNameInput.fill(searchTerm);
          log(`Accela: Filled Last Name with "${searchTerm}"`, "scraper");
        } else {
          const keywordInput = page.locator("#txtSearchCondition").first();
          if (await keywordInput.isVisible().catch(() => false)) {
            await keywordInput.fill(searchTerm);
            log(`Accela: Filled keyword search with "${searchTerm}"`, "scraper");
          } else {
            const projInput = page.locator("input[id*='txtGSProjectName'], input[id*='ProjectName']").first();
            if (await projInput.isVisible().catch(() => false)) {
              await projInput.fill(searchTerm);
              log(`Accela: Filled Project Name with "${searchTerm}"`, "scraper");
            } else {
              log(`Accela: No name/company field found for "${searchTerm}"`, "scraper");
            }
          }
        }
      }
    }

    progress.message = `Searching Accela for "${searchTerm}"...`;
    scrapeJobs.set(jobId, { ...progress });

    const searchBtn = page.locator("a[id*='btnNewSearch'][class*=''], a[id*='btnNewSearch']").first();
    const btnVisible = await searchBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await searchBtn.click();
    } else {
      const altBtn = page.locator("input[id*='btnSearch'], button[id*='btnSearch']").first();
      if (await altBtn.isVisible().catch(() => false)) {
        await altBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
    }
    await page.waitForTimeout(8000);

    const parseAccelaResults = async (): Promise<void> => {
      const html = await page.content();
      const $ = cheerio.load(html);

      const headers: string[] = [];
      $("table[id*='GridView'] tr:first-child th, table[id*='dgPermit'] tr:first-child th, div[id*='resultList'] table tr:first-child th").each((_i, th) => {
        headers.push($(th).text().trim().toLowerCase());
      });

      $("table[id*='GridView'] tr, table[id*='dgPermit'] tr, div[id*='resultList'] table tr").each((_i, row) => {
        const $row = $(row);
        if ($row.find("th").length > 0) return;
        const cells: string[] = [];
        $row.find("td").each((_j, cell) => {
          const linkText = $(cell).find("a").first().text().trim();
          cells.push(linkText || $(cell).text().trim());
        });
        if (cells.length < 3) return;

        const permitNumber = cells.find(c => /^[A-Z0-9]{2,}[-\s]?\d+/i.test(c)) || cells[1] || null;
        if (!permitNumber || permitNumber.toLowerCase().includes("no record")) return;

        const dateCell = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{4}/.test(c));
        const statusCell = cells.find(c => /issued|active|pending|approved|closed|expired|finaled|void|denied/i.test(c));

        let address: string | null = null;
        let permitType: string | null = null;
        let description: string | null = null;
        let applicantName: string | null = null;

        if (headers.length > 0 && headers.length === cells.length) {
          for (let hi = 0; hi < headers.length; hi++) {
            const h = headers[hi];
            const v = cells[hi];
            if (!v || v === permitNumber || v === dateCell || v === statusCell) continue;
            if (h.includes("address") || h.includes("location") || h.includes("project address")) {
              address = v;
            } else if (h.includes("type") || h.includes("record type") || h.includes("permit type")) {
              permitType = v;
            } else if (h.includes("description") || h.includes("work") || h.includes("project name")) {
              description = v;
            } else if (h.includes("applicant") || h.includes("owner") || h.includes("contact") || h.includes("name") || h.includes("contractor") || h.includes("licensee") || h.includes("business")) {
              applicantName = v;
            }
          }
        }

        if (!address && !applicantName) {
          for (const c of cells) {
            if (c === permitNumber || c === dateCell || c === statusCell) continue;
            if (!address && /\d+\s+[A-Z]/i.test(c) && c.length > 5 && c.length < 80) {
              address = c;
            } else if (!permitType && /residential|commercial|building|electrical|plumbing|mechanical|roofing|pool|fence|solar|demo/i.test(c)) {
              permitType = c;
            } else if (c.length > 10 && !description) {
              description = c;
            }
          }
        }

        if (!applicantName && (searchType === "name" || searchType === "company" || searchType === "company_name")) {
          applicantName = searchTerm;
        }

        allResults.push(makeResult({
          permitNumber,
          permitType,
          status: statusCell || null,
          address,
          applicantName,
          description,
          issuedDate: dateCell || null,
        }));
      });

      if (allResults.length === 0) {
        const rows = page.locator("table tr").filter({ hasText: /[A-Z]{2,}\d*[-\s]\d/ });
        const count = await rows.count();
        for (let i = 0; i < Math.min(count, 100); i++) {
          const row = rows.nth(i);
          const text = await row.textContent().catch(() => "");
          if (!text || text.length < 10) continue;
          const match = text.match(/([A-Z0-9]{2,}[-\s]?\d{2,}[-\s]?\d*)/);
          if (match) {
            const addrMatch = text.match(/\d+\s+[A-Z][A-Za-z\s]+(?:ST|AVE|RD|DR|LN|WAY|BLVD|CT|PL|CIR)\b/i);
            allResults.push(makeResult({
              permitNumber: match[1],
              address: addrMatch ? addrMatch[0] : null,
            }));
          }
        }
      }
    };

    await parseAccelaResults();

    if (allResults.length === 0 && (searchType === "name" || searchType === "company" || searchType === "company_name")) {
      const retryStrategies = [
        { field: "input[id*='txtGSLastName']", label: "Last Name" },
        { field: "input[id*='txtGSProjectName']", label: "Project Name" },
        { field: "#txtSearchCondition", label: "Keyword Search" },
      ];

      for (const strategy of retryStrategies) {
        if (allResults.length > 0) break;
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4000);

        const input = page.locator(strategy.field).first();
        if (!(await input.isVisible().catch(() => false))) continue;
        
        const currentValue = await input.inputValue().catch(() => "");
        if (currentValue === searchTerm) continue;

        await input.fill(searchTerm);
        log(`Accela: Retrying with ${strategy.label} field`, "scraper");

        if (strategy.field === "#txtSearchCondition") {
          await page.keyboard.press("Enter");
        } else {
          const retryBtn = page.locator("a[id*='btnNewSearch']").first();
          if (await retryBtn.isVisible().catch(() => false)) {
            await retryBtn.click();
          } else {
            await page.keyboard.press("Enter");
          }
        }
        await page.waitForTimeout(8000);
        await parseAccelaResults();
      }
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Accela total results for "${searchTerm}" on ${databaseName}: ${allResults.length}`, "scraper");

    const newFromBatch = await saveResultsBatch(allResults, databaseId, queryId);
    totalNewResults += newFromBatch;
    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Accela scraper error on ${databaseName}: ${error.message}`, "scraper");
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

  try {
    ({ page, context } = await createIsolatedPage());

    log(`Click2Gov: Navigating to ${searchUrl}`, "scraper");
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

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

    let totalEntries = 0;
    let waitAttempts = 0;
    const maxWaitAttempts = 8;
    while (waitAttempts < maxWaitAttempts) {
      const infoText = await page.locator(".dataTables_info").first().textContent().catch(() => null);
      if (infoText) {
        const m = infoText.match(/of\s+(\d[\d,]*)\s+entries/i);
        if (m) {
          totalEntries = parseInt(m[1].replace(/,/g, ""));
          if (totalEntries > 0) {
            log(`Click2Gov: dataTables_info="${infoText}" -> ${totalEntries} entries`, "scraper");
            break;
          }
        }
      }

      const tableRows = await page.locator("table tbody tr").count().catch(() => 0);
      if (tableRows > 1) {
        log(`Click2Gov: Found ${tableRows} table rows (no dataTables_info yet)`, "scraper");
        break;
      }

      const errorAlert = await page.locator(".alert-danger, .error-message, text=/error occurred/i").first().isVisible().catch(() => false);
      if (errorAlert) {
        log(`Click2Gov: Error alert detected, stopping`, "scraper");
        break;
      }

      waitAttempts++;
      log(`Click2Gov: Waiting for results to load (attempt ${waitAttempts}/${maxWaitAttempts})...`, "scraper");
      await page.waitForTimeout(3000);
    }

    const showingText = await page.locator(".dataTables_info, text=/Showing \\d+ to \\d+ of/").first().textContent().catch(() => null);
    if (showingText) {
      const match = showingText.match(/of\s+(\d[\d,]*)/);
      if (match) {
        totalEntries = parseInt(match[1].replace(/,/g, ""));
        log(`Click2Gov: Found "${showingText}" -> ${totalEntries} total entries`, "scraper");
      }
    }

    if (totalEntries === 0) {
      const noMatchPatterns = [
        "text=/No matching records found/i",
        "text=/No records to display/i",
        "text=/Your search returned no results/i",
      ];
      let isNoResults = false;
      for (const pattern of noMatchPatterns) {
        if (await page.locator(pattern).first().isVisible().catch(() => false)) {
          isNoResults = true;
          break;
        }
      }
      const tableRows = await page.locator("table tbody tr td").count().catch(() => 0);
      if (isNoResults || tableRows === 0) {
        log(`Click2Gov: No results found for "${searchTerm}" (isNoResults=${isNoResults}, tableRows=${tableRows})`, "scraper");
        await finalizeScrape(0, 0, databaseId, databaseName, jobId, progress);
        await closeIsolatedPage(page, context);
        return allResults;
      }
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
      const rowData = await page.evaluate(() => {
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
      return parsed;
    }

    const pageResults = await readVisibleTableRows();
    allResults.push(...pageResults);
    log(`Click2Gov page 1: parsed ${pageResults.length} results`, "scraper");

    const newFromFirstPage = await saveResultsBatch(pageResults, databaseId, queryId);
    totalNewResults += newFromFirstPage;

    const updatedShowingText = await page.locator(".dataTables_info, text=/Showing \\d+ to \\d+ of \\d+/").first().textContent().catch(() => null);
    if (updatedShowingText) {
      const m = updatedShowingText.match(/of (\d+)/);
      if (m) {
        totalEntries = parseInt(m[1]);
        log(`Click2Gov: Updated totalEntries=${totalEntries} after page length change`, "scraper");
      }
    }

    const hasNextBtn = await page.locator(".dataTables_paginate a.next:not(.disabled), .dataTables_paginate a:has-text('Next'):not(.disabled), a.paginate_button.next:not(.disabled), .pagination a:has-text('Next')").first().isVisible().catch(() => false);
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
          const prevShowingText = await page.locator(".dataTables_info").first().textContent().catch(() => "");

          const nextBtn = page.locator(".dataTables_paginate a.next:not(.disabled), .dataTables_paginate a:has-text('Next'):not(.disabled), a.paginate_button.next:not(.disabled)").first();
          const pageLink = page.locator(`.dataTables_paginate a.paginate_button:has-text("${pg}"), .dataTables_paginate span a:has-text("${pg}")`).first();

          if (await pageLink.isVisible().catch(() => false)) {
            await pageLink.click();
          } else if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click();
          } else {
            log(`Click2Gov: Could not find page ${pg} navigation, stopping`, "scraper");
            break;
          }

          await page.waitForFunction(
            (prev: string) => {
              const el = document.querySelector(".dataTables_info");
              return el && el.textContent !== prev;
            },
            prevShowingText,
            { timeout: 15000 }
          ).catch(() => page.waitForTimeout(3000));

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
          break;
        }
      }
    }

    progress.resultsFound = allResults.length;
    progress.message = `Found ${allResults.length} results`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Click2Gov total results for "${searchTerm}" on ${databaseName}: ${allResults.length}`, "scraper");

    await finalizeScrape(allResults.length, totalNewResults, databaseId, databaseName, jobId, progress);
    await closeIsolatedPage(page, context);
  } catch (error: any) {
    try { if (page && context) await closeIsolatedPage(page, context); } catch {}
    progress.status = "error";
    progress.message = `Error: ${error.message}`;
    scrapeJobs.set(jobId, { ...progress });
    log(`Click2Gov scraper error on ${databaseName}: ${error.message}`, "scraper");
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

export async function scrapePermitDetail(
  platform: string,
  searchUrl: string,
  permitNumber: string,
  rawData: Record<string, any> | null
): Promise<PermitDetail | null> {
  switch (platform) {
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
