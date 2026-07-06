import {
  type County, type InsertCounty,
  type PermitDatabase, type InsertPermitDatabase,
  type SearchQuery, type InsertSearchQuery,
  type SearchResult, type InsertSearchResult,
  type ScrapeSchedule, type InsertScrapeSchedule,
  type PropertyAppraiser, type InsertPropertyAppraiser,
  type PropertyRecord, type InsertPropertyRecord,
  type GmbListing, type InsertGmbListing,
  type GmbEditHistory, type InsertGmbEditHistory,
  type RankingGridScan, type InsertRankingGridScan,
  type RankingGridResult, type InsertRankingGridResult,
  type TrackedDomain, type InsertTrackedDomain,
  type ClickVisit, type InsertClickVisit,
  type BlockedIp, type InsertBlockedIp,
  type VpnVisit, type InsertVpnVisit,
  type SeoContract, type InsertSeoContract,
  type ReviewRequest, type InsertReviewRequest,
  type ReviewTemplate, type InsertReviewTemplate,
  type ReviewReminderSettings, type InsertReminderSettings,
  type BetaAccessCode, type InsertBetaAccessCode,
  type LsaManagerConnection, type InsertLsaManagerConnection,
  type LsaManagerAccount as LsaAccount, type InsertLsaManagerAccount as InsertLsaAccount,
  type LsaManagerInvitation, type InsertLsaManagerInvitation,
  type LsaManagerLead as LsaLead, type InsertLsaManagerLead as InsertLsaLead,
  type AdminAuditLog, type InsertAdminAuditLog,
  counties, permitDatabases, searchQueries, searchResults, scrapeSchedules,
  propertyAppraisers, propertyRecords, gmbListings, gmbEditHistory,
  rankingGridScans, rankingGridResults,
  trackedDomains, clickVisits, blockedIps, vpnVisits, seoContracts, reviewRequests, reviewTemplates, reviewReminderSettings, betaAccessCodes,
  lsaManagerConnection, lsaManagerAccounts as lsaAccounts, lsaManagerInvitations, lsaManagerLeads as lsaLeads, adminAuditLog,
  users,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, ilike, inArray, and, sql, gte, lte, lt, isNull, isNotNull, count, countDistinct } from "drizzle-orm";

export interface IStorage {
  getCounties(): Promise<County[]>;
  createCounty(data: InsertCounty): Promise<County>;

