/**
 * Owner notification when a NEW HOVER report lands in the CRM (owner, 2026-10-19). Fired once, from the HOVER
 * intake, after the report row exists and its client / project are settled — never for a duplicate delivery of a
 * report the CRM already holds (the intake returns `duplicate` before reaching here).
 *
 * Audience: the org's active owner seat(s) — bell + iPhone push (notifyMembers), email when that channel is on
 * (notifyOrgOwners), text when the owner turned it on. Scope: the states in Settings → Notifications → "New HOVER
 * report" (shared/hover-notify.ts); Alpine's is WA.
 *
 * Best-effort: nothing here may break the intake.
 */
import { db } from "../db";
import { crmCustomers, crmOrgs } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { hoverReportWanted } from "@shared/hover-notify";
import { notifyOrgOwners } from "./owner-notify";

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

export type HoverReportForNotice = {
  id: string;
  customerId: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  rawPayload?: unknown;
};

/** The words of the notification, pure so the test can read them. */
export function hoverReportNotice(args: {
  report: HoverReportForNotice;
  customerName: string | null;
  state: string | null;
}): { title: string; body: string; link: string | null } {
  const r = args.report;
  const where = [r.addressLine1, [r.city, args.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const who = args.customerName ?? (r.rawPayload as any)?.hoverJobName ?? null;
  const tag = args.state ? args.state.toUpperCase() : "state unknown";
  const title = `New HOVER report — ${who ?? where ?? "unlinked capture"} (${tag})`;
  const body = [who && where ? where : null, args.customerName ? null : "Not matched to a client yet — open it to file it."]
    .filter(Boolean).join(" ");
  const link = r.customerId ? `/crm/clients/${r.customerId}` : `/crm/photos`;
  return { title, body, link };
}

export async function notifyHoverReportReady(orgId: string, report: HoverReportForNotice): Promise<boolean> {
  try {
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
    if (!org) return false;
    let customerName: string | null = null;
    let state: string | null = report.state ? String(report.state).trim().toUpperCase() : null;
    if (report.customerId) {
      const [c] = await db.select({ displayName: crmCustomers.displayName, state: crmCustomers.state }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, report.customerId))).limit(1);
      if (c) {
        customerName = c.displayName ?? null;
        if (!state && c.state) state = String(c.state).trim().toUpperCase();
      }
    }
    if (!hoverReportWanted(org.customFields, state)) return false;
    const n = hoverReportNotice({ report, customerName, state });
    return await notifyOrgOwners({
      org, pref: "hoverReportReady", subject: n.title,
      bodyHtml: `<p style="font-size:15px;margin:0 0 8px">${esc(n.title)}</p>` + (n.body ? `<p style="color:#555;margin:0">${esc(n.body)}</p>` : ""),
      link: n.link ? `${process.env.PUBLIC_BASE_URL ?? ""}${n.link}` : undefined,
      linkLabel: report.customerId ? "Open the client" : "Open the CRM",
    });
  } catch (e: any) {
    console.error("[hover] report notification failed:", e?.message || e);
    return false;
  }
}
