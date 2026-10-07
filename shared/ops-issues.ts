/**
 * The issue desk (docs/ops/ISSUE-DESK.md): failures the app captures for the
 * people who run ConstructHUB, handed to Claude on the tower for inspection.
 * Shared by the server (server/ops/*) and the admin page (/admin/issues).
 */

export const ISSUE_SOURCES = ["server", "job", "client", "call_assistant", "health"] as const;
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
  event: "reported" | "reopened" | "claimed" | "inspected" | "fix_ready" | "ignored" | "fixed" | "reinspect" | "merged";
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
};

/** A list row (no detail JSON). */
export type OpsIssueRow = Omit<OpsIssue, "detail" | "history" | "fingerprint">;

export const isIssueSource = (v: unknown): v is IssueSource => typeof v === "string" && (ISSUE_SOURCES as readonly string[]).includes(v);
export const isIssueStatus = (v: unknown): v is IssueStatus => typeof v === "string" && (ISSUE_STATUSES as readonly string[]).includes(v);
export const isIssueSeverity = (v: unknown): v is IssueSeverity => typeof v === "string" && (ISSUE_SEVERITIES as readonly string[]).includes(v);
