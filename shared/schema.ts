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
  portalUrl: text("portal_url").notNull(),
  searchUrl: text("search_url").notNull(),
  platform: text("platform").notNull(),
  phone: text("phone"),
  address: text("address"),
  searchableFields: text("searchable_fields").array(),
  addressSearchPattern: text("address_search_pattern"),
  ownerSearchPattern: text("owner_search_pattern"),
  parcelSearchPattern: text("parcel_search_pattern"),
  isActive: boolean("is_active").notNull().default(true),
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
