/**
 * Re-file HOVER captures that piled up on one record.
 *
 * Before the staff guard (server/crm/hover.ts matchOrgMemberContactFields), a capture was attached to whoever
 * owned the job's contact email/phone — and the crew ordering the captures put THEIR own email on the job. So a
 * rep's or the office's record collected every house they scanned (2026-10-17: Andrey Shkurat 247 captures /
 * 2,813 photos, the office Outlook 136, Mike Bakko 57, Braxton 22, George 20, Kurt 10, …).
 *
 * A "collector" is a client holding HOVER captures of 3+ different properties — no homeowner owns that many.
 * Each of its captures at an address other than the collector's own moves to:
 *   - the ONE existing (non-archived) client at that address, else
 *   - a NEW address-only client (the staff contact is never copied; flagged hoverNeedsContact; two+ clients at
 *     the address → new client flagged hoverAmbiguous, exactly as a fresh capture is handled today).
 * The capture's photos (hover-<jobId>-*) and its report PDF move with it. Nothing is deleted; the collector keeps
 * its own address's capture. Every move is returned so it can be logged and reversed.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, pool } from "../db";
import { crmAttachments, crmCustomers, crmMeasurements } from "@shared/schema";
import { matchHoverCustomerByAddress } from "./hover";
import { normalizeHoverAddress } from "./hover-share";
import { divisionIdForAddress } from "./customer-address-state";

export type RefileMove = {
  measurementId: string; hoverJobId: string | null; address: string;
  fromCustomerId: string; fromName: string;
  toCustomerId: string; toName: string; created: boolean; ambiguous: boolean;
  photos: number; pdf: boolean; pdfAttachmentId?: string | null;
};

/** Clients of the org holding HOVER captures of 3+ different properties. */
export async function hoverCollectors(orgId: string): Promise<{ id: string; name: string; properties: number }[]> {
  const { rows } = await pool.query<{ id: string; name: string; properties: string }>(
    `select c.id, c.display_name name, count(distinct lower(trim(m.address_line1))) properties
       from crm_measurements m join crm_customers c on c.id = m.customer_id and c.org_id = m.org_id
      where m.org_id = $1 and m.provider = 'hover' and coalesce(m.address_line1, '') <> ''
      group by c.id, c.display_name having count(distinct lower(trim(m.address_line1))) >= 3
      order by 3 desc`, [orgId]);
  return rows.map((r) => ({ id: r.id, name: r.name, properties: Number(r.properties) }));
}

