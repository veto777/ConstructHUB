import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  googleId: text("google_id").unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationExpiry: timestamp("verification_expiry"),
  resetToken: text("reset_token"),
  resetExpiry: timestamp("reset_expiry"),
  companyName: text("company_name"),
  companyLogoUrl: text("company_logo_url"),
  googleProfileUrl: text("google_profile_url"),
  accountId: text("account_id").unique(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleTokenExpiry: timestamp("google_token_expiry"),
  // Set when the account was created through a CRM beta invite. Beta accounts
  // get unlimited CRM seats and are never billed (see server/crm/tenancy.ts).
  betaAt: timestamp("beta_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const counties = pgTable("counties", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  stateCode: text("state_code").notNull(),
});

export const permitDatabases = pgTable("permit_databases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  jurisdictionType: text("jurisdiction_type").notNull(),
  countyId: integer("county_id").notNull(),
  portalUrl: text("portal_url"),
  searchUrl: text("search_url"),
  platform: text("platform"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  searchableFields: text("searchable_fields").array(),
  isActive: boolean("is_active").notNull().default(true),
  lastScrapedAt: timestamp("last_scraped_at"),
  // Link-verifier status: 'live' | 'dead' | 'unchecked' (see scripts/verify-links.ts).
  linkStatus: text("link_status").default("unchecked"),
  lastVerifiedAt: timestamp("last_verified_at"),
  notes: text("notes"),
});