  getDatabases(): Promise<PermitDatabase[]>;
  getDatabasesByCounty(countyId: number): Promise<PermitDatabase[]>;
  getDatabasesFiltered(params: {
    stateCode?: string;
    countyId?: number;
    jurisdictionType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ databases: PermitDatabase[]; total: number }>;
  getDatabaseCounts(): Promise<{ total: number; county: number; city: number }>;
  createDatabase(data: InsertPermitDatabase): Promise<PermitDatabase>;
  updateDatabase(id: number, data: Partial<InsertPermitDatabase>): Promise<PermitDatabase | undefined>;

  getSearchQueries(): Promise<SearchQuery[]>;
  createSearchQuery(data: InsertSearchQuery): Promise<SearchQuery>;
  deleteSearchQuery(id: number): Promise<void>;
  deleteAllSearchQueries(): Promise<void>;

  getSearchResults(queryId: number): Promise<SearchResult[]>;
  getSearchResultById(id: number): Promise<SearchResult | undefined>;
  getRecentSearchResults(): Promise<SearchResult[]>;
  createSearchResult(data: InsertSearchResult): Promise<SearchResult>;
  updateSearchResult(id: number, data: Partial<InsertSearchResult>): Promise<void>;
  findExistingResult(databaseId: number, permitNumber: string | null): Promise<SearchResult | undefined>;
  searchLocalResults(searchType: string, searchValue: string): Promise<SearchResult[]>;
  searchLocalResultsByDatabase(searchType: string, searchValue: string, databaseId: number): Promise<SearchResult[]>;

  getScrapeSchedules(): Promise<ScrapeSchedule[]>;
  createScrapeSchedule(data: InsertScrapeSchedule): Promise<ScrapeSchedule>;
  updateScrapeSchedule(id: number, data: Partial<InsertScrapeSchedule>): Promise<ScrapeSchedule | undefined>;
  deleteScrapeSchedule(id: number): Promise<void>;

  getPropertyAppraisers(): Promise<PropertyAppraiser[]>;
  getPropertyAppraisersByCounty(countyId: number): Promise<PropertyAppraiser[]>;
  getPropertyAppraiserById(id: number): Promise<PropertyAppraiser | undefined>;

  getPropertyRecordByAddress(countyId: number, address: string): Promise<PropertyRecord | undefined>;
  getPropertyRecordByParcel(countyId: number, parcelNumber: string): Promise<PropertyRecord | undefined>;
  createPropertyRecord(data: InsertPropertyRecord): Promise<PropertyRecord>;
  getPropertyRecords(countyId: number): Promise<PropertyRecord[]>;

  getGmbListings(userId: number): Promise<GmbListing[]>;
  getGmbListingById(id: number): Promise<GmbListing | undefined>;
  createGmbListing(data: InsertGmbListing): Promise<GmbListing>;
  updateGmbListing(id: number, data: Partial<InsertGmbListing>): Promise<GmbListing | undefined>;
  deleteGmbListing(id: number): Promise<void>;
  getGmbEditHistory(listingId: number): Promise<GmbEditHistory[]>;
  createGmbEditHistory(data: InsertGmbEditHistory): Promise<GmbEditHistory>;

  getRankingGridScans(): Promise<RankingGridScan[]>;
  getRankingGridScanById(id: number): Promise<RankingGridScan | undefined>;
  createRankingGridScan(data: InsertRankingGridScan): Promise<RankingGridScan>;
  updateRankingGridScan(id: number, data: Partial<InsertRankingGridScan>): Promise<RankingGridScan | undefined>;
  deleteRankingGridScan(id: number): Promise<void>;
  getRankingGridResults(scanId: number): Promise<RankingGridResult[]>;
  createRankingGridResult(data: InsertRankingGridResult): Promise<RankingGridResult>;

  getTrackedDomains(userId: number): Promise<TrackedDomain[]>;
  getTrackedDomainById(id: number): Promise<TrackedDomain | undefined>;
  getTrackedDomainByTrackingId(trackingId: string): Promise<TrackedDomain | undefined>;
  createTrackedDomain(data: InsertTrackedDomain): Promise<TrackedDomain>;
  updateTrackedDomain(id: number, data: Partial<InsertTrackedDomain>): Promise<TrackedDomain | undefined>;
  deleteTrackedDomain(id: number): Promise<void>;

  getClickVisits(domainId: number, startDate?: Date, endDate?: Date): Promise<ClickVisit[]>;
  createClickVisit(data: InsertClickVisit): Promise<ClickVisit>;
  getVisitsByIp(domainId: number, ip: string): Promise<ClickVisit[]>;
  getRecentVisitsByIp(domainId: number, ip: string, since: Date): Promise<ClickVisit[]>;

  getBlockedIps(domainId: number): Promise<BlockedIp[]>;
  createBlockedIp(data: InsertBlockedIp): Promise<BlockedIp>;
  deleteBlockedIp(id: number): Promise<void>;
  isIpBlocked(domainId: number, ip: string): Promise<boolean>;

  createVpnVisit(data: InsertVpnVisit): Promise<VpnVisit>;
  getVpnVisits(domainId: number, since?: Date): Promise<VpnVisit[]>;
  updateTrackedDomainSettings(id: number, settings: any): Promise<void>;

  createSeoContract(data: InsertSeoContract): Promise<SeoContract>;
  getSeoContractByToken(token: string): Promise<SeoContract | undefined>;
  getSeoContractsByUser(userId: number): Promise<SeoContract[]>;
  updateSeoContract(id: number, data: Partial<SeoContract>): Promise<SeoContract | undefined>;

  createReviewRequest(data: InsertReviewRequest): Promise<ReviewRequest>;
  getReviewRequestByToken(token: string): Promise<ReviewRequest | undefined>;
  getReviewRequestsByUser(userId: number): Promise<ReviewRequest[]>;
  getTrashedReviewRequests(userId: number): Promise<ReviewRequest[]>;
  updateReviewRequest(id: number, data: Partial<ReviewRequest>): Promise<ReviewRequest | undefined>;
  deleteReviewRequest(id: number): Promise<void>;
  restoreReviewRequest(id: number): Promise<void>;
  permanentlyDeleteReviewRequest(id: number): Promise<void>;
  purgeExpiredTrash(): Promise<number>;

  createReviewTemplate(data: InsertReviewTemplate): Promise<ReviewTemplate>;
  getReviewTemplatesByUser(userId: number): Promise<ReviewTemplate[]>;
  updateReviewTemplate(id: number, data: Partial<ReviewTemplate>): Promise<ReviewTemplate | undefined>;
  deleteReviewTemplate(id: number): Promise<void>;

  getReminderSettings(userId: number): Promise<ReviewReminderSettings | undefined>;
  upsertReminderSettings(userId: number, data: Partial<InsertReminderSettings>): Promise<ReviewReminderSettings>;
  getPendingReminders(): Promise<ReviewRequest[]>;

  createBetaAccessCode(data: InsertBetaAccessCode): Promise<BetaAccessCode>;
  getBetaAccessCodeByCode(code: string): Promise<BetaAccessCode | undefined>;
  getBetaAccessCodesByCreator(userId: number): Promise<BetaAccessCode[]>;
  getAllBetaAccessCodes(): Promise<BetaAccessCode[]>;
  getActiveBetaAccess(userId: number): Promise<BetaAccessCode | undefined>;
  redeemBetaAccessCode(id: number, userId: number): Promise<BetaAccessCode | undefined>;
  revokeBetaAccessCode(id: number): Promise<BetaAccessCode | undefined>;

  getLsaManagerConnection(): Promise<LsaManagerConnection | undefined>;
  upsertLsaManagerConnection(data: Partial<InsertLsaManagerConnection>): Promise<LsaManagerConnection>;
  disconnectLsaManagerConnection(): Promise<void>;

  getLsaAccounts(limit?: number, offset?: number): Promise<LsaAccount[]>;
  countLsaAccounts(): Promise<number>;
  getLsaAccountsWithMetrics(limit?: number, offset?: number): Promise<Array<LsaAccount & { chargedLeads: number; disputedLeads: number; ownerEmail: string | null }>>;
  getLsaAccountById(id: number): Promise<LsaAccount | undefined>;
  getLsaAccountByCustomerId(customerId: string): Promise<LsaAccount | undefined>;
  getLsaAccountsByUser(userId: number): Promise<LsaAccount[]>;
  upsertLsaAccount(data: InsertLsaAccount): Promise<LsaAccount>;
  updateLsaAccount(id: number, data: Partial<InsertLsaAccount>): Promise<LsaAccount | undefined>;

  getLsaManagerInvitations(): Promise<LsaManagerInvitation[]>;
  getLsaManagerInvitationById(id: number): Promise<LsaManagerInvitation | undefined>;
  createLsaManagerInvitation(data: InsertLsaManagerInvitation): Promise<LsaManagerInvitation>;
  updateLsaManagerInvitation(id: number, data: Partial<InsertLsaManagerInvitation>): Promise<LsaManagerInvitation | undefined>;

  getLsaLeadsByAccount(accountId: number, page?: number, limit?: number): Promise<LsaLead[]>;
  getLsaLeadById(id: number): Promise<LsaLead | undefined>;
  createLsaLead(data: InsertLsaLead): Promise<LsaLead>;
  updateLsaLead(id: number, data: Partial<InsertLsaLead>): Promise<LsaLead | undefined>;
  disputeLsaLead(id: number, adminId: number, reason: string): Promise<LsaLead | undefined>;

  getAdminAuditLog(limit?: number, offset?: number): Promise<AdminAuditLog[]>;
  createAdminAuditLog(data: InsertAdminAuditLog): Promise<AdminAuditLog>;
}

export class DatabaseStorage implements IStorage {
  async getCounties(): Promise<County[]> {
    return db.select().from(counties);
  }

