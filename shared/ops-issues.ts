/**
 * The issue desk (docs/ops/ISSUE-DESK.md): failures the app captures for the
 * people who run ConstructHUB, handed to Claude on the tower for inspection.
 * Shared by the server (server/ops/*) and the admin page (/admin/issues).
 */

/** "user": a person's own report from /report-issue (server/ops/user-reports.ts) — never merged, always first in a run. */
export const ISSUE_SOURCES = ["server", "job", "client", "call_assistant", "health", "user"] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const ISSUE_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * new → (the tower claims it) inspecting → inspected | fix_ready | ignored (Claude's verdict)
 * → fixed | ignored (an admin). A fixed issue that happens again goes back to new.
 */
/** "triage": a browser report — anonymous internet input — waits for an admin's "Send to Claude" before any run sees it. */
export const ISSUE_STATUSES = ["triage", "new", "inspecting", "inspected", "fix_ready", "fixed", "ignored"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** The verdicts Claude may report (POST /api/ops-internal/issues/:id/report). */
export const ISSUE_REPORT_STATUSES = ["inspected", "fix_ready", "ignored"] as const;
export type IssueReportStatus = (typeof ISSUE_REPORT_STATUSES)[number];

/** What an admin may set from /admin/issues: Mark fixed, Ignore, Re-inspect. */
export const ISSUE_ADMIN_STATUSES = ["fixed", "ignored", "new"] as const;
export type IssueAdminStatus = (typeof ISSUE_ADMIN_STATUSES)[number];

export const ISSUE_SOURCE_LABELS: Record<IssueSource, string> = {
  server: "Server",
  job: "Background job",
  client: "Browser",
  call_assistant: "Call Assistant",
  health: "Health check",
  user: "User report",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  triage: "Needs review",
  new: "New",
  inspecting: "Inspecting",
  inspected: "Inspected",
  fix_ready: "Fix ready",
  fixed: "Fixed",
  ignored: "Ignored",
};

/** One entry of an issue's timeline (ops_issues.history). */
export type IssueHistoryEntry = {
  at: string;
  event: "reported" | "reopened" | "claimed" | "inspected" | "fix_ready" | "ignored" | "fixed" | "reinspect" | "merged"
    /** user reports: a run ended before the report was inspected (back to new, first next run) · a run was skipped for the daily cap · a reply was written for the reporter */
    | "released" | "deferred" | "public_reply";
  /** "claude", "issue desk" or a masked admin email. */
  by?: string;
  /** "merged": which duplicate rows were folded into this one. */
  note?: string;
};

/** An issue as the admin API and the internal API send it. */
export type OpsIssue = {
  id: number;
  fingerprint: string;
  source: IssueSource;
  severity: IssueSeverity;
  title: string;
  detail: Record<string, unknown>;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: IssueStatus;
  report: string | null;
  branch: string | null;
  inspectedAt: string | null;
  claimedAt: string | null;
  history: IssueHistoryEntry[];
  /** User reports only (source "user"): who sent it, and the plain-language answer they read under "Your reports". */
  reporterUserId: number | null;
  reporterEmail: string | null;
  publicReply: string | null;
  publicReplyAt: string | null;
};

/** A list row (no detail JSON). */
export type OpsIssueRow = Omit<OpsIssue, "detail" | "history" | "fingerprint">;

export const isIssueSource = (v: unknown): v is IssueSource => typeof v === "string" && (ISSUE_SOURCES as readonly string[]).includes(v);
export const isIssueStatus = (v: unknown): v is IssueStatus => typeof v === "string" && (ISSUE_STATUSES as readonly string[]).includes(v);
export const isIssueSeverity = (v: unknown): v is IssueSeverity => typeof v === "string" && (ISSUE_SEVERITIES as readonly string[]).includes(v);

// ── User reports (/report-issue) ──────────────────────────────────────────────

/** "How bad is it?" on the report form. */
export const USER_REPORT_IMPACTS = ["blocker", "broken", "minor"] as const;
export type UserReportImpact = (typeof USER_REPORT_IMPACTS)[number];

export const USER_REPORT_IMPACT_LABELS: Record<UserReportImpact, string> = {
  blocker: "I can’t use the site",
  broken: "Something is broken but I can work around it",
  minor: "Small problem or suggestion",
};

/** A blocker is the pipeline's highest severity: it is claimed before everything else. */
export const USER_REPORT_SEVERITY: Record<UserReportImpact, IssueSeverity> = { blocker: "critical", broken: "error", minor: "info" };

/** What the reporter is shown; the pipeline's own statuses stay internal. */
export const PUBLIC_REPORT_STATUSES = ["received", "looking", "fix_ready", "fixed", "not_a_bug"] as const;
export type PublicReportStatus = (typeof PUBLIC_REPORT_STATUSES)[number];

export const PUBLIC_REPORT_STATUS_LABELS: Record<PublicReportStatus, string> = {
  received: "Received",
  looking: "Being looked at",
  fix_ready: "Fix ready",
  fixed: "Fixed",
  not_a_bug: "Not a bug",
};

/** Received (waiting for a run) → Being looked at (claimed, or inspected without a fix yet) → Fix ready → Fixed / Not a bug. */
export function publicReportStatus(status: IssueStatus): PublicReportStatus {
  switch (status) {
    case "inspecting": case "inspected": return "looking";
    case "fix_ready": return "fix_ready";
    case "fixed": return "fixed";
    case "ignored": return "not_a_bug";
    default: return "received";
  }
}

/** One of the reporter's own reports (GET /api/issues/mine). */
export type MyIssueReport = {
  id: number;
  trying: string;
  impact: UserReportImpact;
  status: PublicReportStatus;
  statusLabel: string;
  createdAt: string;
  reply: string | null;
  repliedAt: string | null;
};

/** What the browser sends with a report — exactly what the page's "What we send with your report" box shows. */
export type UserReportDiagnostics = {
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  language?: string;
  timezone?: string;
  time: string;
  recentErrors: { kind: string; message: string; at: string; source?: string }[];
};
