/**
 * "Add to all future estimates" — the org's auto-attach file set.
 *
 * The set is plain crm_attachments rows of kind 'estimate_default' (refId
 * null) that SHARE the storagePath of the file they were made from — a Hardie
 * pamphlet ticked on one estimate is one file on disk, however many estimates
 * later carry it. Every new estimate (create, Quick Bid) gets one kind
 * 'estimate' row per default, again pointing at the same storagePath.
 *
 * Because paths are shared, a row delete may unlink the file only when no
 * other row still names it. Every writer that adds a reference to an existing
 * path, and the delete that counts what is left, take the same per-path
 * advisory lock (lockStoragePath) and re-read under it, so a copy can never
 * be minted for a file that a concurrent delete has just unlinked.
 *
 * Kept out of attachments.ts so entities.ts / quickbid.ts can import the
 * helper without pulling the portal/client-auth import graph along.
 */
import { createHash } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { crmActivityLog, crmAttachments, crmEstimates } from "@shared/schema";

export const ESTIMATE_DEFAULT_KIND = "estimate_default";

/** Serialise reference changes on one stored file (transaction-scoped). */
export async function lockStoragePath(tx: any, storagePath: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-attachment-path:${storagePath}`}))`);
}

/** Opaque, stable id for "the same file" so the UI can match an estimate's
 *  file to its auto-attach twin without ever seeing the storage key. */
export function fileKeyOf(storagePath: string): string {
  return createHash("sha256").update(storagePath).digest("hex").slice(0, 16);
}

/**
 * Copy the org's auto-attach files onto a freshly created estimate as kind
 * 'estimate' rows (same storagePath — no file copy). Idempotent: a file the
 * estimate already carries is skipped. NEVER throws — a hiccup here must not
 * fail estimate creation; it is logged and the estimate ships without them.
 * Returns how many files were attached.
 */
export async function attachDefaultFilesToEstimate(orgId: string, estimateId: string): Promise<number> {
  try {
    const defaults = await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.kind, ESTIMATE_DEFAULT_KIND)));
    if (!defaults.length) return 0;
    return await db.transaction(async (tx) => {
      // Sorted lock order — two creates in one org never deadlock each other.
      const paths = [...new Set(defaults.map((d) => d.storagePath))].sort();
      for (const p of paths) await lockStoragePath(tx, p);
      // Re-read under the locks: a default removed (and maybe unlinked) since
      // the first read is not copied.
      const live = await tx.select().from(crmAttachments)
        .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.kind, ESTIMATE_DEFAULT_KIND),
          inArray(crmAttachments.storagePath, paths)));
      const have = new Set((await tx.select({ storagePath: crmAttachments.storagePath }).from(crmAttachments)
        .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.kind, "estimate"),
          eq(crmAttachments.refId, estimateId)))).map((r) => r.storagePath));
      const seen = new Set<string>();
      const rows = live.filter((d) => {
        if (have.has(d.storagePath) || seen.has(d.storagePath)) return false;
        seen.add(d.storagePath);
        return true;
      });
      if (!rows.length) return 0;
      // Each copy keeps the file's ORIGINAL uploader; the attaching itself is
      // logged below as the "Auto-attach" source (nobody picked it by hand).
      const made = await tx.insert(crmAttachments).values(rows.map((d) => ({
        orgId, kind: "estimate", refId: estimateId,
        fileName: d.fileName, mime: d.mime, sizeBytes: d.sizeBytes, storagePath: d.storagePath,
        uploadedByMemberId: d.uploadedByMemberId ?? null, uploadedByLabel: d.uploadedByLabel ?? null,
      }))).returning({ id: crmAttachments.id, fileName: crmAttachments.fileName });
      const [est] = await tx.select({ customerId: crmEstimates.customerId, number: crmEstimates.number })
        .from(crmEstimates).where(and(eq(crmEstimates.id, estimateId), eq(crmEstimates.orgId, orgId))).limit(1);
      await tx.insert(crmActivityLog).values(made.map((m) => ({
        orgId, actorMemberId: null, actorLabel: "Auto-attach", action: "attachment.auto_attached",
        entityType: "attachment", entityId: m.id, customerId: est?.customerId ?? null,
        meta: { kind: "estimate", fileName: m.fileName, number: est?.number ?? null },
      })));
      return rows.length;
    });
  } catch (e: any) {
    console.error(`[crm] auto-attach defaults failed for estimate ${estimateId} (org ${orgId}):`,
      String(e?.message || e).slice(0, 300));
    return 0;
  }
}
