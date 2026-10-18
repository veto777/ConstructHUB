/**
 * The CRM client page's containers, in the order the owner wants them read (2026-10-18: the bid first, then the
 * HOVER report; invoices and payments last). Identity, Job stage and Quick actions always sit at the top and are
 * not part of this. Owners/admins reorder and hide containers for the whole account (Settings → Client page);
 * the choice is stored in crm_orgs.custom_fields.clientPageLayout.
 */
export const CLIENT_SECTIONS = [
  { key: "estimates", label: "Estimates" },
  { key: "hover", label: "HOVER report" },
  { key: "schedule", label: "Schedule" },
  { key: "projects", label: "Projects" },
  { key: "measurements", label: "Measurements" },
  { key: "photos", label: "Project photos" },
  { key: "jobcam", label: "JobCam" },
  { key: "messages", label: "Messages" },
  { key: "comments", label: "Client comments & pamphlets" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "documents", label: "Documents (estimates, contracts, invoices, receipts)" },
] as const;
export type ClientSectionKey = (typeof CLIENT_SECTIONS)[number]["key"];
export type ClientPageLayout = { order: ClientSectionKey[]; hidden: ClientSectionKey[] };

const KEYS = CLIENT_SECTIONS.map((s) => s.key) as ClientSectionKey[];
const isKey = (k: unknown): k is ClientSectionKey => typeof k === "string" && (KEYS as string[]).includes(k);

export const DEFAULT_CLIENT_PAGE_LAYOUT: ClientPageLayout = { order: [...KEYS], hidden: [] };

/** A stored layout made whole (pure): unknown keys dropped, missing sections appended in default order, no repeats. */
export function normalizeClientPageLayout(raw: unknown): ClientPageLayout {
  const r = (raw && typeof raw === "object" ? raw : {}) as { order?: unknown; hidden?: unknown };
  const order: ClientSectionKey[] = [];
  for (const k of Array.isArray(r.order) ? r.order : []) if (isKey(k) && !order.includes(k)) order.push(k);
  for (const k of KEYS) if (!order.includes(k)) order.push(k);
  const hidden: ClientSectionKey[] = [];
  for (const k of Array.isArray(r.hidden) ? r.hidden : []) if (isKey(k) && !hidden.includes(k)) hidden.push(k);
  return { order, hidden };
}

export const sectionLabel = (k: ClientSectionKey) => CLIENT_SECTIONS.find((s) => s.key === k)?.label ?? k;
