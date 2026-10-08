/**
 * What a CRM seat may open, in one place for the server's refusals and the
 * client's menus (sidebar, phone ribbon, Create menu, deep-link guard).
 *
 * The server is the gate: every route enforces its own permission through
 * server/crm/tenancy.ts. This file only keeps the MENUS honest — a page whose
 * API refuses the seat is never offered, and a deep link to it shows an
 * "ask your admin" card instead of a page full of failed requests.
 */
import type { CrmPermission } from "./schema";

/** The toggle labels on the Team page — also the wording of every "ask your admin" message and audit line. */
export const CRM_PERMISSION_LABELS: Record<CrmPermission, string> = {
  viewAllJobs: "See all jobs (not just their own)",
  manageJobs: "Create and edit jobs",
  manageCustomers: "Manage clients",
  manageEstimates: "Create and send estimates",
  manageInvoices: "Create and send invoices",
  takePayment: "Take payments",
  seePrices: "See prices",
  seeCosts: "See costs and margins",
  approveChangeOrders: "Approve change orders",
  managePriceBook: "Manage the price book",
  manageTeam: "Manage team and invitations",
  manageSettings: "Manage company settings",
  seeReporting: "See reporting",
  manageIntegrations: "Manage integrations",
  exportData: "Export client data (CSV)",
};

/** A page needs ANY of the listed permissions; an empty list means every member. */
export type CrmPageRule = { match: RegExp; anyOf: readonly CrmPermission[]; title: string };

/**
 * Pages whose own data the API refuses without the permission. Pages that
 * stay open to every member (Home, Clients, Pipeline, Schedule, JobCam, a
 * project, Team & Company for their own profile) are scoped by the server to
 * the member's assigned work and are not listed here.
 */
export const CRM_PAGE_RULES: readonly CrmPageRule[] = [
  { match: /^\/crm\/estimates\/new(\/|$)/, anyOf: ["manageEstimates"], title: "New estimate" },
  { match: /^\/crm\/invoices(\/|$)/, anyOf: ["seePrices"], title: "Invoices" },
  { match: /^\/crm\/pricebook(\/|$)/, anyOf: ["seePrices"], title: "Price book" },
  { match: /^\/crm\/payments(\/|$)/, anyOf: ["seePrices"], title: "Payments" },
  { match: /^\/crm\/inbox(\/|$)/, anyOf: ["manageCustomers"], title: "Messages" },
  { match: /^\/crm\/settings(\/|$)/, anyOf: ["manageSettings"], title: "Settings" },
  { match: /^\/crm\/integrations(\/|$)/, anyOf: ["manageSettings"], title: "Integrations" },
  { match: /^\/crm\/migrate(\/|$)/, anyOf: ["manageCustomers", "manageEstimates", "manageInvoices"], title: "Import" },
];

/**
 * Menu-only rule: the Estimates list is offered to seats that write estimates
 * or may see prices. A price-blind crew member can still open the estimate on
 * one of their own jobs from the job page — scope lines, no money.
 */
export const CRM_ESTIMATES_MENU: readonly CrmPermission[] = ["manageEstimates", "seePrices"];

type PermMap = Partial<Record<string, boolean>> | null | undefined;

export function crmHasAny(perms: PermMap, anyOf: readonly string[] | undefined): boolean {
  if (!anyOf || !anyOf.length) return true;
  return anyOf.some((p) => perms?.[p] === true);
}

/** The rule a path falls under, or null when the page is open to every member. */
export function crmPageRule(path: string): CrmPageRule | null {
  const clean = path.split(/[?#]/)[0];
  return CRM_PAGE_RULES.find((r) => r.match.test(clean)) ?? null;
}

/** Null when the seat may open `path`; otherwise the rule that refuses it. */
export function crmPageRefusal(path: string, perms: PermMap): CrmPageRule | null {
  const rule = crmPageRule(path);
  return rule && !crmHasAny(perms, rule.anyOf) ? rule : null;
}

/** "See prices" / "Manage clients or Create and send estimates" — for the ask-your-admin card. */
export function crmPermissionPhrase(anyOf: readonly CrmPermission[]): string {
  const names = anyOf.map((p) => `“${CRM_PERMISSION_LABELS[p].replace(/ \(.*\)$/, "")}”`);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** Member-record field names as a person reads them (the audit log never prints a column name). */
export const CRM_MEMBER_FIELD_LABELS: Record<string, string> = {
  displayName: "name", title: "title", phone: "phone", avatarUrl: "photo",
  calendarColor: "calendar colour", role: "role", status: "status",
  hourlyCostCents: "cost rate", divisionId: "division", permissions: "permissions",
  smsConsent: "text-message consent",
};

/** Client-record field names for the same audit lines. */
export const CRM_CUSTOMER_FIELD_LABELS: Record<string, string> = {
  displayName: "name", firstName: "first name", lastName: "last name", companyName: "company",
  email: "email", phone: "phone", altPhone: "alternate phone",
  addressLine1: "address", addressLine2: "address line 2", city: "city", state: "state", postalCode: "ZIP",
  billingSameAsService: "billing address", billingLine1: "billing address", billingCity: "billing city",
  billingState: "billing state", billingPostalCode: "billing ZIP",
  leadSourceId: "lead source", ownerMemberId: "owner", notes: "notes", tags: "tags", customFields: "custom fields",
};

/** A raw field key as readable words when no label is registered ("someNewField" → "some new field"). */
export function crmFieldLabel(key: string, labels: Record<string, string>): string {
  return labels[key] ?? key.replace(/Cents$|Bps$|Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