export const searchQueries = pgTable("search_queries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  searchType: text("search_type").notNull(),
  searchValue: text("search_value").notNull(),
  countyId: integer("county_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const searchResults = pgTable("search_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  queryId: integer("query_id").notNull(),
  databaseId: integer("database_id").notNull(),
  permitNumber: text("permit_number"),
  permitType: text("permit_type"),
  status: text("status"),
  address: text("address"),
  applicantName: text("applicant_name"),
  contractorName: text("contractor_name"),
  description: text("description"),
  issuedDate: text("issued_date"),
  parcelNumber: text("parcel_number"),
  expirationDate: text("expiration_date"),
  finalizedDate: text("finalized_date"),
  district: text("district"),
  contacts: jsonb("contacts"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const propertyAppraisers = pgTable("property_appraisers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  countyId: integer("county_id").notNull(),
  // Nullable: a real assessment office may have no online portal on record. We
  // store null rather than fabricating a URL (see server/data/appraisers.json).
  portalUrl: text("portal_url"),
  searchUrl: text("search_url"),
  platform: text("platform"),
  phone: text("phone"),
  address: text("address"),
  searchableFields: text("searchable_fields").array(),
  addressSearchPattern: text("address_search_pattern"),
  ownerSearchPattern: text("owner_search_pattern"),
  parcelSearchPattern: text("parcel_search_pattern"),
  isActive: boolean("is_active").notNull().default(true),
  // Link-verifier status: 'live' | 'dead' | 'unchecked' (see scripts/verify-links.ts).
  linkStatus: text("link_status").default("unchecked"),
  lastVerifiedAt: timestamp("last_verified_at"),
  notes: text("notes"),
});

export const propertyRecords = pgTable("property_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  appraiserId: integer("appraiser_id").notNull(),
  countyId: integer("county_id").notNull(),
  address: text("address"),
  parcelNumber: text("parcel_number"),
  ownerName: text("owner_name"),
  isLlc: boolean("is_llc").default(false),
  ownerType: text("owner_type"),
  propertyUse: text("property_use"),
  yearBuilt: text("year_built"),
  livingSqFt: text("living_sq_ft"),
  grossSqFt: text("gross_sq_ft"),
  lotSize: text("lot_size"),
  landArea: text("land_area"),
  justMarketValue: text("just_market_value"),
  assessedValue: text("assessed_value"),
  taxableValue: text("taxable_value"),
  lastSaleDate: text("last_sale_date"),
  lastSalePrice: text("last_sale_price"),
  zoning: text("zoning"),
  legalDescription: text("legal_description"),
  taxDistrict: text("tax_district"),
  homesteadExemption: text("homestead_exemption"),
  constructionDetails: jsonb("construction_details"),
  salesHistory: jsonb("sales_history"),
  valueHistory: jsonb("value_history"),
  rawData: jsonb("raw_data"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const scrapeSchedules = pgTable("scrape_schedules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  databaseId: integer("database_id").notNull(),
  frequency: text("frequency").notNull().default("daily"),
  searchType: text("search_type").notNull(),
  searchValue: text("search_value").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true });
export const insertCountySchema = createInsertSchema(counties).omit({});
export const insertPermitDatabaseSchema = createInsertSchema(permitDatabases).omit({});
export const insertSearchQuerySchema = createInsertSchema(searchQueries).omit({ createdAt: true });
export const insertSearchResultSchema = createInsertSchema(searchResults).omit({ createdAt: true });
export const insertPropertyAppraiserSchema = createInsertSchema(propertyAppraisers).omit({});
export const insertPropertyRecordSchema = createInsertSchema(propertyRecords).omit({ createdAt: true, fetchedAt: true });
export const insertScrapeScheduleSchema = createInsertSchema(scrapeSchedules).omit({ createdAt: true });

export const gmbListings = pgTable("gmb_listings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  placeId: text("place_id").notNull(),
  businessName: text("business_name").notNull(),
  address: text("address"),
  phone: text("phone"),
  website: text("website"),
  category: text("category"),
  hours: text("hours"),
  photoCount: integer("photo_count"),
  rating: text("rating"),
  reviewCount: integer("review_count"),
  isMonitoring: boolean("is_monitoring").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gmbEditHistory = pgTable("gmb_edit_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  listingId: integer("listing_id").notNull(),
  fieldChanged: text("field_changed").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});

export const rankingGridScans = pgTable("ranking_grid_scans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  businessName: text("business_name").notNull(),
  placeId: text("place_id").notNull(),
  address: text("address"),
  lat: text("lat").notNull(),
  lon: text("lon").notNull(),
  gridSize: integer("grid_size").notNull().default(3),
  gridDistance: text("grid_distance").notNull().default("1"),
  keyword: text("keyword").notNull(),
  status: text("status").notNull().default("pending"),
  averageRank: text("average_rank"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rankingGridResults = pgTable("ranking_grid_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scanId: integer("scan_id").notNull(),
  gridRow: integer("grid_row").notNull(),
  gridCol: integer("grid_col").notNull(),
  lat: text("lat").notNull(),
  lon: text("lon").notNull(),
  rank: integer("rank"),
  totalResults: integer("total_results"),
  topCompetitors: jsonb("top_competitors"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const insertGmbListingSchema = createInsertSchema(gmbListings).omit({ createdAt: true });
export const insertGmbEditHistorySchema = createInsertSchema(gmbEditHistory).omit({ detectedAt: true });
export const insertRankingGridScanSchema = createInsertSchema(rankingGridScans).omit({ createdAt: true });
export const insertRankingGridResultSchema = createInsertSchema(rankingGridResults).omit({ checkedAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type County = typeof counties.$inferSelect;
export type InsertCounty = z.infer<typeof insertCountySchema>;
export type PermitDatabase = typeof permitDatabases.$inferSelect;
export type InsertPermitDatabase = z.infer<typeof insertPermitDatabaseSchema>;
export type SearchQuery = typeof searchQueries.$inferSelect;
export type InsertSearchQuery = z.infer<typeof insertSearchQuerySchema>;
export type SearchResult = typeof searchResults.$inferSelect;
export type InsertSearchResult = z.infer<typeof insertSearchResultSchema>;
export type PropertyAppraiser = typeof propertyAppraisers.$inferSelect;
export type InsertPropertyAppraiser = z.infer<typeof insertPropertyAppraiserSchema>;
export type PropertyRecord = typeof propertyRecords.$inferSelect;
export type InsertPropertyRecord = z.infer<typeof insertPropertyRecordSchema>;
export type ScrapeSchedule = typeof scrapeSchedules.$inferSelect;
export type InsertScrapeSchedule = z.infer<typeof insertScrapeScheduleSchema>;
export type GmbListing = typeof gmbListings.$inferSelect;
export type InsertGmbListing = z.infer<typeof insertGmbListingSchema>;
export type GmbEditHistory = typeof gmbEditHistory.$inferSelect;
export type InsertGmbEditHistory = z.infer<typeof insertGmbEditHistorySchema>;
export type RankingGridScan = typeof rankingGridScans.$inferSelect;
export type InsertRankingGridScan = z.infer<typeof insertRankingGridScanSchema>;
export type RankingGridResult = typeof rankingGridResults.$inferSelect;
export type InsertRankingGridResult = z.infer<typeof insertRankingGridResultSchema>;

export const competitorScans = pgTable("competitor_scans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  industry: text("industry").notNull(),
  location: text("location").notNull(),
  lat: text("lat"),
  lon: text("lon"),
  radius: integer("radius").notNull().default(25),
  status: text("status").notNull().default("pending"),
  totalFound: integer("total_found").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const competitorListings = pgTable("competitor_listings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scanId: integer("scan_id").notNull(),
  userId: integer("user_id").notNull(),
  placeId: text("place_id").notNull(),
  businessName: text("business_name").notNull(),
  address: text("address"),
  phone: text("phone"),
  website: text("website"),
  rating: text("rating"),
  reviewCount: integer("review_count"),
  category: text("category"),
  isNew: boolean("is_new").notNull().default(false),
  bsScore: integer("bs_score"),
  bsReasons: jsonb("bs_reasons"),
  reviewAnalysis: jsonb("review_analysis"),
  rankHistory: jsonb("rank_history"),
  lastCheckedAt: timestamp("last_checked_at").notNull().defaultNow(),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
});

export const insertCompetitorScanSchema = createInsertSchema(competitorScans).omit({ createdAt: true });
export const insertCompetitorListingSchema = createInsertSchema(competitorListings).omit({ lastCheckedAt: true, firstSeenAt: true });

export type CompetitorScan = typeof competitorScans.$inferSelect;
export type InsertCompetitorScan = z.infer<typeof insertCompetitorScanSchema>;
export type CompetitorListing = typeof competitorListings.$inferSelect;
export type InsertCompetitorListing = z.infer<typeof insertCompetitorListingSchema>;

export const subscriptions = pgTable("subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ createdAt: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

export const businessLocations = pgTable("business_locations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  businessName: text("business_name").notNull(),
  placeId: text("place_id"),
  googleCid: text("google_cid"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  country: text("country").default("US"),
  phone: text("phone"),
  website: text("website"),
  description: text("description"),
  categories: text("categories").array(),
  services: text("services").array(),
  serviceAreas: text("service_areas").array(),
  hours: jsonb("hours"),
  openingDate: text("opening_date"),
  openStatus: text("open_status").default("Open"),
  socialProfiles: jsonb("social_profiles"),
  tags: text("tags").array(),
  businessPhotoCount: integer("business_photo_count").default(0),
  customerPhotoCount: integer("customer_photo_count").default(0),
  notificationEmail: text("notification_email"),
  notifyFields: text("notify_fields").array(),
  gbpManagementEnabled: boolean("gbp_management_enabled").default(false),
  listingsCount: integer("listings_count").default(0),
  reviewCount: integer("review_count").default(0),
  newReviewCount: integer("new_review_count").default(0),
  monthlyViews: integer("monthly_views").default(0),
  avgRank: real("avg_rank"),
  avgRating: real("avg_rating"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const citationCampaigns = pgTable("citation_campaigns", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  locationId: integer("location_id"),
  campaignName: text("campaign_name").notNull(),
  businessName: text("business_name").notNull(),
  address: text("address"),
  phone: text("phone"),
  country: text("country").default("US"),
  keywords: text("keywords").array(),
  status: text("status").default("active"),
  lastRunAt: timestamp("last_run_at"),
  citationsFound: integer("citations_found").default(0),
  opportunitiesFound: integer("opportunities_found").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const citations = pgTable("citations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campaignId: integer("campaign_id").notNull(),
  siteName: text("site_name").notNull(),
  siteUrl: text("site_url"),
  listingUrl: text("listing_url"),
  isFound: boolean("is_found").default(false),
  napConsistent: boolean("nap_consistent"),
  category: text("category"),
  domainAuthority: integer("domain_authority"),
  lastChecked: timestamp("last_checked"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const locationAnalytics = pgTable("location_analytics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  locationId: integer("location_id").notNull(),
  date: text("date").notNull(),
  searchViews: integer("search_views").default(0),
  mapsViews: integer("maps_views").default(0),
  searchMobileViews: integer("search_mobile_views").default(0),
  searchDesktopViews: integer("search_desktop_views").default(0),
  mapsMobileViews: integer("maps_mobile_views").default(0),
  mapsDesktopViews: integer("maps_desktop_views").default(0),
  siteVisits: integer("site_visits").default(0),
  directionRequests: integer("direction_requests").default(0),
  phoneCalls: integer("phone_calls").default(0),
  messaging: integer("messaging").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLocationAnalyticsSchema = createInsertSchema(locationAnalytics).omit({ createdAt: true });
export type LocationAnalytics = typeof locationAnalytics.$inferSelect;
export type InsertLocationAnalytics = z.infer<typeof insertLocationAnalyticsSchema>;

export const insertBusinessLocationSchema = createInsertSchema(businessLocations).omit({ createdAt: true, updatedAt: true });
export const insertCitationCampaignSchema = createInsertSchema(citationCampaigns).omit({ createdAt: true });
export const insertCitationSchema = createInsertSchema(citations).omit({ createdAt: true });

export type BusinessLocation = typeof businessLocations.$inferSelect;
export type InsertBusinessLocation = z.infer<typeof insertBusinessLocationSchema>;
export type CitationCampaign = typeof citationCampaigns.$inferSelect;
export type InsertCitationCampaign = z.infer<typeof insertCitationCampaignSchema>;
export type Citation = typeof citations.$inferSelect;
export type InsertCitation = z.infer<typeof insertCitationSchema>;

export const stateGuides = pgTable("state_guides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stateCode: text("state_code").notNull().unique(),
  stateName: text("state_name").notNull(),
  sosName: text("sos_name").notNull(),
  sosUrl: text("sos_url").notNull(),
  entityTypes: text("entity_types").array(),
  licensingBoardName: text("licensing_board_name"),
  licensingBoardUrl: text("licensing_board_url"),
  licensingRequired: boolean("licensing_required").default(true),
  licensingNotes: text("licensing_notes"),
  workersCompType: text("workers_comp_type"),
  workersCompAgency: text("workers_comp_agency"),
  workersCompUrl: text("workers_comp_url"),
  taxBoardName: text("tax_board_name"),
  taxBoardUrl: text("tax_board_url"),
  salesTaxOnLabor: boolean("sales_tax_on_labor").default(false),
  bAndOTax: boolean("b_and_o_tax").default(false),
  bondRequired: boolean("bond_required").default(false),
  gcBondAmount: text("gc_bond_amount"),
  specialtyBondAmount: text("specialty_bond_amount"),
  insuranceNotes: text("insurance_notes"),
  payrollNotes: text("payroll_notes"),
  overview: text("overview"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stateGuideSteps = pgTable("state_guide_steps", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stateGuideId: integer("state_guide_id").notNull(),
  stepNumber: integer("step_number").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  url: text("url"),
  urlLabel: text("url_label"),
  category: text("category").notNull(),
  isRequired: boolean("is_required").default(true),
  tips: text("tips"),
});

export const masterClassModules = pgTable("master_class_modules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  category: text("category").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").default(true),
  features: text("features").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const coursePurchases = pgTable("course_purchases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  moduleId: integer("module_id"),
  isBundle: boolean("is_bundle").default(false),
  stripeSessionId: text("stripe_session_id"),
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
});

export const servicePurchases = pgTable("service_purchases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  serviceType: text("service_type").notNull(),
  serviceName: text("service_name").notNull(),
  price: integer("price").notNull(),
  stripeSessionId: text("stripe_session_id"),
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
});

export const trackedDomains = pgTable("tracked_domains", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  domain: text("domain").notNull(),
  trackingId: text("tracking_id").notNull().unique(),
  name: text("name"),
  isActive: boolean("is_active").notNull().default(true),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clickVisits = pgTable("click_visits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer("domain_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  screenResolution: text("screen_resolution"),
  language: text("language"),
  timezone: text("timezone"),
  referrer: text("referrer"),
  landingPage: text("landing_page"),
  country: text("country"),
  city: text("city"),
  isSuspicious: boolean("is_suspicious").notNull().default(false),
  suspicionReasons: jsonb("suspicion_reasons"),
  fingerprint: text("fingerprint"),
  visitedAt: timestamp("visited_at").notNull().defaultNow(),
});

export const blockedIps = pgTable("blocked_ips", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer("domain_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  reason: text("reason"),
  blockedAt: timestamp("blocked_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  source: text("source").notNull().default("manual"),
});

export const vpnVisits = pgTable("vpn_visits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer("domain_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  fingerprint: text("fingerprint"),
  browser: text("browser"),
  os: text("os"),
  deviceType: text("device_type"),
  country: text("country"),
  city: text("city"),
  referrer: text("referrer"),
  landingPage: text("landing_page"),
  vpnProvider: text("vpn_provider"),
  detectionMethod: text("detection_method").notNull(),
  action: text("action").notNull().default("blocked"),
  visitedAt: timestamp("visited_at").notNull().defaultNow(),
});

export const adSpyKeywords = pgTable("ad_spy_keywords", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  keyword: text("keyword").notNull(),
  location: text("location").notNull(),
  device: text("device").notNull().default("mobile"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adSpyResults = pgTable("ad_spy_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  keywordId: integer("keyword_id").notNull(),
  advertiserName: text("advertiser_name").notNull(),
  advertiserDomain: text("advertiser_domain"),
  adHeadline: text("ad_headline"),
  adDescription: text("ad_description"),
  displayUrl: text("display_url"),
  position: integer("position"),
  device: text("device"),
  seenAt: timestamp("seen_at").notNull().defaultNow(),
});

export const insertAdSpyKeywordSchema = createInsertSchema(adSpyKeywords).omit({ createdAt: true });
export const insertAdSpyResultSchema = createInsertSchema(adSpyResults).omit({ seenAt: true });
export type AdSpyKeyword = typeof adSpyKeywords.$inferSelect;
export type InsertAdSpyKeyword = z.infer<typeof insertAdSpyKeywordSchema>;
export type AdSpyResult = typeof adSpyResults.$inferSelect;
export type InsertAdSpyResult = z.infer<typeof insertAdSpyResultSchema>;

export const seoContracts = pgTable("seo_contracts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  email: text("email").notNull(),
  signerName: text("signer_name"),
  companyName: text("company_name"),
  token: text("token").notNull().unique(),
  packageId: text("package_id").notNull(),
  packageName: text("package_name").notNull(),
  monthlyPrice: integer("monthly_price").notNull(),
  totalPrice: integer("total_price").notNull(),
  termMonths: integer("term_months").notNull().default(6),
  status: text("status").notNull().default("pending"),
  signedAt: timestamp("signed_at"),
  signatureData: text("signature_data"),
  signerIp: text("signer_ip"),
  stripeSessionId: text("stripe_session_id"),
  contractHtml: text("contract_html"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertSeoContractSchema = createInsertSchema(seoContracts).omit({ createdAt: true });
export type SeoContract = typeof seoContracts.$inferSelect;
export type InsertSeoContract = z.infer<typeof insertSeoContractSchema>;

export const reviewRequests = pgTable("review_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  clientPhone: text("client_phone"),
  clientAddress: text("client_address"),
  companyName: text("company_name"),
  googleProfileUrl: text("google_profile_url").notNull(),
  projectDescription: text("project_description"),
  personalMessage: text("personal_message"),
  photos: jsonb("photos").notNull().default([]),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("sent"),
  feedbackRating: integer("feedback_rating"),
  feedbackCategories: jsonb("feedback_categories"),
  feedbackComments: text("feedback_comments"),
  reviewSubmitted: boolean("review_submitted").notNull().default(false),
  referralOptIn: boolean("referral_opt_in").notNull().default(false),
  referralFeedback: text("referral_feedback"),
  remindersSent: integer("reminders_sent").notNull().default(0),
  lastReminderAt: timestamp("last_reminder_at"),
  nextReminderAt: timestamp("next_reminder_at"),
  emailTheme: text("email_theme").notNull().default("navy-orange"),
  bccEmail: text("bcc_email"),
  emailOpened: boolean("email_opened").notNull().default(false),
  emailOpenedAt: timestamp("email_opened_at"),
  linkClicked: boolean("link_clicked").notNull().default(false),
  linkClickedAt: timestamp("link_clicked_at"),
  photosDownloaded: boolean("photos_downloaded").notNull().default(false),
  photosDownloadedAt: timestamp("photos_downloaded_at"),
  reviewMethod: text("review_method"),
  lastStep: text("last_step"),
  deletedAt: timestamp("deleted_at"),
  unsubscribed: boolean("unsubscribed").notNull().default(false),
  scheduledFor: timestamp("scheduled_for"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reviewReminderSettings = pgTable("review_reminder_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  maxReminders: integer("max_reminders").notNull().default(3),
  intervalHours: integer("interval_hours").notNull().default(48),
  timeWindows: jsonb("time_windows").notNull().default([
    { start: 9, end: 12 },
    { start: 15, end: 18 },
    { start: 18, end: 21 }
  ]),
  timezone: text("timezone").notNull().default("America/New_York"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertReminderSettingsSchema = createInsertSchema(reviewReminderSettings).omit({ updatedAt: true });
export type ReviewReminderSettings = typeof reviewReminderSettings.$inferSelect;
export type InsertReminderSettings = z.infer<typeof insertReminderSettingsSchema>;

export const reviewTemplates = pgTable("review_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  googleProfileUrl: text("google_profile_url").notNull(),
  projectDescription: text("project_description"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReviewTemplateSchema = createInsertSchema(reviewTemplates).omit({ createdAt: true });
export type ReviewTemplate = typeof reviewTemplates.$inferSelect;
export type InsertReviewTemplate = z.infer<typeof insertReviewTemplateSchema>;

export const insertReviewRequestSchema = createInsertSchema(reviewRequests).omit({ createdAt: true });
export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;

export const insertStateGuideSchema = createInsertSchema(stateGuides).omit({ createdAt: true });
export const insertStateGuideStepSchema = createInsertSchema(stateGuideSteps).omit({});
export const insertMasterClassModuleSchema = createInsertSchema(masterClassModules).omit({ createdAt: true });
export const insertCoursePurchaseSchema = createInsertSchema(coursePurchases).omit({ purchasedAt: true });
export const insertServicePurchaseSchema = createInsertSchema(servicePurchases).omit({ purchasedAt: true });
export const insertTrackedDomainSchema = createInsertSchema(trackedDomains).omit({ createdAt: true });
export const insertClickVisitSchema = createInsertSchema(clickVisits).omit({ visitedAt: true });
export const insertBlockedIpSchema = createInsertSchema(blockedIps).omit({ blockedAt: true });
export const insertVpnVisitSchema = createInsertSchema(vpnVisits).omit({ visitedAt: true });

export const betaAccessCodes = pgTable("beta_access_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  createdByUserId: integer("created_by_user_id").notNull(),
  redeemedByUserId: integer("redeemed_by_user_id"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  trialDays: integer("trial_days").notNull().default(2),
  expiresAt: timestamp("expires_at").notNull(),
  redeemedAt: timestamp("redeemed_at"),
  revoked: boolean("revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBetaAccessCodeSchema = createInsertSchema(betaAccessCodes).omit({ createdAt: true });
export type BetaAccessCode = typeof betaAccessCodes.$inferSelect;
export type InsertBetaAccessCode = z.infer<typeof insertBetaAccessCodeSchema>;

export const googleProfileReviews = pgTable("google_profile_reviews", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  locationId: integer("location_id"),
  templateId: integer("template_id"),
  googleReviewId: text("google_review_id"),
  reviewerName: text("reviewer_name").notNull(),
  reviewerPhotoUrl: text("reviewer_photo_url"),
  reviewerProfileUrl: text("reviewer_profile_url"),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  reviewDate: timestamp("review_date").notNull(),
  replyComment: text("reply_comment"),
  replyDate: timestamp("reply_date"),
  internalNote: text("internal_note"),
  isNew: boolean("is_new").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGoogleProfileReviewSchema = createInsertSchema(googleProfileReviews).omit({ createdAt: true, updatedAt: true });
export type GoogleProfileReview = typeof googleProfileReviews.$inferSelect;
export type InsertGoogleProfileReview = z.infer<typeof insertGoogleProfileReviewSchema>;

export type StateGuide = typeof stateGuides.$inferSelect;
export type InsertStateGuide = z.infer<typeof insertStateGuideSchema>;
export type StateGuideStep = typeof stateGuideSteps.$inferSelect;
export type InsertStateGuideStep = z.infer<typeof insertStateGuideStepSchema>;
export type MasterClassModule = typeof masterClassModules.$inferSelect;
export type InsertMasterClassModule = z.infer<typeof insertMasterClassModuleSchema>;
export type CoursePurchase = typeof coursePurchases.$inferSelect;
export type InsertCoursePurchase = z.infer<typeof insertCoursePurchaseSchema>;
export type ServicePurchase = typeof servicePurchases.$inferSelect;
export type InsertServicePurchase = z.infer<typeof insertServicePurchaseSchema>;
export type TrackedDomain = typeof trackedDomains.$inferSelect;
export type InsertTrackedDomain = z.infer<typeof insertTrackedDomainSchema>;
export type ClickVisit = typeof clickVisits.$inferSelect;
export type InsertClickVisit = z.infer<typeof insertClickVisitSchema>;
export type BlockedIp = typeof blockedIps.$inferSelect;
export type InsertBlockedIp = z.infer<typeof insertBlockedIpSchema>;
export type VpnVisit = typeof vpnVisits.$inferSelect;
export type InsertVpnVisit = z.infer<typeof insertVpnVisitSchema>;

export const mediaFolders = pgTable("media_folders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  clientAddress: text("client_address"),
  lat: real("lat"),
  lon: real("lon"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMediaFolderSchema = createInsertSchema(mediaFolders).omit({ createdAt: true });
export type MediaFolder = typeof mediaFolders.$inferSelect;
export type InsertMediaFolder = z.infer<typeof insertMediaFolderSchema>;

export const mediaPhotos = pgTable("media_photos", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  folderId: integer("folder_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  r2Key: text("r2_key"),
  size: integer("size"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMediaPhotoSchema = createInsertSchema(mediaPhotos).omit({ createdAt: true });
export type MediaPhoto = typeof mediaPhotos.$inferSelect;
export type InsertMediaPhoto = z.infer<typeof insertMediaPhotoSchema>;

// ── LSA Manager — admin-centric central account management ───────────────────
// One Google Ads manager (MCC) connection controlled by admins, used to invite
// and centrally manage child accounts, view their leads, and dispute them from
// an admin console. Distinct from the per-user multi-tenant system below; its
// tables are prefixed lsa_manager_* to avoid clashing with the tenant tables.
export const lsaManagerConnection = pgTable("lsa_manager_connection", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  managerId: text("manager_id").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  tokenExpiry: timestamp("token_expiry"),
  developerToken: text("developer_token"),
  status: text("status").notNull().default("active"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  lastRefreshedAt: timestamp("last_refreshed_at"),
});

export const lsaManagerAccounts = pgTable("lsa_manager_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  customerId: text("customer_id").notNull().unique(),
  accountName: text("account_name"),
  userId: integer("user_id"),
  linkType: text("link_type").notNull().default("self"),
  linkStatus: text("link_status").notNull().default("active"),
  isLsaEnrolled: boolean("is_lsa_enrolled").default(false),
  currency: text("currency"),
  timezone: text("timezone"),
  leadCount: integer("lead_count").notNull().default(0),
  totalSpend: text("total_spend"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const lsaManagerInvitations = pgTable("lsa_manager_invitations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  targetCustomerId: text("target_customer_id").notNull(),
  accountName: text("account_name"),
  status: text("status").notNull().default("pending"),
  createdByAdminId: integer("created_by_admin_id").notNull(),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  notes: text("notes"),
  googleInvitationResourceName: text("google_invitation_resource_name"),
});

export const lsaManagerLeads = pgTable("lsa_manager_leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull(),
  googleLeadId: text("google_lead_id").notNull().unique(),
  leadType: text("lead_type"),
  status: text("status").notNull().default("new"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  serviceRequested: text("service_requested"),
  charged: boolean("charged").notNull().default(false),
  chargeAmount: text("charge_amount"),
  disputed: boolean("disputed").notNull().default(false),
  disputeReason: text("dispute_reason"),
  disputedAt: timestamp("disputed_at"),
  disputedByAdminId: integer("disputed_by_admin_id"),
  leadCreatedAt: timestamp("lead_created_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adminAuditLog = pgTable("admin_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorEmail: text("actor_email").notNull(),
  actorId: integer("actor_id").notNull(),
  action: text("action").notNull(),
  targetCustomerId: text("target_customer_id"),
  targetAccountName: text("target_account_name"),
  parameters: jsonb("parameters"),
  result: text("result").notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLsaManagerConnectionSchema = createInsertSchema(lsaManagerConnection).omit({ connectedAt: true });
export const insertLsaManagerAccountSchema = createInsertSchema(lsaManagerAccounts).omit({ createdAt: true, updatedAt: true });
export const insertLsaManagerInvitationSchema = createInsertSchema(lsaManagerInvitations).omit({ invitedAt: true });
export const insertLsaManagerLeadSchema = createInsertSchema(lsaManagerLeads).omit({ createdAt: true });
export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLog).omit({ createdAt: true });

export type LsaManagerConnection = typeof lsaManagerConnection.$inferSelect;
export type InsertLsaManagerConnection = z.infer<typeof insertLsaManagerConnectionSchema>;
export type LsaManagerAccount = typeof lsaManagerAccounts.$inferSelect;
export type InsertLsaManagerAccount = z.infer<typeof insertLsaManagerAccountSchema>;
export type LsaManagerInvitation = typeof lsaManagerInvitations.$inferSelect;
export type InsertLsaManagerInvitation = z.infer<typeof insertLsaManagerInvitationSchema>;
export type LsaManagerLead = typeof lsaManagerLeads.$inferSelect;
export type InsertLsaManagerLead = z.infer<typeof insertLsaManagerLeadSchema>;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;

// ── Google Local Services Ads (LSA) — multi-tenant lead system ───────────────
// One Google Ads connection per ConstructHUB user. Each user OAuth-connects
// their own Google Ads account, we discover every LSA account they can reach,
// import leads per-account, DM them on new leads via Telegram, and let them
// manually dispute charged leads. Tenancy is enforced by user_id on every row.

// Per-user Google Ads OAuth connection (refresh token + Telegram link).
export const lsaConnections = pgTable("lsa_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().unique(),
  refreshToken: text("refresh_token"),
  loginCustomerId: text("login_customer_id"),
  connectedEmail: text("connected_email"),
  // Telegram: username is what the user typed (display only); chatId is captured
  // from the bot /start deep-link and is what we actually DM. linkToken is the
  // one-time token embedded in the deep link.
  telegramUsername: text("telegram_username"),
  telegramChatId: text("telegram_chat_id"),
  telegramLinkToken: text("telegram_link_token"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  lastSyncCount: integer("last_sync_count").default(0),
  lastCostTotal: numeric("last_cost_total", { precision: 12, scale: 2 }),
  lastDiscoveryAt: timestamp("last_discovery_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Registry of every Google Ads account reachable through a connection. Scales
// to thousands of rows per user; the sync scheduler rotates through them.
export const lsaAccounts = pgTable("lsa_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull(),
  connectionId: varchar("connection_id").notNull(),
  customerId: text("customer_id").notNull(),
  loginCustomerId: text("login_customer_id"),
  descriptiveName: text("descriptive_name"),
  isManager: boolean("is_manager").default(false),
  // null = not yet probed; true/false set during sync when the lead query
  // succeeds/fails. Enrolled accounts are synced more often than the rest.
  lsaEnrolled: boolean("lsa_enrolled"),
  enabled: boolean("enabled").notNull().default(true),
  // Per-account incremental cursor: the latest lead creation time we've pulled.
  syncCursor: timestamp("sync_cursor"),
  lastError: text("last_error"),
  lastSyncAt: timestamp("last_sync_at"),
  leadCount: integer("lead_count").default(0),
  chargedCount: integer("charged_count").default(0),
  disputedCount: integer("disputed_count").default(0),
  costTotal: numeric("cost_total", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Imported LSA leads (phone-call, message, booking). lead_id is globally unique
// (Google ids are opaque & global) and is the upsert conflict target; user_id +
// customer_id scope every read/write for tenant isolation.
export const lsaLeads = pgTable("lsa_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id"),
  leadId: text("lead_id").notNull().unique(),
  customerId: text("customer_id"),
  leadType: text("lead_type"),
  categoryId: text("category_id"),
  serviceId: text("service_id"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  leadStatus: text("lead_status"),
  leadCharged: boolean("lead_charged"),
  leadCost: numeric("lead_cost", { precision: 10, scale: 2 }),
  // Synced authoritatively from Google: feedbackSubmitted & creditState. What WE
  // sent (Google doesn't echo it back): surveyAnswer & disputeReason.
  feedbackSubmitted: boolean("feedback_submitted"),
  surveyAnswer: text("survey_answer"),
  disputeReason: text("dispute_reason"),
  creditState: text("credit_state"),
  // Local dispute pipeline state (NOT from Google): null | scheduled | queued |
  // sending | disputed | failed. Preserved across syncs; stops double disputes.
  disputeStatus: text("dispute_status"),
  disputeScheduledAt: timestamp("dispute_scheduled_at"),
  // Telegram message_id of the new-lead alert, so a reply maps back to the lead.
  tgAlertMessageId: text("tg_alert_message_id"),
  leadCreationTime: timestamp("lead_creation_time"),
  rawJson: jsonb("raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLsaConnectionSchema = createInsertSchema(lsaConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type LsaConnection = typeof lsaConnections.$inferSelect;
export type InsertLsaConnection = z.infer<typeof insertLsaConnectionSchema>;

export const insertLsaAccountSchema = createInsertSchema(lsaAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type LsaAccount = typeof lsaAccounts.$inferSelect;
export type InsertLsaAccount = z.infer<typeof insertLsaAccountSchema>;

export const insertLsaLeadSchema = createInsertSchema(lsaLeads).omit({ id: true, createdAt: true });
export type LsaLead = typeof lsaLeads.$inferSelect;
export type InsertLsaLead = z.infer<typeof insertLsaLeadSchema>;

// Valid Google "dissatisfied" dispute reasons (nested under surveyDissatisfied).
export const LSA_DISPUTE_REASONS = [
  "DUPLICATE",
  "GEO_MISMATCH",
  "JOB_TYPE_MISMATCH",
  "NOT_READY_TO_BOOK",
  "SOLICITATION",
  "SPAM",
] as const;
export type LsaDisputeReason = (typeof LSA_DISPUTE_REASONS)[number];

// ── CRM: organizations, membership, roles & invitations ─────────────────────
// The tenancy layer for the ConstructHUB CRM. Everything CRM-side is scoped by
// org_id, NOT user_id: a construction company has crews, and the office staff,
// field techs and owner must all see the same jobs. (The rest of ConstructHUB
// predates this and stays user_id-scoped; the two models coexist deliberately —
// see server/crm/tenancy.ts for the get-or-create bridge.)
//
// Convention note: matches the existing codebase — varchar uuid PKs, no foreign
// keys, no drizzle relations(); joins are written explicitly in query code.

// A construction company. Also carries the company profile that appears on
// estimates, invoices and contracts (modelled on what a contractor actually
// needs on a printed document: license number, legal entity, terms, warranty).
export const crmOrgs = pgTable("crm_orgs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalEntityName: text("legal_entity_name"),
  ownerUserId: integer("owner_user_id").notNull(),
  // Contact / branding
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  logoUrl: text("logo_url"),
  // Address
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country").default("US"),
  timezone: text("timezone").default("America/Los_Angeles"),
  // Trade/compliance. licenseState matters because deposit caps are per-state
  // (see analysis/hcp-crawl — CA/NV/MD/MA/PA/NY cap contractor deposits).
  licenseNumber: text("license_number"),
  licenseState: text("license_state"),
  industry: text("industry").default("Construction & Remodeling"),
  description: text("description"),
  // Document defaults
  invoiceFooter: text("invoice_footer"),
  estimateFooter: text("estimate_footer"),
  termsAndConditions: text("terms_and_conditions"),
  warrantyText: text("warranty_text"),
  // Money defaults (integer cents / basis points — never floats in billing)
  defaultDepositBps: integer("default_deposit_bps").default(0),
  // Org-wide fallback sales-tax rate (basis points). City → division → org
  // resolution lives in server/crm/tax.ts; null means "no org default".
  defaultTaxRateBps: integer("default_tax_rate_bps"),
  currency: text("currency").default("usd"),
  // Set when the owner finishes (or dismisses) the setup checklist, so the
  // portal stops routing them back into onboarding.
  onboardingDismissedAt: timestamp("onboarding_dismissed_at"),
  // Org-level custom fields — every other crm_* entity already has this;
  // used e.g. by the HCP importer to preserve team + lead-source reference
  // data without fabricating user accounts.
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Membership of a user in an org, with role + per-seat overrides. A user may
// belong to several orgs (a bookkeeper serving multiple contractors); the
// active one is held in the session.
export const crmMembers = pgTable("crm_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: integer("user_id"),          // null while an invitation is pending
  email: text("email").notNull(),      // stable identity before the user exists
  role: text("role").notNull().default("field"),
  status: text("status").notNull().default("active"), // active | invited | disabled
  // Display / dispatch
  displayName: text("display_name"),
  title: text("title"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  calendarColor: text("calendar_color"),
  // Job costing: what this person costs us per hour, in cents. Kept on the
  // membership (not the user) because the same person can cost different
  // amounts to different orgs.
  hourlyCostCents: integer("hourly_cost_cents"),
  // Division scoping: null = all divisions. A member pinned to a division (and
  // not the owner) sees only that division's work in list endpoints.
  divisionId: varchar("division_id"),
  // Sparse overrides on top of the role defaults; see CRM_PERMISSIONS.
  permissions: jsonb("permissions"),
  lastActiveAt: timestamp("last_active_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Pending invitations. Token is single-use; accepting binds the row in
// crm_members to the accepting user's id.
export const crmInvitations = pgTable("crm_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("field"),
  permissions: jsonb("permissions"),
  // Pre-assign the division the invitee will be scoped to on accept.
  divisionId: varchar("division_id"),
  token: text("token").notNull().unique(),
  invitedByUserId: integer("invited_by_user_id"),
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmOrgSchema = createInsertSchema(crmOrgs).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmOrg = typeof crmOrgs.$inferSelect;
export type InsertCrmOrg = z.infer<typeof insertCrmOrgSchema>;

export const insertCrmMemberSchema = createInsertSchema(crmMembers).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmMember = typeof crmMembers.$inferSelect;
export type InsertCrmMember = z.infer<typeof insertCrmMemberSchema>;

export const insertCrmInvitationSchema = createInsertSchema(crmInvitations).omit({ id: true, createdAt: true });
export type CrmInvitation = typeof crmInvitations.$inferSelect;
export type InsertCrmInvitation = z.infer<typeof insertCrmInvitationSchema>;

// Platform beta invites (admin-issued, NOT org-scoped): one email, one
// single-use token. Raw tokens never hit the database — only their SHA-256,
// same convention as the client portal's magic links. Accepting one stamps
// users.beta_at, which unlocks unlimited CRM seats (server/crm/tenancy.ts).
export const crmBetaInvites = pgTable("crm_beta_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedByUserId: integer("invited_by_user_id"),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmBetaInvite = typeof crmBetaInvites.$inferSelect;

// ── Divisions: one company, several operating arms ─────────────────────────
// The owner runs two divisions of one company (e.g. WA headquarters + FL).
// A division carries its own branding — address, license, contact — because an
// estimate for Florida work must never go out with the WA HQ address on it.
// Projects are assigned to a division; estimates/invoices resolve their
// branding through their project, falling back to the org when none is set.
export const crmDivisions = pgTable("crm_divisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),          // short tag: "WA", "FL"
  // Contact — nullable, falls back to the org's when absent.
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  // Branding address — what prints on estimates and invoices.
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  // Per-state licensing (a FL license is not the WA one).
  licenseNumber: text("license_number"),
  licenseState: text("license_state"),
  isHeadquarters: boolean("is_headquarters").notNull().default(false),
  // Per-division settings bag. Holds taxRates — { default: bps, cities:
  // { CityName: bps } } — the per-division sales-tax override map resolved by
  // server/crm/tax.ts.
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmDivisionSchema = createInsertSchema(crmDivisions).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmDivision = typeof crmDivisions.$inferSelect;
export type InsertCrmDivision = z.infer<typeof insertCrmDivisionSchema>;

// ── Homeowner client portal (client.constructhub.*) ─────────────────────────
// Magic-link sign-in for the contractor's end customers. Raw tokens never hit
// the database — only their SHA-256. A token is single-use and trades for a
// 30-day sliding session. customerIds snapshots EVERY crm_customers row
// (across orgs) matching the email, so one sign-in shows all of a homeowner's
// contractors.

export const crmClientTokens = pgTable("crm_client_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull().unique(),
  customerIds: jsonb("customer_ids").$type<string[]>().notNull(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmClientSessions = pgTable("crm_client_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull().unique(),
  customerIds: jsonb("customer_ids").$type<string[]>().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
});

export type CrmClientToken = typeof crmClientTokens.$inferSelect;
export type CrmClientSession = typeof crmClientSessions.$inferSelect;

// ── CRM attachments (client portal v2) ──────────────────────────────────────
// One table for every file that moves between a contractor and their client:
// org-level pamphlets (brochures, warranties — refId null), files pinned to a
// sent estimate (refId = estimate id), and photos the homeowner uploads from
// the portal (refId = customer id). storagePath is a server-local key, NEVER a
// public path — every read goes through a session-gated download route.
export const CRM_ATTACHMENT_KINDS = ["pamphlet", "estimate", "photo", "measurement"] as const;
export type CrmAttachmentKind = (typeof CRM_ATTACHMENT_KINDS)[number];

export const crmAttachments = pgTable("crm_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  kind: text("kind").notNull(),
  refId: varchar("ref_id"),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmAttachment = typeof crmAttachments.$inferSelect;

// ── Client comments (client portal v2) ──────────────────────────────────────
// Notes a homeowner sends their contractor from the portal ("Questions?").
// readAt is the contractor-side mark-read; null means unread.
export const crmClientComments = pgTable("crm_client_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  readAt: timestamp("read_at"),
});

export type CrmClientComment = typeof crmClientComments.$inferSelect;

// ── Client 360: contractor notes + financing click log ──────────────────────
// crm_customer_notes: contractor-side notes on a client (never shown in the
// portal). authorMemberId is nullable — imported/system notes have no author;
// edit/delete is own-note, or any note for owner/admin (server/crm/notes-timeline.ts).
export const crmCustomerNotes = pgTable("crm_customer_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  authorMemberId: varchar("author_member_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmCustomerNote = typeof crmCustomerNotes.$inferSelect;

// crm_activity_log: the org-wide accountability feed (HCP-style "who did
// what, when"). One row per meaningful mutation — sign-ins, document and
// client writes, team changes, exports. actor_label is a snapshot (member
// display name, 'client' or 'system') so the row stays truthful after the
// member is renamed or removed. meta carries field names/amounts only —
// NEVER passwords, tokens or secrets.
export const crmActivityLog = pgTable("crm_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  actorMemberId: varchar("actor_member_id"),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(), // 'login', 'estimate.created', 'payment.recorded', …
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  customerId: varchar("customer_id"), // the client the action relates to, when any
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmActivityLogRow = typeof crmActivityLog.$inferSelect;

// crm_finance_clicks: a homeowner tapped a financing link in the client
// portal. Recorded BEFORE the link opens so the contractor sees "applied for
// financing via <label>" on the client timeline even when the lender's site
// never calls back.
export const crmFinanceClicks = pgTable("crm_finance_clicks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmFinanceClick = typeof crmFinanceClicks.$inferSelect;

// ── Roles & permissions ─────────────────────────────────────────────────────
// Housecall Pro ships three fixed roles and no custom fields; we ship six
// construction-shaped roles PLUS per-seat overrides, because a lead carpenter
// who can approve change orders but not see company reporting is a real and
// common case that fixed roles cannot express.

export const CRM_ROLES = ["owner", "admin", "pm", "office", "field", "subcontractor"] as const;
export type CrmRole = (typeof CRM_ROLES)[number];

export const CRM_PERMISSIONS = [
  "viewAllJobs",        // false ⇒ only jobs this member is assigned to
  "manageJobs",
  "manageCustomers",
  "manageEstimates",
  "manageInvoices",
  "takePayment",
  "seePrices",          // field crews are often deliberately price-blind
  "seeCosts",           // cost/margin is stricter than price
  "approveChangeOrders",
  "managePriceBook",
  "manageTeam",
  "manageSettings",
  "seeReporting",
  "manageIntegrations",
  "exportData",         // bulk client export (CSV) — owner by default, grantable per seat
] as const;
export type CrmPermission = (typeof CRM_PERMISSIONS)[number];
export type CrmPermissionSet = Partial<Record<CrmPermission, boolean>>;

const ALL: CrmPermissionSet = Object.fromEntries(CRM_PERMISSIONS.map((p) => [p, true]));

// Defaults per role. A membership's `permissions` jsonb overrides these keys.
export const CRM_ROLE_DEFAULTS: Record<CrmRole, CrmPermissionSet> = {
  owner: { ...ALL },
  admin: { ...ALL, manageIntegrations: false, exportData: false },
  // Project manager: office-like reach across the whole book of work (all
  // jobs, estimates and customers — they coordinate the work), but cost-blind:
  // sees scopes and their prices, never costs or margins. The back office
  // (team/settings/integrations) stays off.
  pm: {
    viewAllJobs: true, manageJobs: true, manageCustomers: true, manageEstimates: true,
    manageInvoices: true, takePayment: true, seePrices: true, seeCosts: false,
    approveChangeOrders: false, managePriceBook: false, manageTeam: false,
    manageSettings: false, seeReporting: true, manageIntegrations: false,
  },
  office: {
    viewAllJobs: true, manageJobs: true, manageCustomers: true, manageEstimates: true,
    manageInvoices: true, takePayment: true, seePrices: true, seeCosts: false,
    approveChangeOrders: false, managePriceBook: false, manageTeam: false,
    manageSettings: false, seeReporting: true, manageIntegrations: false,
  },
  field: {
    viewAllJobs: false, manageJobs: false, manageCustomers: false, manageEstimates: false,
    manageInvoices: false, takePayment: false, seePrices: false, seeCosts: false,
    approveChangeOrders: false, managePriceBook: false, manageTeam: false,
    manageSettings: false, seeReporting: false, manageIntegrations: false,
  },
  // Deliberately its own role rather than "a customer with a flag" — modelling
  // subs as customers is exactly the mistake Housecall Pro makes.
  subcontractor: {
    viewAllJobs: false, manageJobs: false, manageCustomers: false, manageEstimates: false,
    manageInvoices: false, takePayment: false, seePrices: false, seeCosts: false,
    approveChangeOrders: false, managePriceBook: false, manageTeam: false,
    manageSettings: false, seeReporting: false, manageIntegrations: false,
  },
};

/** Effective permissions for a membership: role defaults + sparse overrides. */
export function crmEffectivePermissions(
  role: string | null | undefined,
  overrides?: unknown,
): Record<CrmPermission, boolean> {
  const base = CRM_ROLE_DEFAULTS[(role as CrmRole)] ?? CRM_ROLE_DEFAULTS.field;
  const out = {} as Record<CrmPermission, boolean>;
  for (const p of CRM_PERMISSIONS) out[p] = base[p] === true;
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if ((CRM_PERMISSIONS as readonly string[]).includes(k) && typeof v === "boolean") {
        out[k as CrmPermission] = v;
      }
    }
  }
  return out;
}

// ── Notification preferences ────────────────────────────────────────────────
// Per-org on/off switches for the transactional emails the CRM sends to the
// contractor (client-facing sends are never gated — the client asked for that
// mail by receiving an estimate). Stored in crm_orgs.custom_fields->
// 'notificationPrefs'; absent key means ON, so existing orgs keep today's
// behaviour until they explicitly turn one off.
export const CRM_NOTIFICATION_PREFS = [
  "estimateViewed",    // client opened an estimate for the first time
  "estimateApproved",  // client approved an estimate
  "estimateDeclined",  // client declined an estimate
  "invoicePaid",       // an online payment landed
  "paymentReceived",   // a manual/offline payment was recorded on an invoice
  "paymentReceipt",    // the client gets a receipt-to-date email after any payment
  "jobApproved",       // PM notice: an estimate was approved (job awarded)
  "clientComments",    // a homeowner sent a note from the client portal
  "financeClick",      // a homeowner tapped a financing link in the client portal
  // Owner-level "runs a tight ship" coverage (server/crm/owner-notify.ts).
  "estimateSent",        // a team member sent a bid to a client
  "memberLogin",         // a team member signed in
  "memberAccountChange", // a team member changed their own profile or password
  "leadReceived",        // a lead came in through the website lead form
] as const;
export type CrmNotificationPref = (typeof CRM_NOTIFICATION_PREFS)[number];

/** Default ON; only an explicit `false` silences a notification. */
export function crmNotificationEnabled(customFields: unknown, pref: CrmNotificationPref): boolean {
  const prefs = (customFields as Record<string, unknown> | null | undefined)?.notificationPrefs;
  if (!prefs || typeof prefs !== "object") return true;
  return (prefs as Record<string, unknown>)[pref] !== false;
}

// ── CRM: customers, projects, jobs, estimates, client portal ────────────────
// Everything here is org-scoped (crm_orgs), never user-scoped.
//
// Object model (analysis/HYBRID-SPEC.md §1): a LEAD IS NOT A JOB (Leap conflates
// them), and a Project sits between Customer and Job so phases/budget have a
// home — Leap admits on camera that their users fake phases with naming
// conventions because they only allow one trade per job.

// ── Canonical status enums. ONE vocabulary per entity, used for storage,
// filtering and display. Housecall Pro ships two (`in progress` in responses,
// `in_progress` in filters) and that produces filters which silently miss rows.
export const CRM_LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export const CRM_PROJECT_STATUSES = [
  "lead", "estimating", "proposal_sent", "approved", "scheduled",
  "in_progress", "waiting_on_trades", "punch_list", "complete", "invoiced", "paid", "cancelled",
] as const;
export const CRM_JOB_STATUSES = [
  "unscheduled", "scheduled", "in_progress", "complete", "cancelled",
] as const;
export const CRM_ESTIMATE_STATUSES = [
  "draft", "sent", "viewed", "approved", "declined", "expired", "cancelled",
] as const;
export const CRM_INVOICE_STATUSES = [
  "draft", "sent", "partial", "paid", "void", "uncollectible",
] as const;
export const CRM_LINE_ITEM_KINDS = ["labor", "material", "equipment", "subcontractor", "fee", "discount"] as const;

export type CrmProjectStatus = (typeof CRM_PROJECT_STATUSES)[number];
export type CrmEstimateStatus = (typeof CRM_ESTIMATE_STATUSES)[number];

// Human labels + board grouping. "waiting_on_trades" and "punch_list" are real
// construction states every Leap customer invents by hand; we ship them.
export const CRM_PROJECT_STAGE_META: Record<string, { label: string; group: string }> = {
  lead:               { label: "Lead",              group: "Prospect" },
  estimating:         { label: "Estimating",        group: "Sales" },
  proposal_sent:      { label: "Proposal Sent",     group: "Sales" },
  approved:           { label: "Approved",          group: "Sales" },
  scheduled:          { label: "Scheduled",         group: "Production" },
  in_progress:        { label: "In Progress",       group: "Production" },
  waiting_on_trades:  { label: "Waiting on Trades", group: "Production" },
  punch_list:         { label: "Punch List",        group: "Production" },
  complete:           { label: "Complete",          group: "Production" },
  invoiced:           { label: "Invoiced",          group: "Billing" },
  paid:               { label: "Paid",              group: "Billing" },
  cancelled:          { label: "Cancelled",         group: "Closed" },
};

export const crmCustomers = pgTable("crm_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  altPhone: text("alt_phone"),
  // Service address
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  // Billing address, when different
  billingSameAsService: boolean("billing_same_as_service").notNull().default(true),
  billingLine1: text("billing_line1"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPostalCode: text("billing_postal_code"),
  leadSourceId: varchar("lead_source_id"),
  ownerMemberId: varchar("owner_member_id"),
  notes: text("notes"),
  tags: text("tags").array(),
  // First-class custom fields on EVERY entity. HCP's own docs say "Housecall Pro
  // is not set up to allow for custom fields" — that is the opening.
  customFields: jsonb("custom_fields"),
  // The client portal is created with the customer, not later. Token is the
  // unguessable key in the estimate email link.
  portalToken: text("portal_token").notNull(),
  portalLastSeenAt: timestamp("portal_last_seen_at"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmProjects = pgTable("crm_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  number: text("number"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("lead"),
  // Site address, when it differs from the customer record
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  trades: text("trades").array(),
  projectManagerMemberId: varchar("project_manager_member_id"),
  salesMemberId: varchar("sales_member_id"),
  // Which division of the company this job belongs to. Drives the branding on
  // its estimates/invoices and division-scoped list visibility.
  divisionId: varchar("division_id"),
  // Money in integer cents, always.
  contractValueCents: integer("contract_value_cents"),
  budgetCents: integer("budget_cents"),
  startDate: timestamp("start_date"),
  targetEndDate: timestamp("target_end_date"),
  completedAt: timestamp("completed_at"),
  // Our moat: the verified permit portal + parcel record for this address.
  permitPortalId: integer("permit_portal_id"),
  permitNumber: text("permit_number"),
  parcelNumber: text("parcel_number"),
  customFields: jsonb("custom_fields"),
  stageChangedAt: timestamp("stage_changed_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// A per-trade scope of work inside a project (roof, siding, gutters).
export const crmJobs = pgTable("crm_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  name: text("name").notNull(),
  trade: text("trade"),
  description: text("description"),
  status: text("status").notNull().default("unscheduled"),
  assignedMemberIds: text("assigned_member_ids").array(),
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmEstimates = pgTable("crm_estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  projectId: varchar("project_id"),
  number: text("number"),
  title: text("title").notNull().default("Estimate"),
  status: text("status").notNull().default("draft"),
  introText: text("intro_text"),
  termsText: text("terms_text"),
  // Totals, integer cents. Recomputed server-side from line items — never trust
  // a client-supplied total.
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  depositCents: integer("deposit_cents"),
  // Send + open tracking. viewedAt is the "you can see it was opened" feature.
  publicToken: text("public_token").notNull(),
  sentAt: timestamp("sent_at"),
  sentToEmail: text("sent_to_email"),
  firstViewedAt: timestamp("first_viewed_at"),
  lastViewedAt: timestamp("last_viewed_at"),
  viewCount: integer("view_count").notNull().default(0),
  approvedAt: timestamp("approved_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: text("decline_reason"),
  signatureName: text("signature_name"),
  signatureIp: text("signature_ip"),
  expiresAt: timestamp("expires_at"),
  createdByMemberId: varchar("created_by_member_id"),
  // Set at approval: the server-recomputed total after any client-selected
  // optional discounts, plus which offers were picked (server/crm/discounts.ts).
  // approvedTotalCents is the number to bill — totalCents stays the quoted one.
  approvedTotalCents: integer("approved_total_cents"),
  selectedDiscounts: jsonb("selected_discounts"),
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Optional, client-selected discount offers on an estimate. The CREATOR picks
// which offers to extend (usually from the presets in server/crm/discounts.ts);
// the client ticks the ones they qualify for on the gated public page, and the
// server re-computes the approved total — a client-supplied total is never
// trusted. percentBps is applied to the taxable base.
export const crmEstimateDiscounts = pgTable("crm_estimate_discounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  estimateId: varchar("estimate_id").notNull(),
  // Preset code (marketing|military|pay_in_full|bundle|price_match) or "custom".
  code: text("code").notNull(),
  label: text("label").notNull(),
  percentBps: integer("percent_bps").notNull(),
  conditions: text("conditions"),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmEstimateItems = pgTable("crm_estimate_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  estimateId: varchar("estimate_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  kind: text("kind").notNull().default("labor"),
  name: text("name").notNull(),
  description: text("description"),
  quantityMilli: integer("quantity_milli").notNull().default(1000), // 1.000 = 1000
  unit: text("unit"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  // Cost is privileged: stripped from responses unless the caller has seeCosts.
  unitCostCents: integer("unit_cost_cents"),
  taxable: boolean("taxable").notNull().default(true),
  // Hidden line items still affect the total but are not shown to the homeowner.
  hiddenFromClient: boolean("hidden_from_client").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Append-only audit of what the client did. Powers "opened at 2:14pm" and the
// approve/decline notification.
export const crmEstimateEvents = pgTable("crm_estimate_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  estimateId: varchar("estimate_id").notNull(),
  type: text("type").notNull(), // created|sent|viewed|approved|declined|reminded
  actor: text("actor"),         // member id, "client", or "system"
  ip: text("ip"),
  userAgent: text("user_agent"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Client engagement sessions on the public estimate/invoice pages — the
 * "did they spend 1 minute or 40" signal. One row per page visit: the page
 * POSTs /start on load, then heartbeats every 15s while visible. Duration is
 * accumulated server-side, capped per ping gap (see portal.ts), so a tab left
 * open overnight does not read as 8 hours of attention. No cookies, no PII
 * beyond the IP/UA the estimate events trail already records.
 */
export const crmEngagementSessions = pgTable("crm_engagement_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  docType: text("doc_type").notNull(), // estimate | invoice
  docId: varchar("doc_id").notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  lastPingAt: timestamp("last_ping_at").defaultNow(),
  durationSecs: integer("duration_secs").notNull().default(0),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmLeadSources = pgTable("crm_lead_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmCustomerSchema = createInsertSchema(crmCustomers).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmCustomer = typeof crmCustomers.$inferSelect;
export const insertCrmProjectSchema = createInsertSchema(crmProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmProject = typeof crmProjects.$inferSelect;
export const insertCrmJobSchema = createInsertSchema(crmJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmJob = typeof crmJobs.$inferSelect;
export const insertCrmEstimateSchema = createInsertSchema(crmEstimates).omit({ id: true, createdAt: true, updatedAt: true });
export type CrmEstimate = typeof crmEstimates.$inferSelect;
export type CrmEstimateItem = typeof crmEstimateItems.$inferSelect;
export type CrmEstimateDiscount = typeof crmEstimateDiscounts.$inferSelect;

// ── CRM: connected payment accounts + payments ───────────────────────────────
// The contractor connects THEIR OWN Stripe/Square account. We never take
// custody: Stripe Connect *Standard* with direct charges, so the contractor is
// merchant of record and dispute/negative-balance liability stays with Stripe
// rather than with us. (Express/Custom shift losses onto the platform — the
// common belief that "Express means Stripe takes the risk" is backwards.)
//
// ACH is the point: a $25,000 deposit costs ~$5 on ACH vs ~$725 on card.

export const CRM_PAYMENT_PROVIDERS = ["stripe", "square"] as const;
export const CRM_PAYMENT_STATUSES = [
  "pending", "processing", "succeeded", "failed", "canceled", "refunded",
] as const;

export const crmPaymentAccounts = pgTable("crm_payment_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  provider: text("provider").notNull(),
  // Stripe: acct_…  Square: merchant id
  externalAccountId: text("external_account_id").notNull(),
  livemode: boolean("livemode").notNull().default(false),
  // Capability flags as reported by the provider, so the UI can say honestly
  // whether ACH is actually turned on for this merchant.
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  achEnabled: boolean("ach_enabled").notNull().default(false),
  cardEnabled: boolean("card_enabled").notNull().default(false),
  accountEmail: text("account_email"),
  businessName: text("business_name"),
  country: text("country"),
  defaultCurrency: text("default_currency"),
  // Square OAuth issues refresh tokens; Stripe Standard does not need one.
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  connectedByMemberId: varchar("connected_by_member_id"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastError: text("last_error"),
  disconnectedAt: timestamp("disconnected_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmPayments = pgTable("crm_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  estimateId: varchar("estimate_id"),
  invoiceId: varchar("invoice_id"),
  projectId: varchar("project_id"),
  provider: text("provider").notNull(),
  // Stripe Checkout Session / PaymentIntent id
  externalId: text("external_id"),
  purpose: text("purpose").notNull().default("deposit"), // deposit | progress | final
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  method: text("method"),                                 // ach | card
  status: text("status").notNull().default("pending"),
  // Cents we charged as a platform fee. Zero by default — we are not skimming
  // the contractor's deposit.
  applicationFeeCents: integer("application_fee_cents").notNull().default(0),
  failureReason: text("failure_reason"),
  // Free-text memo on manually recorded (offline) payments — "check #1042".
  note: text("note"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CrmPaymentAccount = typeof crmPaymentAccounts.$inferSelect;
export type CrmPayment = typeof crmPayments.$inferSelect;

// ── CRM: invoices, costing, scheduling, field ops, API ───────────────────────
// The half neither Housecall Pro nor Leap ships. Verified against Leap's own
// bundle: cost code / budget / actual cost / retainage / punch list / daily log
// / allowance all return ZERO hits. This is the open ground.

export const CRM_CHANGE_ORDER_STATUSES = ["draft", "sent", "approved", "declined", "void"] as const;
export const CRM_APPOINTMENT_STATUSES = ["scheduled", "on_my_way", "started", "complete", "canceled"] as const;
export const CRM_PUNCH_STATUSES = ["open", "in_progress", "done", "wont_fix"] as const;
export const CRM_SELECTION_STATUSES = ["pending", "chosen", "ordered", "installed"] as const;
export const CRM_COMMITMENT_TYPES = ["purchase_order", "subcontract", "labor"] as const;

// ── Invoices (many per project = progress billing) ──────────────────────────
export const crmInvoices = pgTable("crm_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  projectId: varchar("project_id"),
  estimateId: varchar("estimate_id"),
  number: text("number"),
  title: text("title").notNull().default("Invoice"),
  status: text("status").notNull().default("draft"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  // Retainage withheld on this invoice — absent from both competitors.
  retainageBps: integer("retainage_bps").notNull().default(0),
  retainageCents: integer("retainage_cents").notNull().default(0),
  dueAt: timestamp("due_at"),
  publicToken: text("public_token").notNull(),
  sentAt: timestamp("sent_at"),
  sentToEmail: text("sent_to_email"),
  firstViewedAt: timestamp("first_viewed_at"),
  viewCount: integer("view_count").notNull().default(0),
  paidAt: timestamp("paid_at"),
  voidedAt: timestamp("voided_at"),
  notes: text("notes"),
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmInvoiceItems = pgTable("crm_invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  invoiceId: varchar("invoice_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  kind: text("kind").notNull().default("labor"),
  name: text("name").notNull(),
  description: text("description"),
  quantityMilli: integer("quantity_milli").notNull().default(1000),
  unit: text("unit"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  costCodeId: varchar("cost_code_id"),
  taxable: boolean("taxable").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Cost codes + the budget ledger ─────────────────────────────────────────
export const crmCostCodes = pgTable("crm_cost_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  code: text("code").notNull(),          // "06-100"
  name: text("name").notNull(),          // "Rough Carpentry"
  division: text("division"),            // CSI division grouping
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Optional phase layer. Leap admits its users fake phases with custom work
// types because it only allows one trade per job; we make it native.
export const crmPhases = pgTable("crm_phases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** One budget line per project × cost code. Budget vs Committed vs Actual. */
export const crmBudgetLines = pgTable("crm_budget_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  phaseId: varchar("phase_id"),
  costCodeId: varchar("cost_code_id").notNull(),
  budgetCents: integer("budget_cents").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** A PO or subcontract: money promised but not yet spent. */
export const crmCommitments = pgTable("crm_commitments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  costCodeId: varchar("cost_code_id"),
  type: text("type").notNull().default("purchase_order"),
  number: text("number"),
  vendorName: text("vendor_name"),
  supplier: text("supplier"),             // abc_supply | srs | qxo | other
  description: text("description"),
  amountCents: integer("amount_cents").notNull().default(0),
  status: text("status").notNull().default("open"),
  // Set when a supplier order is placed through an integration — this is what
  // closes the procurement→job-cost loop that neither competitor documents.
  externalOrderId: text("external_order_id"),
  orderedAt: timestamp("ordered_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Actual cost: a vendor bill or posted labor. */
export const crmCostEntries = pgTable("crm_cost_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  costCodeId: varchar("cost_code_id"),
  commitmentId: varchar("commitment_id"),
  source: text("source").notNull().default("vendor_bill"), // vendor_bill|labor|expense
  vendorName: text("vendor_name"),
  memberId: varchar("member_id"),
  description: text("description"),
  amountCents: integer("amount_cents").notNull().default(0),
  hoursMilli: integer("hours_milli"),
  incurredOn: timestamp("incurred_on").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Scheduling: appointments carry their own crew (HCP's model) ─────────────
export const crmAppointments = pgTable("crm_appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id"),
  jobId: varchar("job_id"),
  customerId: varchar("customer_id"),
  title: text("title").notNull(),
  notes: text("notes"),
  crewNotes: text("crew_notes"),
  status: text("status").notNull().default("scheduled"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  allDay: boolean("all_day").notNull().default(false),
  arrivalWindowMinutes: integer("arrival_window_minutes"),
  // Per-visit crew — a three-visit job assigns different people per visit.
  dispatchedMemberIds: text("dispatched_member_ids").array(),
  onMyWayAt: timestamp("on_my_way_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Change orders — the #1 missing feature for remodelers ───────────────────
export const crmChangeOrders = pgTable("crm_change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  number: text("number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  amountCents: integer("amount_cents").notNull().default(0),
  costCents: integer("cost_cents"),
  scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
  costCodeId: varchar("cost_code_id"),
  publicToken: text("public_token").notNull(),
  sentAt: timestamp("sent_at"),
  firstViewedAt: timestamp("first_viewed_at"),
  approvedAt: timestamp("approved_at"),
  declinedAt: timestamp("declined_at"),
  signatureName: text("signature_name"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Field ops: punch list, daily logs, selections & allowances ──────────────
export const crmPunchItems = pgTable("crm_punch_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  status: text("status").notNull().default("open"),
  assignedMemberId: varchar("assigned_member_id"),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  photoUrls: text("photo_urls").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmDailyLogs = pgTable("crm_daily_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  logDate: timestamp("log_date").notNull(),
  authorMemberId: varchar("author_member_id"),
  weather: text("weather"),
  tempF: integer("temp_f"),
  crewCount: integer("crew_count"),
  hoursMilli: integer("hours_milli"),
  workCompleted: text("work_completed"),
  delays: text("delays"),
  visitors: text("visitors"),
  safetyNotes: text("safety_notes"),
  photoUrls: text("photo_urls").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmSelections = pgTable("crm_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id").notNull(),
  category: text("category"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  // Allowance vs actual: the overage is billable to the homeowner.
  allowanceCents: integer("allowance_cents").notNull().default(0),
  chosenOptionName: text("chosen_option_name"),
  actualCents: integer("actual_cents"),
  dueAt: timestamp("due_at"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Estimate options (good / better / best) ─────────────────────────────────
export const crmEstimateOptions = pgTable("crm_estimate_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  estimateId: varchar("estimate_id").notNull(),
  name: text("name").notNull(),            // Good / Better / Best
  tier: integer("tier").notNull().default(1),
  description: text("description"),
  recommended: boolean("recommended").notNull().default(false),
  // Leap leaked pricing by showing tier totals; we default to hiding them.
  showTotal: boolean("show_total").notNull().default(true),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  selectedAt: timestamp("selected_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Public API keys + webhooks (Leap has neither) ───────────────────────────
export const crmApiKeys = pgTable("crm_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  // Only a SHA-256 hash is stored; the plaintext is shown once at creation.
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: text("scopes").array(),
  createdByMemberId: varchar("created_by_member_id"),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmWebhooks = pgTable("crm_webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array(),
  active: boolean("active").notNull().default(true),
  lastStatus: integer("last_status"),
  lastAttemptAt: timestamp("last_attempt_at"),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const CRM_WEBHOOK_EVENTS = [
  "customer.created", "customer.updated",
  "project.created", "project.stage_changed",
  "estimate.sent", "estimate.viewed", "estimate.approved", "estimate.declined",
  "invoice.sent", "invoice.viewed", "invoice.paid",
  "changeorder.approved", "changeorder.declined",
  "appointment.scheduled", "appointment.completed",
  "payment.succeeded", "payment.failed",
] as const;

export type CrmInvoice = typeof crmInvoices.$inferSelect;
export type CrmCostCode = typeof crmCostCodes.$inferSelect;
export type CrmBudgetLine = typeof crmBudgetLines.$inferSelect;
export type CrmAppointment = typeof crmAppointments.$inferSelect;
export type CrmChangeOrder = typeof crmChangeOrders.$inferSelect;

// ── CRM: price book ─────────────────────────────────────────────────────────
// Hybrid of both competitors (see analysis/PRICE-BOOK-RESEARCH.md):
//  - Housecall Pro's spine: every material and labor rate carries COST and
//    PRICE, so margin is computed rather than guessed, and an assembly is
//    materials × qty + labor × hours.
//  - Leap's formula engine: a qty formula string with [SYMBOL] placeholders.
//  - Leap's accessories and packages (good/better/best).
//  - Ours, which neither has: an explicit wasteFactorBps field, so nobody has
//    to bury "* 1.10" in a formula string and later wonder why.

export const CRM_PB_PRICING_MODES = ["flat", "computed", "formula", "percentage"] as const;
export const CRM_PB_UNITS = [
  "ea", "sq", "sf", "lf", "cy", "hr", "day", "gal", "lb", "ton", "roll", "bundle", "sheet", "job",
] as const;

/** Formula symbols the evaluator understands, plus per-item custom placeholders. */
export const CRM_PB_SYMBOLS = [
  "QTY", "SQUARES", "LF", "SF", "EA", "PITCH", "STORIES", "WASTE", "COST", "PRICE", "HOURS",
] as const;

export const crmPbCategories = pgTable("crm_pb_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  parentId: varchar("parent_id"),           // nested to any depth, HCP's model
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmPbLaborRates = pgTable("crm_pb_labor_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  hourlyCostCents: integer("hourly_cost_cents").notNull().default(0),
  hourlyPriceCents: integer("hourly_price_cents").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmPbMaterials = pgTable("crm_pb_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  categoryId: varchar("category_id"),
  name: text("name").notNull(),
  sku: text("sku"),
  description: text("description"),
  unit: text("unit").notNull().default("ea"),
  costCents: integer("cost_cents").notNull().default(0),
  priceCents: integer("price_cents").notNull().default(0),
  // 1000 = 10% waste, applied to QUANTITY when an assembly expands. Neither
  // competitor has a dedicated field for this.
  wasteFactorBps: integer("waste_factor_bps").notNull().default(0),
  taxable: boolean("taxable").notNull().default(true),
  supplier: text("supplier"),               // abc_supply | srs | qxo | other
  supplierSku: text("supplier_sku"),
  imageUrl: text("image_url"),
  active: boolean("active").notNull().default(true),
  costUpdatedAt: timestamp("cost_updated_at"),
  customFields: jsonb("custom_fields"),     // e.g. hcpStats for mined scopes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** The assembly. One line on an estimate that expands into many. */
export const crmPbItems = pgTable("crm_pb_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  categoryId: varchar("category_id"),
  code: text("code"),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull().default("ea"),
  pricingMode: text("pricing_mode").notNull().default("computed"),
  // flat mode
  flatPriceCents: integer("flat_price_cents"),
  flatCostCents: integer("flat_cost_cents"),
  // percentage mode (Leap's isPercentage) — e.g. a 15% overhead line
  percentBps: integer("percent_bps"),
  // formula mode: "[SQUARES] * 1.1 + 2" with named placeholders
  qtyFormula: text("qty_formula"),
  placeholders: jsonb("placeholders"),      // [{symbol,label,defaultValue}]
  // markup applied to computed COST to reach price when priceCents are absent
  markupBps: integer("markup_bps").notNull().default(0),
  minChargeCents: integer("min_charge_cents"),
  taxable: boolean("taxable").notNull().default(true),
  costCodeId: varchar("cost_code_id"),      // ties the sale straight to the budget
  active: boolean("active").notNull().default(true),
  customFields: jsonb("custom_fields"),     // e.g. hcpStats for mined scopes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Assembly contents: a material with a quantity, or labor with hours. */
export const crmPbItemParts = pgTable("crm_pb_item_parts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  itemId: varchar("item_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  materialId: varchar("material_id"),
  laborRateId: varchar("labor_rate_id"),
  // per ONE unit of the parent assembly. 1000 = 1.000
  quantityMilli: integer("quantity_milli").notNull().default(1000),
  hoursMilli: integer("hours_milli"),
  // Optional per-part formula, overrides quantityMilli when present
  qtyFormula: text("qty_formula"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Optional add-ons offered with a parent item (Leap's accessories). */
export const crmPbItemAccessories = pgTable("crm_pb_item_accessories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  itemId: varchar("item_id").notNull(),
  accessoryItemId: varchar("accessory_item_id").notNull(),
  defaultIncluded: boolean("default_included").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** A bundle of items → becomes a good/better/best estimate option. */
export const crmPbPackages = pgTable("crm_pb_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  tier: integer("tier").notNull().default(1),
  description: text("description"),
  categoryId: varchar("category_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crmPbPackageItems = pgTable("crm_pb_package_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  packageId: varchar("package_id").notNull(),
  itemId: varchar("item_id").notNull(),
  quantityMilli: integer("quantity_milli").notNull().default(1000),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type CrmPbItem = typeof crmPbItems.$inferSelect;
export type CrmPbMaterial = typeof crmPbMaterials.$inferSelect;

// ── CRM: measurements ───────────────────────────────────────────────────────
// Provider-neutral by design. HOVER and EagleView are explicitly NOT planned
// (owner decision 2026-07-29); the CladAI measurement project becomes the
// provider once it ships.
//
// ⚠️ TOWER BOUNDARY: CladAI is a SEPARATE project and is SHARED with outside
// devs, while ConstructHUB is private. When this is wired it MUST go over
// CladAI's public HTTPS API using a credential issued to ConstructHUB — never
// by reading its local files, never by sharing its database, never by
// importing its code. See analysis/CRM-BRAIN.md §7b before implementing.

export const CRM_MEASUREMENT_PROVIDERS = ["manual", "cladai", "hover", "other"] as const;
export const CRM_MEASUREMENT_STATUSES = ["draft", "requested", "processing", "ready", "failed"] as const;

export const crmMeasurements = pgTable("crm_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  projectId: varchar("project_id"),
  customerId: varchar("customer_id"),
  provider: text("provider").notNull().default("manual"),
  status: text("status").notNull().default("draft"),
  // The provider's own job/report id, so a later callback can find this row.
  externalId: text("external_id"),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  // Derived values, normalised into the units estimating actually uses. These
  // become the [SQUARES]/[LF]/[SF] symbols an assembly formula consumes.
  squaresMilli: integer("squares_milli"),        // roof squares, 1000 = 1.000
  roofAreaSfMilli: integer("roof_area_sf_milli"),
  wallAreaSfMilli: integer("wall_area_sf_milli"),
  ridgeLfMilli: integer("ridge_lf_milli"),
  hipLfMilli: integer("hip_lf_milli"),
  valleyLfMilli: integer("valley_lf_milli"),
  eaveLfMilli: integer("eave_lf_milli"),
  rakeLfMilli: integer("rake_lf_milli"),
  perimeterLfMilli: integer("perimeter_lf_milli"),
  predominantPitch: text("predominant_pitch"),   // "6/12"
  stories: integer("stories"),
  facetCount: integer("facet_count"),
  wasteSuggestionBps: integer("waste_suggestion_bps"),
  // Whatever the provider returned, kept verbatim for audit and re-derivation.
  rawPayload: jsonb("raw_payload"),
  reportUrl: text("report_url"),
  requestedByMemberId: varchar("requested_by_member_id"),
  requestedAt: timestamp("requested_at"),
  completedAt: timestamp("completed_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CrmMeasurement = typeof crmMeasurements.$inferSelect;
