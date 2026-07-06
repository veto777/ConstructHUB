import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, json, jsonb, serial, uniqueIndex, doublePrecision, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Import AI Task Management Schema
export * from "./task-management-schema";

// ==========================================
// CORE TABLES - PHASE 1
// Essential tables for basic functionality
// ==========================================

// Contact forms functionality with IP tracking
export const contactSubmissions = pgTable("contact_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  message: text("message"),
  isProcessed: boolean("is_processed").default(false),
  // IP Analytics fields
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  location: text("location"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  referrer: text("referrer"),
  // Acknowledgment email open tracking (via tracking pixel)
  emailOpenedAt: timestamp("email_opened_at"),
  emailOpenCount: integer("email_open_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Newsletter subscriptions with IP tracking
export const newsletterSubscriptions = pgTable("newsletter_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  // IP Analytics fields
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  location: text("location"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  referrer: text("referrer"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// GOOGLE LOCAL SERVICES ADS (LSA)
// OAuth token store + imported LSA leads so Google LSA phone-call/message
// leads show alongside website leads in the admin panel.
// ==========================================

// Single-row OAuth credential/token store for the Google Ads / LSA connection.
export const googleAdsConfig = pgTable("google_ads_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  refreshToken: text("refresh_token"),
  loginCustomerId: text("login_customer_id"),
  connectedEmail: text("connected_email"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  lastSyncCount: integer("last_sync_count").default(0),
  lastCostTotal: numeric("last_cost_total", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Imported Google Local Services Ads leads (phone-call, message, booking).
export const lsaLeads = pgTable("lsa_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  // Lead rating / feedback sent to Google (ProvideLeadFeedback). feedbackSubmitted
  // & creditState are synced authoritatively from Google; surveyAnswer &
  // disputeReason record what WE sent (Google doesn't echo them back).
  feedbackSubmitted: boolean("feedback_submitted"),
  surveyAnswer: text("survey_answer"),
  disputeReason: text("dispute_reason"),
  creditState: text("credit_state"),
  // Local dispute pipeline state (NOT from Google): null | scheduled | queued |
  // sending | disputed | failed. Drives the real-time "disputed" sticker and
  // stops the same lead from being disputed twice. Preserved across syncs.
  disputeStatus: text("dispute_status"),
  // When set (and disputeStatus = 'scheduled'), the dispute is held until this
  // moment, then promoted into the spaced send queue. Lets disputes be scattered
  // across days/weeks so they look natural to Google instead of one big burst.
  disputeScheduledAt: timestamp("dispute_scheduled_at"),
  // Telegram message_id of the "new LSA lead" alert we sent for this lead. Lets
  // the owner reply "dispute" to that alert and have us map it back to the lead.
  tgAlertMessageId: text("tg_alert_message_id"),
  leadCreationTime: timestamp("lead_creation_time"),
  rawJson: jsonb("raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pre-estimate questionnaire / survey submissions
export const surveySubmissions = pgTable("survey_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  projectType: text("project_type"), // 'repair' | 'replacement' | 'not_sure'
  services: text("services").array(), // siding, windows, doors, roof, gutters, painting, fascia, deck, other
  receivedEstimates: text("received_estimates"), // 'yes' | 'no'
  otherCompanies: text("other_companies"),
  satisfiedWithOthers: text("satisfied_with_others"), // 'yes' | 'no' | 'na'
  mostImportant: text("most_important"), // 'price' | 'quality' | 'timeline' | 'warranty' | 'trust'
  timeline: text("timeline"),
  additionalNotes: text("additional_notes"),
  estimatesComments: text("estimates_comments"), // free-text comments about other companies' estimates
  serviceDetails: text("service_details"), // free-text comments about the services they're interested in
  paymentMethod: text("payment_method"), // 'financing' | 'cash' | 'undecided' (full replacement only)
  readiness: text("readiness"), // 'immediately' | 'depends_on_cost' (full replacement only)
  sidingAge: text("siding_age"), // how old their current siding is (only if siding selected)
  sidingType: text("siding_type"), // what kind of siding they have (only if siding selected)
  roofAge: text("roof_age"), // how old their roof is (only if roof selected)
  visitedAlpineShowroom: text("visited_alpine_showroom"), // 'yes' | 'no'
  wantsAlpineVisit: text("wants_alpine_visit"), // 'yes' | 'no' (only if not visited yet)
  visitedOtherShowroom: text("visited_other_showroom"), // 'yes' | 'no'
  // tracking
  contactSubmissionId: varchar("contact_submission_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // 'mobile' | 'tablet' | 'desktop'
  browserType: text("browser_type"),
  city: text("city"),
  region: text("region"),
  referrer: text("referrer"),
  isProcessed: boolean("is_processed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pre-estimate questionnaire progress / abandonment tracking
export const surveyProgress = pgTable("survey_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactSubmissionId: varchar("contact_submission_id"),
  name: text("name"),
  email: text("email"),
  lastStep: text("last_step"), // human label of furthest section reached
  lastStepIndex: integer("last_step_index").default(0),
  completed: boolean("completed").default(false),
  ipAddress: text("ip_address"),
  city: text("city"),
  region: text("region"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Chat system
export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  ipAddress: text("ip_address").notNull(),
  userId: text("user_id"),
  startTime: timestamp("start_time").defaultNow(),
  lastActivity: timestamp("last_activity").defaultNow(),
  messageCount: integer("message_count").default(0),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  aiTool: text("ai_tool").default('alpine'),
  timestamp: timestamp("timestamp").defaultNow(),
  metadata: text("metadata"),
  isProcessed: boolean("is_processed").default(false),
});

// Live Chat (Telegram relay) — stores visitor messages and team replies for admin review
export const liveChatSessions = pgTable("live_chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  sessionName: text("session_name"),
  ipAddress: text("ip_address"),
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  city: text("city"),
  startedAt: timestamp("started_at").defaultNow(),
  lastActivity: timestamp("last_activity").defaultNow(),
  messageCount: integer("message_count").default(0),
});

export const liveChatMessages = pgTable("live_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'visitor' or 'team'
  content: text("content").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
});

// Leads management
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  serviceType: text("service_type").notNull(),
  county: text("county"),
  message: text("message"),
  source: text("source").default("contact_form"),
  status: text("status").default("new"),
  priority: text("priority").default("medium"),
  isValidRegion: boolean("is_valid_region").default(false),
  userId: text("user_id"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Lead scoring
export const leadScoring = pgTable("lead_scoring", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  behaviorScore: integer("behavior_score").default(0),
  engagementScore: integer("engagement_score").default(0),
  demographicScore: integer("demographic_score").default(0),
  totalScore: integer("total_score").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Conversion funnel
export const conversionFunnel = pgTable("conversion_funnel", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stage: text("stage").notNull(),
  step: text("step").notNull(),
  count: integer("count").default(0),
  conversionRate: text("conversion_rate").default("0.00"),
  dateRange: text("date_range").default("last_30_days"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Active sessions tracking
export const activeSessions = pgTable("active_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  userId: text("user_id"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  startTime: timestamp("start_time").defaultNow(),
  lastActivity: timestamp("last_activity").defaultNow(),
  status: text("status").default("active"),
  messageCount: integer("message_count").default(0),
});

// IP blocking
// Blocked IPs — columns aligned to the actual database table.
export const blockedIps = pgTable("blocked_ips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull().unique(),
  reason: text("reason"),
  blockedAt: timestamp("blocked_at").defaultNow(),
  blockedUntil: timestamp("blocked_until"),
  isPermanent: boolean("is_permanent").default(false),
  userAgent: text("user_agent"),
  requestCount: integer("request_count").default(0),
  createdBy: text("created_by"),
});

// Rate limiting
export const rateLimits = pgTable("rate_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull(),
  endpoint: text("endpoint").notNull(),
  requestCount: integer("request_count").default(1),
  windowStart: timestamp("window_start").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// User tracking
export const uniqueUsers = pgTable("unique_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().unique(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  firstSeen: timestamp("first_seen").defaultNow(),
  lastSeen: timestamp("last_seen").defaultNow(),
  visitCount: integer("visit_count").default(1),
  isBlocked: boolean("is_blocked").default(false),
});

// Site visits - aligned with actual database structure
export const siteVisits = pgTable("site_visits", {
  id: serial("id").primaryKey(),
  visitedAt: timestamp("visited_at").defaultNow(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  pageUrl: text("page_url"),
  referrer: text("referrer"),
});

// IP Analytics tracking table
export const ipAnalytics = pgTable("ip_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull(),
  location: text("location"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  isp: text("isp"),
  userAgent: text("user_agent"),
  firstSeen: timestamp("first_seen").defaultNow(),
  lastSeen: timestamp("last_seen").defaultNow(),
  visitCount: integer("visit_count").default(1),
  pageViews: integer("page_views").default(1),
  chatSessions: integer("chat_sessions").default(0),
  messages: integer("messages").default(0),
  riskScore: integer("risk_score").default(0),
  isBlocked: boolean("is_blocked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  ipAddressIdx: uniqueIndex("ip_analytics_ip_address_idx").on(table.ipAddress),
}));

// Form submission analytics - tracks all form interactions
export const formAnalytics = pgTable("form_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  formType: text("form_type").notNull(), // 'contact', 'newsletter', 'lead', 'chat'
  submissionId: text("submission_id"), // reference to actual submission
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  location: text("location"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  isp: text("isp"),
  referrer: text("referrer"),
  pageUrl: text("page_url"),
  deviceType: text("device_type"), // 'mobile', 'desktop', 'tablet'
  browserType: text("browser_type"),
  isFirstVisit: boolean("is_first_visit").default(true),
  sessionDuration: integer("session_duration"), // in seconds
  pageViewsBeforeSubmit: integer("page_views_before_submit").default(1),
  riskScore: integer("risk_score").default(0),
  isBlocked: boolean("is_blocked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Admin login attempts
export const adminLoginAttempts = pgTable("admin_login_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull(),
  username: text("username"),
  success: boolean("success").default(false),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Basic user table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// RELATIONS
// ==========================================

export const leadsRelations = relations(leads, ({ one }) => ({
  scoring: one(leadScoring, {
    fields: [leads.id],
    references: [leadScoring.leadId],
  }),
}));

// ==========================================
// PROJECT MANAGEMENT MODULE - PHASE 2
// Independent database tables for projects
// ==========================================

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: varchar("title").notNull(),
  slug: varchar("slug"),
  description: text("description"),
  featuredImage: varchar("featured_image"),
  city: varchar("city"),
  niche: varchar("niche"),
  beforeImage: varchar("before_image"),
  afterImage: varchar("after_image"),
  metaTitle: varchar("meta_title"),
  metaDescription: text("meta_description"),
  metaKeywords: text("meta_keywords"),
  schemaData: text("schema_data"),
  content: text("content"),
  status: varchar("status").default("active"),
  category: text("category"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectImages = pgTable("project_images", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  originalFilename: varchar("original_filename"),
  optimizedFilename: varchar("optimized_filename"),
  altText: varchar("alt_text"),
  caption: text("caption"),
  fileSize: integer("file_size"),
  width: integer("width"),
  height: integer("height"),
  format: varchar("format"),
  isBeforeAfter: boolean("is_before_after").default(false),
  beforeAfterType: varchar("before_after_type"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectCategories = pgTable("project_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  displayOrder: integer("display_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectCategoryRelations = pgTable("project_category_relations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  categoryId: text("category_id").references(() => projectCategories.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const chatSessionsRelations = relations(chatSessions, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.sessionId],
  }),
}));

// ==========================================
// INSERT SCHEMAS
// ==========================================

export const insertContactSubmissionSchema = createInsertSchema(contactSubmissions);
export const insertSurveySubmissionSchema = createInsertSchema(surveySubmissions);
export const insertSurveyProgressSchema = createInsertSchema(surveyProgress);
export const insertNewsletterSubscriptionSchema = createInsertSchema(newsletterSubscriptions);
export const insertGoogleAdsConfigSchema = createInsertSchema(googleAdsConfig);
export const insertLsaLeadSchema = createInsertSchema(lsaLeads);
export const insertChatSessionSchema = createInsertSchema(chatSessions);
export const insertChatMessageSchema = createInsertSchema(chatMessages);
export const insertLeadSchema = createInsertSchema(leads);
export const insertLeadScoringSchema = createInsertSchema(leadScoring);
export const insertConversionFunnelSchema = createInsertSchema(conversionFunnel);
export const insertActiveSessionSchema = createInsertSchema(activeSessions);
export const insertBlockedIpSchema = createInsertSchema(blockedIps);
export const insertRateLimitSchema = createInsertSchema(rateLimits);
export const insertUniqueUserSchema = createInsertSchema(uniqueUsers);
export const insertSiteVisitSchema = createInsertSchema(siteVisits);
export const insertAdminLoginAttemptSchema = createInsertSchema(adminLoginAttempts);
export const insertUserSchema = createInsertSchema(users);
export const insertFormAnalyticsSchema = createInsertSchema(formAnalytics);
export const insertIpAnalyticsSchema = createInsertSchema(ipAnalytics);

// Project Management Schemas
export const insertProjectSchema = createInsertSchema(projects);
export const insertProjectImageSchema = createInsertSchema(projectImages);
export const insertProjectCategorySchema = createInsertSchema(projectCategories);

// ==========================================
// TYPES
// ==========================================

export type ContactSubmission = typeof contactSubmissions.$inferSelect;
export type InsertContactSubmission = z.infer<typeof insertContactSubmissionSchema>;

export type GoogleAdsConfig = typeof googleAdsConfig.$inferSelect;
export type InsertGoogleAdsConfig = z.infer<typeof insertGoogleAdsConfigSchema>;

export type LsaLead = typeof lsaLeads.$inferSelect;
export type InsertLsaLead = z.infer<typeof insertLsaLeadSchema>;

export type SurveySubmission = typeof surveySubmissions.$inferSelect;
export type InsertSurveySubmission = z.infer<typeof insertSurveySubmissionSchema>;

export type SurveyProgress = typeof surveyProgress.$inferSelect;
export type InsertSurveyProgress = z.infer<typeof insertSurveyProgressSchema>;

export type NewsletterSubscription = typeof newsletterSubscriptions.$inferSelect;
export type InsertNewsletterSubscription = z.infer<typeof insertNewsletterSubscriptionSchema>;

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

export type LeadScoring = typeof leadScoring.$inferSelect;
export type InsertLeadScoring = z.infer<typeof insertLeadScoringSchema>;

export type ConversionFunnel = typeof conversionFunnel.$inferSelect;
export type InsertConversionFunnel = z.infer<typeof insertConversionFunnelSchema>;

export type ActiveSession = typeof activeSessions.$inferSelect;
export type InsertActiveSession = z.infer<typeof insertActiveSessionSchema>;

export type BlockedIp = typeof blockedIps.$inferSelect;
export type InsertBlockedIp = z.infer<typeof insertBlockedIpSchema>;

export type RateLimit = typeof rateLimits.$inferSelect;
export type InsertRateLimit = z.infer<typeof insertRateLimitSchema>;

export type UniqueUser = typeof uniqueUsers.$inferSelect;
export type InsertUniqueUser = z.infer<typeof insertUniqueUserSchema>;

export type SiteVisit = typeof siteVisits.$inferSelect;
export type InsertSiteVisit = z.infer<typeof insertSiteVisitSchema>;

export type AdminLoginAttempt = typeof adminLoginAttempts.$inferSelect;
export type InsertAdminLoginAttempt = z.infer<typeof insertAdminLoginAttemptSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type FormAnalytics = typeof formAnalytics.$inferSelect;
export type InsertFormAnalytics = z.infer<typeof insertFormAnalyticsSchema>;

export type IpAnalytics = typeof ipAnalytics.$inferSelect;
export type InsertIpAnalytics = z.infer<typeof insertIpAnalyticsSchema>;

// Project Management Types
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type ProjectImage = typeof projectImages.$inferSelect;
export type InsertProjectImage = z.infer<typeof insertProjectImageSchema>;

export type ProjectCategory = typeof projectCategories.$inferSelect;
export type InsertProjectCategory = z.infer<typeof insertProjectCategorySchema>;

// VERITAS Tables - Validation Engine for Robust Incremental Testing Across Systems
export const veritasExecutions = pgTable("veritas_executions", {
  id: serial("id").primaryKey(),
  executionId: varchar("execution_id", { length: 100 }).notNull().unique(),
  overallStatus: varchar("overall_status", { length: 50 }).notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // milliseconds
  totalTests: integer("total_tests").default(0),
  passedTests: integer("passed_tests").default(0),
  failedTests: integer("failed_tests").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const veritasTestResults = pgTable("veritas_test_results", {
  id: serial("id").primaryKey(),
  executionId: varchar("execution_id", { length: 100 }).notNull(),
  testName: varchar("test_name", { length: 200 }).notNull(),
  phase: varchar("phase", { length: 20 }).notNull(), // ACTMS, MODUS, STRIDE
  status: varchar("status", { length: 20 }).notNull(), // passed, failed, warning
  executionTime: integer("execution_time").notNull(), // milliseconds
  details: text("details"),
  errors: text("errors").array(),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const veritasCriticalFailures = pgTable("veritas_critical_failures", {
  id: serial("id").primaryKey(),
  executionId: varchar("execution_id", { length: 100 }).notNull(),
  component: varchar("component", { length: 100 }).notNull(),
  error: text("error").notNull(),
  severity: varchar("severity", { length: 20 }).notNull(), // low, medium, high, critical
  timestamp: timestamp("timestamp").notNull(),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// VERITAS Schema exports
export const insertVeritasExecutionSchema = createInsertSchema(veritasExecutions).omit({ id: true, createdAt: true });
export const insertVeritasTestResultSchema = createInsertSchema(veritasTestResults).omit({ id: true, createdAt: true });
export const insertVeritasCriticalFailureSchema = createInsertSchema(veritasCriticalFailures).omit({ id: true, createdAt: true });

export type VeritasExecution = typeof veritasExecutions.$inferSelect;
export type InsertVeritasExecution = z.infer<typeof insertVeritasExecutionSchema>;
export type VeritasTestResult = typeof veritasTestResults.$inferSelect;
export type InsertVeritasTestResult = z.infer<typeof insertVeritasTestResultSchema>;
export type VeritasCriticalFailure = typeof veritasCriticalFailures.$inferSelect;
export type InsertVeritasCriticalFailure = z.infer<typeof insertVeritasCriticalFailureSchema>;

// ==========================================
// SERVICE LOCATION TEMPLATES SYSTEM
// Page generation and template management
// ==========================================

export const serviceLocationTemplates = pgTable("service_location_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  state: text("state").notNull(),
  city: text("city").notNull(),
  citySlug: text("city_slug").notNull(),
  service: text("service").notNull(),
  serviceName: text("service_name").notNull(),
  county: text("county"),
  zipCodes: json("zip_codes").$type<string[]>().default([]),
  heroImageUrl: text("hero_image_url"),
  description: text("description"),
  metaTitle: text("meta_title").notNull(),
  metaDescription: text("meta_description").notNull(),
  localFeatures: json("local_features").$type<string[]>().default([]),
  nearbyAreas: json("nearby_areas").$type<string[]>().default([]),
  customContent: json("custom_content").$type<Record<string, any>>().default({}),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const servicePageConfigurations = pgTable("service_page_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateName: text("template_name").notNull(),
  version: text("version").notNull(),
  componentStructure: json("component_structure").$type<Record<string, any>>().default({}),
  styling: json("styling").$type<Record<string, any>>().default({}),
  seoSettings: json("seo_settings").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Schema types for Service Location Templates
export const insertServiceLocationTemplateSchema = createInsertSchema(serviceLocationTemplates);
export const insertServicePageConfigurationSchema = createInsertSchema(servicePageConfigurations);

export type ServiceLocationTemplate = typeof serviceLocationTemplates.$inferSelect;
export type InsertServiceLocationTemplate = z.infer<typeof insertServiceLocationTemplateSchema>;

export type ServicePageConfiguration = typeof servicePageConfigurations.$inferSelect;
export type InsertServicePageConfiguration = z.infer<typeof insertServicePageConfigurationSchema>;

// ==========================================
// ALAI SIDING CONTRACTOR PROTECTED SYSTEM
// Protected siding content generation database
// ==========================================

export const sidingContractorProtected = pgTable("siding_contractor_protected", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  citySlug: text("city_slug").notNull().unique(),
  cityName: text("city_name").notNull(),
  content: text("content").notNull(), // JSON string of the generated content
  provider: text("provider").notNull(), // 'anthropic', 'openai', 'xai'
  generatedAt: timestamp("generated_at").defaultNow(),
  lastModified: timestamp("last_modified").defaultNow(),
});

// Schema for siding contractor protected content
export const insertSidingContractorProtectedSchema = createInsertSchema(sidingContractorProtected);

export type SidingContractorProtected = typeof sidingContractorProtected.$inferSelect;
export type InsertSidingContractorProtected = z.infer<typeof insertSidingContractorProtectedSchema>;

// Hyperlocal SEO preview content (city + service → JSON).
// Mirrors server/data/preview-content/<city>.json keyed by service slug.
// One row per (citySlug, serviceSlug). Content is the SampleContent JSON the
// /api/preview-content/:city/:service endpoint returns.
export const previewContent = pgTable("preview_content", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  citySlug: text("city_slug").notNull(),
  serviceSlug: text("service_slug").notNull(),
  content: jsonb("content").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  cityServiceUnique: uniqueIndex("preview_content_city_service_idx").on(t.citySlug, t.serviceSlug),
}));

export const insertPreviewContentSchema = createInsertSchema(previewContent).omit({ id: true, updatedAt: true });
export type PreviewContent = typeof previewContent.$inferSelect;
export type InsertPreviewContent = z.infer<typeof insertPreviewContentSchema>;

// AI Interactions tracking for admin portal
export const aiInteractions = pgTable("ai_interactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  userInput: text("user_input").notNull(),
  aiResponse: text("ai_response").notNull(),
  aiTool: text("ai_tool").default('alpine'),
  responseTime: integer("response_time").default(0),
  userSatisfaction: integer("user_satisfaction"),
  timestamp: timestamp("timestamp").defaultNow(),
  page: text("page"),
  contextData: json("context_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAIInteractionSchema = createInsertSchema(aiInteractions);
export type AIInteraction = typeof aiInteractions.$inferSelect;
export type InsertAIInteraction = z.infer<typeof insertAIInteractionSchema>;

// Session Analytics for tracking user engagement
export const sessionAnalytics = pgTable("session_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  questionsAsked: integer("questions_asked").default(0),
  messagesExchanged: integer("messages_exchanged").default(0),
  leadCaptured: boolean("lead_captured").default(false),
  pageViews: integer("page_views").default(0),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSessionAnalyticsSchema = createInsertSchema(sessionAnalytics);
export type SessionAnalytics = typeof sessionAnalytics.$inferSelect;
export type InsertSessionAnalytics = z.infer<typeof insertSessionAnalyticsSchema>;

// Admin users — schema aligned to the existing admin_users table (read-only in the admin UI).
export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  role: text("role").default("admin"),
  isActive: boolean("is_active").default(true),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AdminUser = typeof adminUsers.$inferSelect;

// Security settings — single-row table powering the Security Settings admin page.
export const securitySettings = pgTable("security_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailOnUnfamiliarDevice: boolean("email_on_unfamiliar_device").default(true),
  mainAdminEmail: text("main_admin_email").default("office@alpineexteriorswa.com"),
  maxLoginAttempts: integer("max_login_attempts").default(5),
  lockoutDuration: integer("lockout_duration").default(15),
  passwordResetExpiry: integer("password_reset_expiry").default(60),
  requireEmailVerification: boolean("require_email_verification").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type SecuritySettings = typeof securitySettings.$inferSelect;

export const loginHistory = pgTable("login_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  keepLoggedIn: boolean("keep_logged_in").default(false),
  success: boolean("success").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export type LoginHistory = typeof loginHistory.$inferSelect;

// User Questions tracking
export const userQuestions = pgTable("user_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  question: text("question").notNull(),
  category: text("category"),
  answered: boolean("answered").default(false),
  timestamp: timestamp("timestamp").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserQuestionSchema = createInsertSchema(userQuestions);
export type UserQuestion = typeof userQuestions.$inferSelect;
export type InsertUserQuestion = z.infer<typeof insertUserQuestionSchema>;

// ==========================================
// SAMPLE PAGE BACKUPS - GOLDEN TEMPLATES
// Protected backup system for template preservation
// ==========================================

export const samplePageBackups = pgTable("sample_page_backups", {
  id: serial("id").primaryKey(),
  pageType: varchar("page_type", { length: 100 }).notNull(),
  citySlug: varchar("city_slug", { length: 100 }).notNull(),
  routePath: varchar("route_path", { length: 255 }).notNull().unique(),
  content: json("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  isProtected: boolean("is_protected").default(true),
  backupSource: varchar("backup_source", { length: 255 }),
  templateVersion: varchar("template_version", { length: 50 }).default("1.0"),
});

export const insertSamplePageBackupSchema = createInsertSchema(samplePageBackups);
export type SamplePageBackup = typeof samplePageBackups.$inferSelect;
export type InsertSamplePageBackup = z.infer<typeof insertSamplePageBackupSchema>;

// City Content Cache for persistent storage
export const cityContentCache = pgTable("city_content_cache", {
  id: serial("id").primaryKey(),
  citySlug: text("city_slug").notNull(),
  serviceSlug: text("service_slug").notNull(),
  contentData: text("content_data").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCityService: uniqueIndex("unique_city_service").on(table.citySlug, table.serviceSlug),
}));

// Roofing Content Cache for persistent storage
export const roofingContentCache = pgTable("roofing_content_cache", {
  id: serial("id").primaryKey(),
  citySlug: text("city_slug").notNull(),
  serviceSlug: text("service_slug").notNull(),
  contentData: text("content_data").notNull(),
  contentHash: text("content_hash").notNull(),  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRoofingCityService: uniqueIndex("unique_roofing_city_service").on(table.citySlug, table.serviceSlug),
}));

// Deck Content Cache for persistent storage
export const deckContentCache = pgTable("deck_content_cache", {
  id: serial("id").primaryKey(),
  citySlug: text("city_slug").notNull(),
  serviceSlug: text("service_slug").notNull(),
  contentData: text("content_data").notNull(),
  contentHash: text("content_hash").notNull(),  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueDeckCityService: uniqueIndex("unique_deck_city_service").on(table.citySlug, table.serviceSlug),
}));

// Window Company Content Cache for persistent storage
export const windowCompanyContentCache = pgTable("window_company_content_cache", {
  id: serial("id").primaryKey(),
  citySlug: text("city_slug").notNull(),
  serviceSlug: text("service_slug").notNull(),
  contentData: text("content_data").notNull(),
  contentHash: text("content_hash").notNull(),  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueWindowCityService: uniqueIndex("unique_window_city_service").on(table.citySlug, table.serviceSlug),
}));

// Project Content Cache for persistent storage - ALAI "Generate Once, Serve Forever"
export const projectContentCache = pgTable("project_content_cache", {
  id: serial("id").primaryKey(),
  projectSlug: text("project_slug").notNull().unique(),
  projectType: text("project_type").notNull(), // 'siding', 'roofing', 'windows', 'decking'
  contentData: text("content_data").notNull(),
  contentHash: text("content_hash").notNull(),
  seoTitle: text("seo_title").notNull(),
  seoDescription: text("seo_description").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueProjectSlug: uniqueIndex("unique_project_slug").on(table.projectSlug),
}));

// AI Provider Performance Monitoring for optimization
export const aiProviderPerformance = pgTable("ai_provider_performance", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // 'anthropic', 'openai', 'xai'
  model: text("model").notNull(), // 'claude-sonnet-4', 'gpt-4o', 'grok-2-1212'
  citySlug: text("city_slug").notNull(),
  serviceType: text("service_type").notNull(), // 'window-company', 'siding', etc.
  generationTimeMs: integer("generation_time_ms").notNull(),
  contentLength: integer("content_length").notNull(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  costEstimate: text("cost_estimate"), // Cost in USD
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Content cache schemas
export const insertCityContentCacheSchema = createInsertSchema(cityContentCache);
export const insertRoofingContentCacheSchema = createInsertSchema(roofingContentCache);
export const insertDeckContentCacheSchema = createInsertSchema(deckContentCache);
export const insertWindowCompanyContentCacheSchema = createInsertSchema(windowCompanyContentCache);
export const insertProjectContentCacheSchema = createInsertSchema(projectContentCache);
export const insertAiProviderPerformanceSchema = createInsertSchema(aiProviderPerformance);

// AI Performance types
export type AiProviderPerformance = typeof aiProviderPerformance.$inferSelect;
export type InsertAiProviderPerformance = z.infer<typeof insertAiProviderPerformanceSchema>;



export type CityContentCache = typeof cityContentCache.$inferSelect;
export type InsertCityContentCache = z.infer<typeof insertCityContentCacheSchema>;
export type RoofingContentCache = typeof roofingContentCache.$inferSelect;
export type InsertRoofingContentCache = z.infer<typeof insertRoofingContentCacheSchema>;
export type DeckContentCache = typeof deckContentCache.$inferSelect;
export type InsertDeckContentCache = z.infer<typeof insertDeckContentCacheSchema>;
export type WindowCompanyContentCache = typeof windowCompanyContentCache.$inferSelect;
export type InsertWindowCompanyContentCache = z.infer<typeof insertWindowCompanyContentCacheSchema>;
export type ProjectContentCache = typeof projectContentCache.$inferSelect;
export type InsertProjectContentCache = z.infer<typeof insertProjectContentCacheSchema>;

// Google Reviews cache table
export const googleReviews = pgTable("google_reviews", {
  id: serial("id").primaryKey(),
  reviewId: text("review_id").unique(),
  authorName: text("author_name").notNull(),
  authorInitial: text("author_initial").notNull(),
  rating: integer("rating").notNull().default(5),
  text: text("text").notNull(),
  relativeTime: text("relative_time").notNull().default("recent"),
  profilePhotoUrl: text("profile_photo_url"),
  isActive: boolean("is_active").default(true),
  source: text("source").default("google"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoogleReviewSchema = createInsertSchema(googleReviews).omit({ id: true, createdAt: true, updatedAt: true });
export type GoogleReview = typeof googleReviews.$inferSelect;
export type InsertGoogleReview = z.infer<typeof insertGoogleReviewSchema>;

/* ----------------------------------------------------------------
 * GSC submission log (L7 of the playbook).
 *
 * One row per attempted sitemap submission to Google Search Console.
 * Replaces the previous JSONB-in-gsc_state dedup with a normalized,
 * queryable, idempotent log. NEVER drop or rewrite this table — it is
 * the source of truth for "has batch N already been submitted?".
 * ---------------------------------------------------------------- */
export const gscSubmissionLog = pgTable("gsc_submission_log", {
  id: serial("id").primaryKey(),
  siteUrl: text("site_url").notNull(),
  sitemapUrl: text("sitemap_url").notNull(),
  batchNumber: integer("batch_number"),       // null for index sitemap / test slice
  isIndex: boolean("is_index").notNull().default(false),
  isTest: boolean("is_test").notNull().default(false),
  urlCount: integer("url_count").notNull().default(0),
  status: text("status").notNull(),           // 'success' | 'error' | 'skipped'
  errorMessage: text("error_message"),
  responseRaw: jsonb("response_raw"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertGscSubmissionLogSchema = createInsertSchema(gscSubmissionLog).omit({ id: true, submittedAt: true });
export type GscSubmissionLog = typeof gscSubmissionLog.$inferSelect;
export type InsertGscSubmissionLog = z.infer<typeof insertGscSubmissionLogSchema>;

/* ----------------------------------------------------------------
 * GSC INDEXED URL REGISTRY — protection list for already-indexed pages.
 *
 * Source of truth for "is this URL already indexed by Google?".
 * Seeded from the GSC "All known pages" CSV export and topped up over
 * time via the URL Inspection API. Used to:
 *   1. PROTECT indexed URLs from content modification (any editor must
 *      check isIndexed() and surface a warning if true).
 *   2. SKIP indexed URLs from drip re-submission — no point burning
 *      crawl budget re-pinging Google about URLs it already has.
 *   3. REPORT on indexed vs not-indexed coverage in admin dashboards.
 *
 * NEVER drop this table — losing the protection list could lead to
 * accidental mass-modification of GSC-ranked pages.
 * ---------------------------------------------------------------- */
export const gscIndexedUrls = pgTable("gsc_indexed_urls", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),         // full URL including https://
  pathname: text("pathname").notNull(),        // just the path portion, for fast lookup
  lastCrawled: text("last_crawled"),           // YYYY-MM-DD as reported by GSC (nullable)
  source: text("source").notNull().default("gsc-csv-export"),  // 'gsc-csv-export' | 'url-inspection-api' | 'manual'
  protected: boolean("protected").notNull().default(true),     // when true, content editors must warn
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertGscIndexedUrlSchema = createInsertSchema(gscIndexedUrls).omit({ id: true, firstSeenAt: true, lastVerifiedAt: true });
export type GscIndexedUrl = typeof gscIndexedUrls.$inferSelect;
export type InsertGscIndexedUrl = z.infer<typeof insertGscIndexedUrlSchema>;

/* ----------------------------------------------------------------
 * KEYWORD RANKINGS — stores GSC Search Analytics page×query data
 * Synced on demand from admin UI. Never generated on page load.
 * ---------------------------------------------------------------- */
export const keywordRankings = pgTable("keyword_rankings", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  pathname: text("pathname").notNull(),
  keyword: text("keyword").notNull(),
  position: doublePrecision("position").notNull(),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  ctr: doublePrecision("ctr").notNull().default(0),
  dateStart: text("date_start").notNull(),
  dateEnd: text("date_end").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertKeywordRankingSchema = createInsertSchema(keywordRankings).omit({ id: true, syncedAt: true });
export type KeywordRanking = typeof keywordRankings.$inferSelect;
export type InsertKeywordRanking = z.infer<typeof insertKeywordRankingSchema>;

// Import and re-export AI Task Management schema for database creation
export * from "./task-management-schema";