export async function refileHoverCollectors(orgId: string, opts: { dryRun?: boolean } = {}): Promise<{
  collectors: { id: string; name: string; properties: number }[]; moves: RefileMove[];
}> {
  const collectors = await hoverCollectors(orgId);
  const moves: RefileMove[] = [];
  for (const col of collectors) {
    const [owner] = await db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, col.id)));
    if (!owner) continue;
    const ownKey = normalizeHoverAddress(owner.addressLine1, owner.postalCode);
    const ms = await db.select().from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.provider, "hover"), eq(crmMeasurements.customerId, col.id)));
    for (const m of ms) {
      if (!m.addressLine1?.trim()) continue; // no address: nowhere better to put it
      const key = normalizeHoverAddress(m.addressLine1, m.postalCode);
      if (key && key === ownKey) continue; // the collector's own property stays
      const raw = (m.rawPayload ?? {}) as Record<string, any>;
      const jobId = raw.hoverJobId != null ? String(raw.hoverJobId) : m.externalId ?? null;
      const address = [m.addressLine1, m.city, [m.state, m.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

      const found = (await matchHoverCustomerByAddress(orgId, m.addressLine1, m.postalCode)).matches.filter((c) => c.id !== col.id);
      const ambiguous = found.length > 1;
      let target = found.length === 1 ? found[0] : null;
      let created = false;
      const photoFilter = and(
        eq(crmAttachments.orgId, orgId), eq(crmAttachments.kind, "photo"), eq(crmAttachments.refId, col.id),
        jobId ? sql`${crmAttachments.fileName} like ${`hover-${jobId}-%`}` : sql`false`,
      );
      if (opts.dryRun) {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmAttachments).where(photoFilter);
        moves.push({
          measurementId: m.id, hoverJobId: jobId, address, fromCustomerId: col.id, fromName: col.name,
          toCustomerId: target?.id ?? "(new)", toName: target?.displayName ?? (raw.hoverJobName || m.addressLine1),
          created: !target, ambiguous, photos: n, pdf: !!raw.pdfAttachmentId,
        });
        continue;
      }
      const move = await db.transaction(async (tx) => {
        if (!target) {
          const displayName = (typeof raw.hoverJobName === "string" && raw.hoverJobName.trim()) || m.addressLine1!.trim();
          [target] = await tx.insert(crmCustomers).values({
            orgId, displayName,
            addressLine1: m.addressLine1, city: m.city, state: m.state, postalCode: m.postalCode,
            divisionId: await divisionIdForAddress(orgId, m),
            portalToken: randomBytes(24).toString("hex"),
            notes: `Created from HOVER job ${jobId ?? m.externalId}. Re-filed from ${col.name}: the capture was ordered by your own team — add the homeowner's contact info.`,
            customFields: { hoverAutoCreated: true, hoverNeedsContact: true, hoverRefiledFrom: col.id, ...(ambiguous ? { hoverAmbiguous: true } : {}) },
          } as any).returning();
          created = true;
        }
        const t = target!;
        await tx.update(crmMeasurements).set({
          customerId: t.id,
          rawPayload: { ...raw, matchedVia: created ? null : "address", refiledFrom: col.id, refiledAt: new Date().toISOString() },
          updatedAt: new Date(),
        } as any).where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.id, m.id), eq(crmMeasurements.customerId, col.id)));
        const photos = await tx.update(crmAttachments).set({ refId: t.id }).where(photoFilter).returning({ id: crmAttachments.id });
        let pdf = false;
        if (raw.pdfAttachmentId) {
          const r = await tx.update(crmAttachments).set({ refId: t.id })
            .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.id, String(raw.pdfAttachmentId)), eq(crmAttachments.refId, col.id)))
            .returning({ id: crmAttachments.id });
          pdf = r.length > 0;
        }
        return {
          measurementId: m.id, hoverJobId: jobId, address, fromCustomerId: col.id, fromName: col.name,
          toCustomerId: t.id, toName: t.displayName, created, ambiguous, photos: photos.length, pdf,
          pdfAttachmentId: pdf ? String(raw.pdfAttachmentId) : null,
        } satisfies RefileMove;
      });
      moves.push(move);
    }
  }
  return { collectors, moves };
}

/** Undo a run from its saved moves (newest first): captures, photos and PDFs go back; created clients are archived. */
export async function undoRefile(orgId: string, moves: RefileMove[]): Promise<number> {
  let n = 0;
  for (const mv of [...moves].reverse()) {
    await db.transaction(async (tx) => {
      await tx.update(crmMeasurements).set({ customerId: mv.fromCustomerId } as any)
        .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.id, mv.measurementId)));
      if (mv.hoverJobId) {
        await tx.update(crmAttachments).set({ refId: mv.fromCustomerId }).where(and(
          eq(crmAttachments.orgId, orgId), eq(crmAttachments.refId, mv.toCustomerId),
          sql`${crmAttachments.fileName} like ${`hover-${mv.hoverJobId}-%`}`));
      }
      if (mv.pdfAttachmentId) {
        await tx.update(crmAttachments).set({ refId: mv.fromCustomerId })
          .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.id, mv.pdfAttachmentId)));
      }
      if (mv.created) {
        await tx.update(crmCustomers).set({ archivedAt: new Date() } as any)
          .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, [mv.toCustomerId])));
      }
    });
    n++;
  }
  return n;
}
