import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { takeBudget } from "../growth-limits";
import { emptyState } from "./audit";
import { siteUrl } from "./http";
import type { Fix } from "./guidance";
export const pageInput = z.object({
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export function reportView(job: any, raw: unknown = {}) {
  if (!job.report) return null;
  const v = pageInput
    .extend({
      category: z
        .enum([
          "",
          "technical",
          "performance",
          "local",
          "content",
          "ai-readiness",
        ])
        .default(""),
      verification: z
        .enum(["", "new", "fixed", "still present", "not checked"])
        .default(""),
    })
    .parse(raw);
  const findings = job.report.findings.filter(
    (f: any) =>
      (!v.category || f.category === v.category) &&
      (!v.q || JSON.stringify(f).toLowerCase().includes(v.q.toLowerCase())),
  );
  const fixes = (job.report.fixes || [])
    .map((f: Fix) => ({ ...f, done: job.fix_done?.[f.key] ?? f.done }))
    .filter(
      (f: Fix) =>
        (!v.verification || f.verification === v.verification) &&
        (!v.q || JSON.stringify(f).toLowerCase().includes(v.q.toLowerCase())) &&
        (!v.category ||
          f.category === v.category ||
          job.report.findings.some(
            (a: any) => a.id === f.findingId && a.category === v.category,
          )),
    );
  return {
    ...job.report,
    findings: findings.slice(v.offset, v.offset + v.limit),
    fixes: fixes.slice(v.offset, v.offset + v.limit),
    findingTotal: findings.length,
    fixTotal: fixes.length,
    offset: v.offset,
    limit: v.limit,
  };
}
export const bulkInput = z
  .object({
    locationIds: z.array(z.number().int().positive()).min(1).max(1000),
    pageCap: z.number().int().min(1).max(500).default(150),
    psiPages: z.number().int().min(0).max(5).default(1),
  })
  .strict();
export async function enqueueLocations(user: number, raw: unknown) {
  const b = bulkInput.parse(raw),
    ids = [...new Set(b.locationIds)];
  const { rows } = await pool.query(
    `SELECT l.id,s.profile_snapshot,s.last_success FROM business_locations l
    JOIN gbp_sync_status s ON s.location_id=l.id AND s.kind='profile' AND s.profile_snapshot IS NOT NULL AND s.last_success IS NOT NULL
    WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL AND l.id=ANY($2::int[])`,
    [user, ids],
  );
  if (rows.length !== ids.length)
    throw new TypeError("Select owned, synced profiles");
  const records = rows.map((r) => {
    const url = siteUrl(r.profile_snapshot.website || "");
    return {
      id: randomUUID(),
      url,
      profile: { ...r.profile_snapshot, id: r.id, synced_at: r.last_success },
      state: emptyState(url),
    };
  });
  // The bulk queue has its own explicit agency budget; provider budgets still apply in the worker.
  if (
    !(await takeBudget("sitescan:bulk:" + user, 1000, records.length, 86400000))
  )
    return null;
  const result = await pool.query(
    `INSERT INTO sitescan_jobs(id,user_id,url,page_cap,psi_pages,profile,state)
    SELECT x.id,$1,x.url,$2,$3,x.profile,x.state FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,url text,profile jsonb,state jsonb) RETURNING id,url`,
    [user, b.pageCap, b.psiPages, JSON.stringify(records)],
  );
  return result.rows;
}
