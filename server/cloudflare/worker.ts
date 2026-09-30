import { pool } from "../db";
import {
  cfFor,
  discoverZones,
  cloudflareAnalytics,
  applyAction,
} from "./service";
import {
  discoverProperties,
  syncProperty,
  analyticsPage,
  inspectUrl,
  gscFor,
} from "../gsc/service";
import { CloudflareClient } from "./client";
import { ProviderError, mapLocations, domain, queue } from "./common";
import { sendWithFallback } from "../email";
import { logActivity, notifyUser } from "../account-events";
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function deliverInvite(
  inv: any,
  agency: string,
  accepted = false,
) {
  const text = accepted
    ? `ConstructHUB now has access to ${inv.domain}. You can revoke access in ${inv.provider === "gsc" ? "Search Console → Settings → Users and permissions" : "Cloudflare → Manage Account → Members"}.`
    : inv.provider === "gsc"
      ? `For ${inv.domain}, open Search Console → Settings → Users and permissions → Add user. Enter ${agency}, choose Full, and add. ConstructHUB checks for the property in the background. General pages use sitemaps and inspection monitoring, not the Indexing API.`
      : `For ${inv.domain}, open Cloudflare → Manage Account → Members → Invite. Invite ${agency}. Scope to the site's zone and assign the domain-scoped Domain Administrator role. This grants full domain access, including DNS; use a scoped token if that is too broad. Analytics and Firewall roles apply account-wide. Avoid Super Administrator and billing access. Enable API access. ConstructHUB will accept the membership and discover the zone. If these roles are unavailable, use a scoped API token instead.`;
  const result = await sendWithFallback({
    to: inv.email,
    subject: accepted
      ? "ConstructHUB site access accepted"
      : "Connect your site to ConstructHUB",
    text,
    html: `<p>${esc(text)}</p>`,
  });
  if (result && "success" in result && !result.success)
    throw new ProviderError("Invitation email could not be delivered");
}
export async function memberships(
  c: any,
  http: typeof fetch = fetch,
  page = 1,
  status: "pending" | "accepted" = "pending",
) {
  if (
    c.user_id !== Number(process.env.CLOUDFLARE_AGENCY_USER_ID) ||
    !process.env.CLOUDFLARE_AGENCY_TOKEN
  )
    throw new ProviderError("Agency Cloudflare access is not configured", 503);
  const client = new CloudflareClient(
    { token: process.env.CLOUDFLARE_AGENCY_TOKEN },
    http,
  );
  const d = await client.call(
    `/memberships?status=${status}&page=${page}&per_page=50`,
  );
  for (const m of d.result ?? []) {
    // Only explicitly onboarded accounts for the configured agency owner may be accepted.
    const {
      rows: [inv],
    } = await pool.query(
      "SELECT * FROM edge_invites WHERE user_id=$1 AND provider='cloudflare' AND account_id=$2 AND state='pending' ORDER BY id LIMIT 1",
      [c.user_id, m.account?.id],
    );
    if (!inv) continue;
    if (status === "pending")
      await client.call(`/memberships/${m.id}`, "PUT", { status: "accepted" });
    const {
      rows: [connection],
    } = await pool.query(
      `INSERT INTO edge_connections(user_id,provider,subject,email,method,permissions)
      VALUES($1,'cloudflare',$2,$3,'member',$4) ON CONFLICT(user_id,provider,subject) DO UPDATE SET email=$3 RETURNING id`,
      [
        c.user_id,
        m.account.id,
        process.env.CLOUDFLARE_AGENCY_EMAIL,
        JSON.stringify(m.roles ?? []),
      ],
    );
    await queue(c.user_id, connection.id, null, "discover");
    await pool.query(
      `WITH accepted AS (
      UPDATE edge_invites SET state='accepted',connection_id=$2 WHERE id=$1 AND state='pending' RETURNING id,user_id
    ) INSERT INTO edge_jobs(user_id,connection_id,kind,payload)
      SELECT user_id,$2,'accepted-email',jsonb_build_object('inviteId',id) FROM accepted`,
      [inv.id, connection.id],
    );
    await logActivity(null, c.user_id, "cloudflare.connected", {
      method: "member",
      accountId: m.account.id,
    });
    await notifyUser(c.user_id, "cloudflare.connected", {
      title: "Cloudflare membership accepted",
      body: inv.domain,
      link: "/cloudflare",
    });
  }
  if (page < Number(d.result_info?.total_pages ?? 1))
    await queue(c.user_id, c.id, null, "memberships", {
      page: page + 1,
      status,
    });
  else if (status === "pending")
    await queue(c.user_id, c.id, null, "memberships", {
      page: 1,
      status: "accepted",
    });
}
export async function completeInvites(c: any) {
  await pool.query(
    `WITH accepted AS (
    UPDATE edge_invites i SET state='accepted' WHERE user_id=$1 AND provider=$2 AND state='pending'
    AND EXISTS(SELECT 1 FROM edge_assets a WHERE a.user_id=i.user_id AND a.connection_id=$3 AND a.domain=i.domain AND a.status NOT IN ('access_removed','siteRestrictedUser')) RETURNING id,user_id
  ) INSERT INTO edge_jobs(user_id,connection_id,kind,payload)
    SELECT user_id,$3,'accepted-email',jsonb_build_object('inviteId',id) FROM accepted`,
    [c.user_id, c.provider, c.id],
  );
}
/** One leased job per tick; connection advisory lock serializes disconnect and worker writes. */
export async function runEdgeJob(http: typeof fetch = fetch, owner?: number) {
  const db = await pool.connect();
  let job: any;
  let locked = false;
  let lockedId: number | undefined;
  try {
    // Read-only jobs can recover; an interrupted provider write needs reconciliation, never blind replay.
    await db.query(`WITH stale AS (UPDATE edge_jobs SET state=CASE WHEN kind IN ('apply','undo','sitemap','memberships','invite','accepted-email') THEN 'uncertain' ELSE 'queued' END,
      error='Worker interrupted; review provider state before retrying' WHERE state='running' AND started_at<now()-interval '15 minutes' RETURNING *)
      UPDATE edge_actions a SET state='uncertain' FROM stale j WHERE j.kind IN ('apply','undo') AND a.id::text=j.payload->>'actionId' AND a.user_id=j.user_id`);
    const {
      rows: [candidate],
    } = await db.query(
      `SELECT j.* FROM edge_jobs j WHERE state='queued' AND available_at<=now() AND ($1::int IS NULL OR user_id=$1) ORDER BY available_at,id LIMIT 1`,
      [owner ?? null],
    );
    if (!candidate) return false;
    lockedId = candidate.connection_id;
    locked = (
      await db.query("SELECT pg_try_advisory_lock(8275,$1) locked", [
        candidate.connection_id,
      ])
    ).rows[0].locked;
    if (!locked) return false;
    job = (
      await db.query(
        "UPDATE edge_jobs SET state='running',started_at=now(),attempts=attempts+1 WHERE id=$1 AND state='queued' RETURNING *",
        [candidate.id],
      )
    ).rows[0];
    if (!job) return false;
    const c = (
      await db.query(
        "SELECT * FROM edge_connections WHERE id=$1 AND user_id=$2",
        [job.connection_id, job.user_id],
      )
    ).rows[0];
    if (!c) throw new ProviderError("Connection removed", 404);
    const a = job.asset_id
      ? (
          await db.query(
            "SELECT * FROM edge_assets WHERE id=$1 AND user_id=$2 AND connection_id=$3",
            [job.asset_id, job.user_id, c.id],
          )
        ).rows[0]
      : null;
    if (job.asset_id && !a) throw new ProviderError("Asset removed", 404);
    if (job.kind === "discover") {
      if (c.provider === "gsc") await discoverProperties(c, http);
      else await discoverZones(c, job.payload.page ?? 1, http);
      await completeInvites(c);
    } else if (job.kind === "sync") {
      if (c.provider === "gsc") await syncProperty(c, a, job.payload, http);
      else
        await db.query(
          "UPDATE edge_assets SET data=$1,synced_at=now(),error=NULL WHERE id=$2 AND user_id=$3",
          [
            JSON.stringify(await cloudflareAnalytics(c, a, http)),
            a.id,
            c.user_id,
          ],
        );
    } else if (job.kind === "analytics")
      await analyticsPage(c, a, job.payload, http);
    else if (job.kind === "inspect")
      await inspectUrl(c, a, job.payload.url, http);
    else if (job.kind === "sitemap")
      await gscFor(c, http).call(
        `/sites/${encodeURIComponent(a.external_id)}/sitemaps/${encodeURIComponent(job.payload.url)}`,
        "PUT",
      );
    else if (job.kind === "apply" || job.kind === "undo") {
      const action = (
        await db.query(
          "SELECT * FROM edge_actions WHERE id=$1 AND user_id=$2 AND asset_id=$3",
          [job.payload.actionId, c.user_id, a.id],
        )
      ).rows[0];
      if (!action) throw new ProviderError("Preview removed", 404);
      await applyAction(c, a, action, job.kind === "undo", http);
    } else if (job.kind === "memberships")
      await memberships(
        c,
        http,
        job.payload.page ?? 1,
        job.payload.status ?? "pending",
      );
    else if (job.kind === "invite" || job.kind === "accepted-email") {
      const inv = (
        await db.query(
          "SELECT * FROM edge_invites WHERE id=$1 AND user_id=$2 AND state=$3",
          [
            job.payload.inviteId,
            c.user_id,
            job.kind === "accepted-email" ? "accepted" : "pending",
          ],
        )
      ).rows[0];
      if (inv)
        await deliverInvite(
          inv,
          c.provider === "gsc" ? c.email : process.env.CLOUDFLARE_AGENCY_EMAIL!,
          job.kind === "accepted-email",
        );
    } else throw new ProviderError("Unknown queued operation", 400);
    await db.query(
      "UPDATE edge_jobs SET state='done',finished_at=now(),error=NULL WHERE id=$1",
      [job.id],
    );
    return true;
  } catch (e) {
    if (!job) throw e;
    const message =
      e instanceof ProviderError
        ? e.message
        : "Provider work failed; retry from the site dashboard";
    const read = ["discover", "sync", "analytics", "inspect"].includes(
      job.kind,
    );
    const retry =
      read &&
      job.attempts < 5 &&
      (!(e instanceof ProviderError) ||
        ![400, 401, 403, 404].includes(e.status));
    await db.query(
      "UPDATE edge_jobs SET state=$2,error=$3,available_at=now()+($4*interval '1 second'),finished_at=CASE WHEN $2='queued' THEN NULL ELSE now() END WHERE id=$1",
      [
        job.id,
        retry ? "queued" : read ? "failed" : "uncertain",
        message,
        e instanceof ProviderError && e.status === 429
          ? 3600
          : Math.min(3600, 30 * 2 ** job.attempts),
      ],
    );
    if (job.asset_id)
      await db.query(
        "UPDATE edge_assets SET error=$1 WHERE id=$2 AND user_id=$3",
        [message, job.asset_id, job.user_id],
      );
    if (["apply", "undo"].includes(job.kind))
      await db.query(
        "UPDATE edge_actions SET state='uncertain' WHERE id=$1 AND user_id=$2",
        [job.payload.actionId, job.user_id],
      );
    return true;
  } finally {
    if (locked)
      await db
        .query("SELECT pg_advisory_unlock(8275,$1)", [lockedId])
        .catch(() => {});
    db.release();
  }
}
export async function scheduleEdgeDiscovery() {
  await pool.query(`INSERT INTO edge_jobs(user_id,connection_id,kind)
    SELECT c.user_id,c.id,CASE WHEN method='agency' THEN 'memberships' ELSE 'discover' END FROM edge_connections c
    WHERE NOT EXISTS(SELECT 1 FROM edge_jobs j WHERE j.connection_id=c.id AND j.kind IN ('discover','memberships') AND (j.state IN ('queued','running') OR j.started_at>now()-interval '1 hour')) ON CONFLICT DO NOTHING`);
}
export function startEdgeWorker() {
  if (process.env.EDGE_SEARCH_WORKER_ENABLED !== "true") return;
  let busy = false,
    last = 0;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (Date.now() - last > 60000) {
        await scheduleEdgeDiscovery();
        last = Date.now();
      }
      await runEdgeJob();
    } catch {
      console.error("[edge-search] worker failed");
    } finally {
      busy = false;
    }
  }, 1000);
  timer.unref();
}