  async createCounty(data: InsertCounty): Promise<County> {
    const [county] = await db.insert(counties).values(data).returning();
    return county;
  }

  async getDatabases(): Promise<PermitDatabase[]> {
    return db.select().from(permitDatabases);
  }

  async getDatabasesByCounty(countyId: number): Promise<PermitDatabase[]> {
    return db.select().from(permitDatabases).where(eq(permitDatabases.countyId, countyId));
  }

  async getDatabasesFiltered(params: {
    stateCode?: string;
    countyId?: number;
    jurisdictionType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ databases: PermitDatabase[]; total: number }> {
    const pageSize = params.limit || 25;
    const offset = ((params.page || 1) - 1) * pageSize;

    const conditions: any[] = [];

    if (params.jurisdictionType && params.jurisdictionType !== "all") {
      conditions.push(eq(permitDatabases.jurisdictionType, params.jurisdictionType));
    }

    if (params.countyId) {
      conditions.push(eq(permitDatabases.countyId, params.countyId));
    } else if (params.stateCode) {
      const stateCounties = await db.select({ id: counties.id }).from(counties).where(eq(counties.stateCode, params.stateCode));
      const countyIds = stateCounties.map(c => c.id);
      if (countyIds.length > 0) {
        conditions.push(inArray(permitDatabases.countyId, countyIds));
      } else {
        return { databases: [], total: 0 };
      }
    }

    if (params.search) {
      const searchTerm = `%${params.search.toLowerCase()}%`;
      conditions.push(
        or(
          ilike(permitDatabases.name, searchTerm),
          ilike(permitDatabases.jurisdiction, searchTerm)
        )!
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(permitDatabases)
      .where(whereClause);

    const databases = await db
      .select()
      .from(permitDatabases)
      .where(whereClause)
      .orderBy(permitDatabases.name)
      .limit(pageSize)
      .offset(offset);

    return { databases, total: Number(countResult.count) };
  }

  async getDatabaseCounts(): Promise<{ total: number; county: number; city: number }> {
    const results = await db
      .select({
        jurisdictionType: permitDatabases.jurisdictionType,
        count: sql<number>`count(*)`,
      })
      .from(permitDatabases)
      .groupBy(permitDatabases.jurisdictionType);

    let total = 0, county = 0, city = 0;
    for (const r of results) {
      const c = Number(r.count);
      total += c;
      if (r.jurisdictionType === "county") county = c;
      if (r.jurisdictionType === "city") city = c;
    }
    return { total, county, city };
  }

  async createDatabase(data: InsertPermitDatabase): Promise<PermitDatabase> {
    const [permitDb] = await db.insert(permitDatabases).values(data).returning();
    return permitDb;
  }

  async updateDatabase(id: number, data: Partial<InsertPermitDatabase>): Promise<PermitDatabase | undefined> {
    const [updated] = await db.update(permitDatabases).set(data).where(eq(permitDatabases.id, id)).returning();
    return updated;
  }

  async getSearchQueries(): Promise<SearchQuery[]> {
    return db.select().from(searchQueries).orderBy(desc(searchQueries.createdAt)).limit(50);
  }

  async createSearchQuery(data: InsertSearchQuery): Promise<SearchQuery> {
    const [query] = await db.insert(searchQueries).values(data).returning();
    return query;
  }

  async deleteSearchQuery(id: number): Promise<void> {
    await db.delete(searchResults).where(eq(searchResults.queryId, id));
    await db.delete(searchQueries).where(eq(searchQueries.id, id));
  }

  async deleteAllSearchQueries(): Promise<void> {
    const allQueries = await db.select({ id: searchQueries.id }).from(searchQueries);
    for (const q of allQueries) {
      await db.delete(searchResults).where(eq(searchResults.queryId, q.id));
    }
    await db.delete(searchQueries);
  }

  async getSearchResults(queryId: number): Promise<SearchResult[]> {
    return db.select().from(searchResults).where(eq(searchResults.queryId, queryId));
  }

  async getSearchResultById(id: number): Promise<SearchResult | undefined> {
    const [result] = await db.select().from(searchResults).where(eq(searchResults.id, id)).limit(1);
    return result;
  }

  async getRecentSearchResults(): Promise<SearchResult[]> {
    return db.select().from(searchResults).orderBy(desc(searchResults.createdAt)).limit(100);
  }

  async createSearchResult(data: InsertSearchResult): Promise<SearchResult> {
    const [result] = await db.insert(searchResults).values(data).returning();
    return result;
  }

  async updateSearchResult(id: number, data: Partial<InsertSearchResult>): Promise<void> {
    await db.update(searchResults).set(data).where(eq(searchResults.id, id));
  }

  async findExistingResult(databaseId: number, permitNumber: string | null): Promise<SearchResult | undefined> {
    if (!permitNumber) return undefined;
    const [existing] = await db.select().from(searchResults)
      .where(and(eq(searchResults.databaseId, databaseId), eq(searchResults.permitNumber, permitNumber)))
      .limit(1);
    return existing;
  }

  async searchLocalResults(searchType: string, searchValue: string): Promise<SearchResult[]> {
    const terms = searchValue.trim().split(/\s+/).filter(Boolean);

    let conditions;
    switch (searchType) {
      case "address": {
        const termConditions = terms.map(term => ilike(searchResults.address, `%${term}%`));
        conditions = termConditions.length > 1 ? and(...termConditions) : termConditions[0];
        break;
      }
      case "name":
        conditions = or(
          ...terms.map(term => or(
            ilike(searchResults.applicantName, `%${term}%`),
            ilike(searchResults.contractorName, `%${term}%`),
            sql`${searchResults.rawData}::text ILIKE ${'%' + term + '%'}`
          ))
        );
        break;
      case "company":
      case "company_name":
        conditions = or(
          ...terms.map(term => or(
            ilike(searchResults.contractorName, `%${term}%`),
            ilike(searchResults.applicantName, `%${term}%`),
            ilike(searchResults.description, `%${term}%`),
            sql`${searchResults.rawData}::text ILIKE ${'%' + term + '%'}`
          ))
        );
        break;
      case "permit":
        conditions = ilike(searchResults.permitNumber, `%${searchValue}%`);
        break;
      case "license":
        conditions = ilike(searchResults.permitNumber, `%${searchValue}%`);
        break;
      case "keyword": {
        const kwTerms = terms.map(term => {
          const p = `%${term}%`;
          return or(
            ilike(searchResults.address, p),
            ilike(searchResults.applicantName, p),
            ilike(searchResults.contractorName, p),
            ilike(searchResults.permitNumber, p),
            ilike(searchResults.description, p),
            ilike(searchResults.permitType, p)
          );
        });
        conditions = kwTerms.length > 1 ? and(...kwTerms) : kwTerms[0];
        break;
      }
      default: {
        const searchPattern = `%${searchValue}%`;
        conditions = or(
          ilike(searchResults.address, searchPattern),
          ilike(searchResults.applicantName, searchPattern),
          ilike(searchResults.contractorName, searchPattern),
          ilike(searchResults.permitNumber, searchPattern),
          ilike(searchResults.description, searchPattern)
        );
      }
    }

    const rows = await db.select({
      result: searchResults,
      databaseName: permitDatabases.name,
      jurisdiction: permitDatabases.jurisdiction,
      countyId: permitDatabases.countyId,
    })
      .from(searchResults)
      .leftJoin(permitDatabases, eq(searchResults.databaseId, permitDatabases.id))
      .where(conditions!)
      .orderBy(desc(searchResults.createdAt))
      .limit(1000);

    return rows.map(row => ({
      ...row.result,
      databaseName: row.databaseName,
      jurisdiction: row.jurisdiction,
      countyId: row.countyId,
    }));
  }

  async searchLocalResultsByDatabase(searchType: string, searchValue: string, databaseId: number): Promise<SearchResult[]> {
    const terms = searchValue.trim().split(/\s+/).filter(Boolean);
    const searchPattern = `%${searchValue}%`;

    let textConditions;
    switch (searchType) {
      case "company":
      case "company_name":
      case "name":
        textConditions = or(
          ...terms.map(term => or(
            ilike(searchResults.applicantName, `%${term}%`),
            ilike(searchResults.contractorName, `%${term}%`),
            ilike(searchResults.description, `%${term}%`),
            sql`${searchResults.rawData}::text ILIKE ${'%' + term + '%'}`
          ))
        );
        break;
      default:
        textConditions = or(
          ilike(searchResults.address, searchPattern),
          ilike(searchResults.applicantName, searchPattern),
          ilike(searchResults.contractorName, searchPattern),
          ilike(searchResults.permitNumber, searchPattern),
          ilike(searchResults.description, searchPattern)
        );
    }

    const rows = await db.select()
      .from(searchResults)
      .where(and(eq(searchResults.databaseId, databaseId), textConditions!))
      .limit(500);

    return rows;
  }

  async getScrapeSchedules(): Promise<ScrapeSchedule[]> {
    return db.select().from(scrapeSchedules).orderBy(desc(scrapeSchedules.createdAt));
  }

  async createScrapeSchedule(data: InsertScrapeSchedule): Promise<ScrapeSchedule> {
    const [schedule] = await db.insert(scrapeSchedules).values(data).returning();
    return schedule;
  }

  async updateScrapeSchedule(id: number, data: Partial<InsertScrapeSchedule>): Promise<ScrapeSchedule | undefined> {
    const [schedule] = await db.update(scrapeSchedules).set(data).where(eq(scrapeSchedules.id, id)).returning();
    return schedule;
  }

  async deleteScrapeSchedule(id: number): Promise<void> {
    await db.delete(scrapeSchedules).where(eq(scrapeSchedules.id, id));
  }

  async getPropertyAppraisers(): Promise<PropertyAppraiser[]> {
    return db.select().from(propertyAppraisers);
  }

  async getPropertyAppraisersByCounty(countyId: number): Promise<PropertyAppraiser[]> {
    return db.select().from(propertyAppraisers).where(eq(propertyAppraisers.countyId, countyId));
  }

  async getPropertyAppraiserById(id: number): Promise<PropertyAppraiser | undefined> {
    const [result] = await db.select().from(propertyAppraisers).where(eq(propertyAppraisers.id, id)).limit(1);
    return result;
  }

  async getPropertyRecordByAddress(countyId: number, address: string): Promise<PropertyRecord | undefined> {
    const terms = address.trim().split(/\s+/).filter(Boolean);
    const termConditions = terms.map(term => ilike(propertyRecords.address, `%${term}%`));
    const addressCondition = termConditions.length > 1 ? and(...termConditions) : termConditions[0];
    const [result] = await db.select().from(propertyRecords)
      .where(and(eq(propertyRecords.countyId, countyId), addressCondition!))
      .orderBy(desc(propertyRecords.fetchedAt))
      .limit(1);
    return result;
  }

  async getPropertyRecordByParcel(countyId: number, parcelNumber: string): Promise<PropertyRecord | undefined> {
    const [result] = await db.select().from(propertyRecords)
      .where(and(eq(propertyRecords.countyId, countyId), eq(propertyRecords.parcelNumber, parcelNumber)))
      .orderBy(desc(propertyRecords.fetchedAt))
      .limit(1);
    return result;
  }

  async createPropertyRecord(data: InsertPropertyRecord): Promise<PropertyRecord> {
    const [record] = await db.insert(propertyRecords).values(data).returning();
    return record;
  }

  async getPropertyRecords(countyId: number): Promise<PropertyRecord[]> {
    return db.select().from(propertyRecords)
      .where(eq(propertyRecords.countyId, countyId))
      .orderBy(desc(propertyRecords.fetchedAt))
      .limit(100);
  }
  async getGmbListings(userId: number): Promise<GmbListing[]> {
    return db.select().from(gmbListings)
      .where(eq(gmbListings.userId, userId))
      .orderBy(desc(gmbListings.createdAt));
  }

  async getGmbListingById(id: number): Promise<GmbListing | undefined> {
    const [listing] = await db.select().from(gmbListings).where(eq(gmbListings.id, id));
    return listing;
  }

  async createGmbListing(data: InsertGmbListing): Promise<GmbListing> {
    const [listing] = await db.insert(gmbListings).values(data).returning();
    return listing;
  }

  async updateGmbListing(id: number, data: Partial<InsertGmbListing>): Promise<GmbListing | undefined> {
    const [listing] = await db.update(gmbListings).set(data).where(eq(gmbListings.id, id)).returning();
    return listing;
  }

  async deleteGmbListing(id: number): Promise<void> {
    await db.delete(gmbEditHistory).where(eq(gmbEditHistory.listingId, id));
    await db.delete(gmbListings).where(eq(gmbListings.id, id));
  }

  async getGmbEditHistory(listingId: number): Promise<GmbEditHistory[]> {
    return db.select().from(gmbEditHistory)
      .where(eq(gmbEditHistory.listingId, listingId))
      .orderBy(desc(gmbEditHistory.detectedAt));
  }

  async createGmbEditHistory(data: InsertGmbEditHistory): Promise<GmbEditHistory> {
    const [edit] = await db.insert(gmbEditHistory).values(data).returning();
    return edit;
  }

  async getRankingGridScans(): Promise<RankingGridScan[]> {
    return db.select().from(rankingGridScans).orderBy(desc(rankingGridScans.createdAt));
  }

  async getRankingGridScanById(id: number): Promise<RankingGridScan | undefined> {
    const [scan] = await db.select().from(rankingGridScans).where(eq(rankingGridScans.id, id));
    return scan;
  }

  async createRankingGridScan(data: InsertRankingGridScan): Promise<RankingGridScan> {
    const [scan] = await db.insert(rankingGridScans).values(data).returning();
    return scan;
  }

  async updateRankingGridScan(id: number, data: Partial<InsertRankingGridScan>): Promise<RankingGridScan | undefined> {
    const [scan] = await db.update(rankingGridScans).set(data).where(eq(rankingGridScans.id, id)).returning();
    return scan;
  }

  async deleteRankingGridScan(id: number): Promise<void> {
    await db.delete(rankingGridResults).where(eq(rankingGridResults.scanId, id));
    await db.delete(rankingGridScans).where(eq(rankingGridScans.id, id));
  }

  async getRankingGridResults(scanId: number): Promise<RankingGridResult[]> {
    return db.select().from(rankingGridResults).where(eq(rankingGridResults.scanId, scanId));
  }

  async createRankingGridResult(data: InsertRankingGridResult): Promise<RankingGridResult> {
    const [result] = await db.insert(rankingGridResults).values(data).returning();
    return result;
  }

  async getTrackedDomains(userId: number): Promise<TrackedDomain[]> {
    return db.select().from(trackedDomains).where(eq(trackedDomains.userId, userId)).orderBy(desc(trackedDomains.createdAt));
  }

  async getTrackedDomainById(id: number): Promise<TrackedDomain | undefined> {
    const [domain] = await db.select().from(trackedDomains).where(eq(trackedDomains.id, id));
    return domain;
  }

  async getTrackedDomainByTrackingId(trackingId: string): Promise<TrackedDomain | undefined> {
    const [domain] = await db.select().from(trackedDomains).where(eq(trackedDomains.trackingId, trackingId));
    return domain;
  }

  async createTrackedDomain(data: InsertTrackedDomain): Promise<TrackedDomain> {
    const [domain] = await db.insert(trackedDomains).values(data).returning();
    return domain;
  }

  async updateTrackedDomain(id: number, data: Partial<InsertTrackedDomain>): Promise<TrackedDomain | undefined> {
    const [domain] = await db.update(trackedDomains).set(data).where(eq(trackedDomains.id, id)).returning();
    return domain;
  }

  async deleteTrackedDomain(id: number): Promise<void> {
    await db.delete(blockedIps).where(eq(blockedIps.domainId, id));
    await db.delete(clickVisits).where(eq(clickVisits.domainId, id));
    await db.delete(trackedDomains).where(eq(trackedDomains.id, id));
  }

  async getClickVisits(domainId: number, startDate?: Date, endDate?: Date): Promise<ClickVisit[]> {
    const conditions = [eq(clickVisits.domainId, domainId)];
    if (startDate) conditions.push(gte(clickVisits.visitedAt, startDate));
    if (endDate) conditions.push(lte(clickVisits.visitedAt, endDate));
    return db.select().from(clickVisits).where(and(...conditions)).orderBy(desc(clickVisits.visitedAt)).limit(1000);
  }

  async createClickVisit(data: InsertClickVisit): Promise<ClickVisit> {
    const [visit] = await db.insert(clickVisits).values(data).returning();
    return visit;
  }

  async getVisitsByIp(domainId: number, ip: string): Promise<ClickVisit[]> {
    return db.select().from(clickVisits).where(and(eq(clickVisits.domainId, domainId), eq(clickVisits.ipAddress, ip))).orderBy(desc(clickVisits.visitedAt));
  }

  async getRecentVisitsByIp(domainId: number, ip: string, since: Date): Promise<ClickVisit[]> {
    return db.select().from(clickVisits).where(and(eq(clickVisits.domainId, domainId), eq(clickVisits.ipAddress, ip), gte(clickVisits.visitedAt, since))).orderBy(desc(clickVisits.visitedAt));
  }

  async getBlockedIps(domainId: number): Promise<BlockedIp[]> {
    return db.select().from(blockedIps).where(and(eq(blockedIps.domainId, domainId), eq(blockedIps.isActive, true))).orderBy(desc(blockedIps.blockedAt));
  }

  async createBlockedIp(data: InsertBlockedIp): Promise<BlockedIp> {
    const [blocked] = await db.insert(blockedIps).values(data).returning();
    return blocked;
  }

  async deleteBlockedIp(id: number): Promise<void> {
    await db.delete(blockedIps).where(eq(blockedIps.id, id));
  }

  async isIpBlocked(domainId: number, ip: string): Promise<boolean> {
    const [result] = await db.select().from(blockedIps).where(and(eq(blockedIps.domainId, domainId), eq(blockedIps.ipAddress, ip), eq(blockedIps.isActive, true))).limit(1);
    return !!result;
  }

  async createVpnVisit(data: InsertVpnVisit): Promise<VpnVisit> {
    const [visit] = await db.insert(vpnVisits).values(data).returning();
    return visit;
  }

  async getVpnVisits(domainId: number, since?: Date): Promise<VpnVisit[]> {
    if (since) {
      return db.select().from(vpnVisits).where(and(eq(vpnVisits.domainId, domainId), gte(vpnVisits.visitedAt, since))).orderBy(desc(vpnVisits.visitedAt));
    }
    return db.select().from(vpnVisits).where(eq(vpnVisits.domainId, domainId)).orderBy(desc(vpnVisits.visitedAt));
  }

  async updateTrackedDomainSettings(id: number, settings: any): Promise<void> {
    await db.update(trackedDomains).set({ settings }).where(eq(trackedDomains.id, id));
  }

  async createSeoContract(data: InsertSeoContract): Promise<SeoContract> {
    const [contract] = await db.insert(seoContracts).values(data).returning();
    return contract;
  }

  async getSeoContractByToken(token: string): Promise<SeoContract | undefined> {
    const [contract] = await db.select().from(seoContracts).where(eq(seoContracts.token, token)).limit(1);
    return contract;
  }

  async getSeoContractsByUser(userId: number): Promise<SeoContract[]> {
    return db.select().from(seoContracts).where(eq(seoContracts.userId, userId)).orderBy(desc(seoContracts.createdAt));
  }

  async updateSeoContract(id: number, data: Partial<SeoContract>): Promise<SeoContract | undefined> {
    const [contract] = await db.update(seoContracts).set(data).where(eq(seoContracts.id, id)).returning();
    return contract;
  }

  async createReviewRequest(data: InsertReviewRequest): Promise<ReviewRequest> {
    const [request] = await db.insert(reviewRequests).values(data).returning();
    return request;
  }

  async getReviewRequestByToken(token: string): Promise<ReviewRequest | undefined> {
    const [request] = await db.select().from(reviewRequests).where(eq(reviewRequests.token, token)).limit(1);
    return request;
  }

  async getReviewRequestsByUser(userId: number): Promise<ReviewRequest[]> {
    return db.select().from(reviewRequests).where(and(eq(reviewRequests.userId, userId), isNull(reviewRequests.deletedAt))).orderBy(desc(reviewRequests.createdAt));
  }

  async getTrashedReviewRequests(userId: number): Promise<ReviewRequest[]> {
    return db.select().from(reviewRequests).where(and(eq(reviewRequests.userId, userId), isNotNull(reviewRequests.deletedAt))).orderBy(desc(reviewRequests.deletedAt));
  }

  async updateReviewRequest(id: number, data: Partial<ReviewRequest>): Promise<ReviewRequest | undefined> {
    const [request] = await db.update(reviewRequests).set(data).where(eq(reviewRequests.id, id)).returning();
    return request;
  }

  async deleteReviewRequest(id: number): Promise<void> {
    await db.update(reviewRequests).set({ deletedAt: new Date() }).where(eq(reviewRequests.id, id));
  }

  async restoreReviewRequest(id: number): Promise<void> {
    await db.update(reviewRequests).set({ deletedAt: null }).where(eq(reviewRequests.id, id));
  }

  async permanentlyDeleteReviewRequest(id: number): Promise<void> {
    await db.delete(reviewRequests).where(eq(reviewRequests.id, id));
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const deleted = await db.delete(reviewRequests).where(and(isNotNull(reviewRequests.deletedAt), lt(reviewRequests.deletedAt, cutoff))).returning();
    return deleted.length;
  }

  async createReviewTemplate(data: InsertReviewTemplate): Promise<ReviewTemplate> {
    const [template] = await db.insert(reviewTemplates).values(data).returning();
    return template;
  }

  async getReviewTemplatesByUser(userId: number): Promise<ReviewTemplate[]> {
    return db.select().from(reviewTemplates).where(eq(reviewTemplates.userId, userId)).orderBy(desc(reviewTemplates.createdAt));
  }

  async updateReviewTemplate(id: number, data: Partial<ReviewTemplate>): Promise<ReviewTemplate | undefined> {
    const [template] = await db.update(reviewTemplates).set(data).where(eq(reviewTemplates.id, id)).returning();
    return template;
  }

  async deleteReviewTemplate(id: number): Promise<void> {
    await db.delete(reviewTemplates).where(eq(reviewTemplates.id, id));
  }

  async getReminderSettings(userId: number): Promise<ReviewReminderSettings | undefined> {
    const [result] = await db.select().from(reviewReminderSettings).where(eq(reviewReminderSettings.userId, userId)).limit(1);
    return result;
  }

  async upsertReminderSettings(userId: number, data: Partial<InsertReminderSettings>): Promise<ReviewReminderSettings> {
    const existing = await this.getReminderSettings(userId);
    if (existing) {
      const [updated] = await db.update(reviewReminderSettings).set({ ...data, updatedAt: new Date() }).where(eq(reviewReminderSettings.userId, userId)).returning();
      return updated;
    }
    const [created] = await db.insert(reviewReminderSettings).values({ ...data, userId } as any).returning();
    return created;
  }

  async getPendingReminders(): Promise<ReviewRequest[]> {
    return db.select().from(reviewRequests).where(
      and(
        eq(reviewRequests.status, "sent"),
        eq(reviewRequests.unsubscribed, false),
        lte(reviewRequests.nextReminderAt, new Date()),
      )
    );
  }

  async createBetaAccessCode(data: InsertBetaAccessCode): Promise<BetaAccessCode> {
    const [code] = await db.insert(betaAccessCodes).values(data).returning();
    return code;
  }

  async getBetaAccessCodeByCode(code: string): Promise<BetaAccessCode | undefined> {
    const [result] = await db.select().from(betaAccessCodes).where(eq(betaAccessCodes.code, code)).limit(1);
    return result;
  }

  async getBetaAccessCodesByCreator(userId: number): Promise<BetaAccessCode[]> {
    return db.select().from(betaAccessCodes).where(eq(betaAccessCodes.createdByUserId, userId)).orderBy(desc(betaAccessCodes.createdAt));
  }

  async getAllBetaAccessCodes(): Promise<BetaAccessCode[]> {
    return db.select().from(betaAccessCodes).orderBy(desc(betaAccessCodes.createdAt));
  }

  async getActiveBetaAccess(userId: number): Promise<BetaAccessCode | undefined> {
    const [result] = await db.select().from(betaAccessCodes)
      .where(and(
        eq(betaAccessCodes.redeemedByUserId, userId),
        gte(betaAccessCodes.expiresAt, new Date()),
      ))
      .orderBy(desc(betaAccessCodes.expiresAt))
      .limit(1);
    return result;
  }

  async redeemBetaAccessCode(id: number, userId: number): Promise<BetaAccessCode | undefined> {
    const [result] = await db.update(betaAccessCodes).set({
      redeemedByUserId: userId,
      redeemedAt: new Date(),
    }).where(eq(betaAccessCodes.id, id)).returning();
    return result;
  }

  async revokeBetaAccessCode(id: number): Promise<BetaAccessCode | undefined> {
    const [result] = await db.update(betaAccessCodes).set({
      revoked: true,
      revokedAt: new Date(),
    }).where(eq(betaAccessCodes.id, id)).returning();
    return result;
  }

  async getLsaManagerConnection(): Promise<LsaManagerConnection | undefined> {
    const [conn] = await db.select().from(lsaManagerConnection).orderBy(desc(lsaManagerConnection.connectedAt)).limit(1);
    return conn;
  }

  async upsertLsaManagerConnection(data: Partial<InsertLsaManagerConnection>): Promise<LsaManagerConnection> {
    const existing = await this.getLsaManagerConnection();
    if (existing) {
      const [updated] = await db.update(lsaManagerConnection).set({ ...data, lastRefreshedAt: new Date() }).where(eq(lsaManagerConnection.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(lsaManagerConnection).values(data as InsertLsaManagerConnection).returning();
    return created;
  }

  async disconnectLsaManagerConnection(): Promise<void> {
    await db.update(lsaManagerConnection).set({ status: "disconnected" });
  }

  async getLsaAccounts(limit = 50, offset = 0): Promise<LsaAccount[]> {
    return db.select().from(lsaAccounts).orderBy(desc(lsaAccounts.createdAt)).limit(limit).offset(offset);
  }

  async countLsaAccounts(): Promise<number> {
    const [row] = await db.select({ count: count() }).from(lsaAccounts);
    return Number(row?.count ?? 0);
  }

  async getLsaAccountsWithMetrics(limit = 50, offset = 0): Promise<Array<LsaAccount & { chargedLeads: number; disputedLeads: number; ownerEmail: string | null }>> {
    const accounts = await db.select().from(lsaAccounts).orderBy(desc(lsaAccounts.createdAt)).limit(limit).offset(offset);
    if (accounts.length === 0) return [];
    const accountIds = accounts.map(a => a.id);
    const ownerIds = [...new Set(accounts.map(a => a.userId).filter(Boolean))] as number[];

    const [chargedRows, disputedRows, ownerRows] = await Promise.all([
      db.select({ accountId: lsaLeads.accountId, chargedCount: count() })
        .from(lsaLeads)
        .where(and(inArray(lsaLeads.accountId, accountIds), eq(lsaLeads.charged, true)))
        .groupBy(lsaLeads.accountId),
      db.select({ accountId: lsaLeads.accountId, disputedCount: count() })
        .from(lsaLeads)
        .where(and(inArray(lsaLeads.accountId, accountIds), eq(lsaLeads.disputed, true)))
        .groupBy(lsaLeads.accountId),
      ownerIds.length > 0
        ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ownerIds))
        : Promise.resolve([]),
    ]);

    const chargedMap = new Map(chargedRows.map(r => [r.accountId, Number(r.chargedCount)]));
    const disputedMap = new Map(disputedRows.map(r => [r.accountId, Number(r.disputedCount)]));
    const ownerMap = new Map(ownerRows.map(r => [r.id, r.email]));

    return accounts.map(a => ({
      ...a,
      chargedLeads: chargedMap.get(a.id) ?? 0,
      disputedLeads: disputedMap.get(a.id) ?? 0,
      ownerEmail: a.userId ? (ownerMap.get(a.userId) ?? null) : null,
    }));
  }

  async getLsaAccountById(id: number): Promise<LsaAccount | undefined> {
    const [account] = await db.select().from(lsaAccounts).where(eq(lsaAccounts.id, id)).limit(1);
    return account;
  }

  async getLsaAccountByCustomerId(customerId: string): Promise<LsaAccount | undefined> {
    const [account] = await db.select().from(lsaAccounts).where(eq(lsaAccounts.customerId, customerId.replace(/-/g, ""))).limit(1);
    return account;
  }

  async getLsaAccountsByUser(userId: number): Promise<LsaAccount[]> {
    return db.select().from(lsaAccounts).where(eq(lsaAccounts.userId, userId)).orderBy(desc(lsaAccounts.createdAt));
  }

  async upsertLsaAccount(data: InsertLsaAccount): Promise<LsaAccount> {
    const existing = await this.getLsaAccountByCustomerId(data.customerId);
    if (existing) {
      const incomingType = data.linkType || "self";
      const existingType = existing.linkType;
      let reconciledType: string;
      if (existingType === incomingType) {
        reconciledType = existingType;
      } else if (
        (existingType === "central" && incomingType === "self") ||
        (existingType === "self" && incomingType === "central") ||
        existingType === "both" || incomingType === "both"
      ) {
        reconciledType = "both";
      } else {
        reconciledType = incomingType;
      }
      const [updated] = await db.update(lsaAccounts)
        .set({ ...data, linkType: reconciledType, updatedAt: new Date() })
        .where(eq(lsaAccounts.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(lsaAccounts).values(data).returning();
    return created;
  }

  async updateLsaAccount(id: number, data: Partial<InsertLsaAccount>): Promise<LsaAccount | undefined> {
    const [updated] = await db.update(lsaAccounts).set({ ...data, updatedAt: new Date() }).where(eq(lsaAccounts.id, id)).returning();
    return updated;
  }

  async getLsaManagerInvitations(): Promise<LsaManagerInvitation[]> {
    return db.select().from(lsaManagerInvitations).orderBy(desc(lsaManagerInvitations.invitedAt));
  }

  async getLsaManagerInvitationById(id: number): Promise<LsaManagerInvitation | undefined> {
    const [inv] = await db.select().from(lsaManagerInvitations).where(eq(lsaManagerInvitations.id, id)).limit(1);
    return inv;
  }

  async createLsaManagerInvitation(data: InsertLsaManagerInvitation): Promise<LsaManagerInvitation> {
    const [inv] = await db.insert(lsaManagerInvitations).values(data).returning();
    return inv;
  }

  async updateLsaManagerInvitation(id: number, data: Partial<InsertLsaManagerInvitation>): Promise<LsaManagerInvitation | undefined> {
    const [inv] = await db.update(lsaManagerInvitations).set(data).where(eq(lsaManagerInvitations.id, id)).returning();
    return inv;
  }

  async getLsaLeadsByAccount(accountId: number, page = 1, limit = 50): Promise<LsaLead[]> {
    const offset = (page - 1) * limit;
    return db.select().from(lsaLeads).where(eq(lsaLeads.accountId, accountId)).orderBy(desc(lsaLeads.createdAt)).limit(limit).offset(offset);
  }

  async getLsaLeadById(id: number): Promise<LsaLead | undefined> {
    const [lead] = await db.select().from(lsaLeads).where(eq(lsaLeads.id, id)).limit(1);
    return lead;
  }

  async createLsaLead(data: InsertLsaLead): Promise<LsaLead> {
    const [lead] = await db.insert(lsaLeads).values(data).returning();
    return lead;
  }

  async updateLsaLead(id: number, data: Partial<InsertLsaLead>): Promise<LsaLead | undefined> {
    const [lead] = await db.update(lsaLeads).set(data).where(eq(lsaLeads.id, id)).returning();
    return lead;
  }

  async disputeLsaLead(id: number, adminId: number, reason: string): Promise<LsaLead | undefined> {
    const [updated] = await db.update(lsaLeads)
      .set({
        disputed: true,
        disputeReason: reason,
        disputedAt: new Date(),
        disputedByAdminId: adminId,
      })
      .where(
        and(
          eq(lsaLeads.id, id),
          eq(lsaLeads.charged, true),
          eq(lsaLeads.disputed, false),
        )
      )
      .returning();
    if (!updated) {
      const lead = await this.getLsaLeadById(id);
      if (!lead) throw new Error("Lead not found");
      if (!lead.charged) throw new Error("Only charged leads can be disputed");
      if (lead.disputed) throw new Error("Lead has already been disputed");
      throw new Error("Dispute failed due to concurrent modification");
    }
    return updated;
  }

  async getAdminAuditLog(limit = 100, offset = 0): Promise<AdminAuditLog[]> {
    return db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limit).offset(offset);
  }

  async createAdminAuditLog(data: InsertAdminAuditLog): Promise<AdminAuditLog> {
    const [log] = await db.insert(adminAuditLog).values(data).returning();
    return log;
  }
}

export const storage = new DatabaseStorage();
