import { randomUUID, createHash } from "node:crypto";
import { pool } from "../db";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { takeBudget } from "../growth-limits";
import { logActivity, notifyUser } from "../account-events";
import { porkbun } from "./adapters/porkbun";
import { namecom } from "./adapters/namecom";
import {
  canonical,
  emailWarning,
  changeInput,
  desired,
  DomainError,
  type Change,
  type DomainState,
  type RegistrarAdapter,
} from "./types";
import { dnsSnapshot, verify, normalize } from "./dns";
import { websiteHealth, type Health } from "./health";
import { getEntitlements } from "../entitlements";
import { MODULE_NAMES, PLANS, planForModule } from "@shared/plans";
/** Queued domain work and daily monitoring run only while the owner's plan includes the module. */
export const domainsAllowed = async (user: number) =>
  (await getEntitlements(user)).modules.domainsMailAlerts;
export const DOMAINS_PLAN_PAUSED = `Not run: ${MODULE_NAMES.domainsMailAlerts} is included with the ${PLANS[planForModule("domainsMailAlerts")].name} plan.`;
/** A change already made at the registrar was run; only the follow-up DNS check stopped. */
export const DOMAINS_VERIFY_PAUSED = `Applied at the registrar, but verification stopped: ${MODULE_NAMES.domainsMailAlerts} is included with the ${PLANS[planForModule("domainsMailAlerts")].name} plan.`;
export type Dependencies = {
  adapter?: (connection: any) => RegistrarAdapter;
  http?: typeof fetch;
  health?: (domain: string) => Promise<Health>;
};
export async function limitedFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  // Shared per-project ceiling, across all a7 workers. Requests are never retried blindly.
  while (!(await takeBudget("domain-external", 120, 1, 60000)))
    await new Promise((resolve) => setTimeout(resolve, 1000));
  while (!(await takeBudget("domain-external-second", 2, 1, 1000)))
    await new Promise((resolve) => setTimeout(resolve, 250));
  return fetch(input, init);
}
function adapter(c: any, deps: Dependencies) {
  if (deps.adapter) return deps.adapter(c);
  const keys = JSON.parse(decryptToken(c.credentials)!);
  return c.provider === "porkbun"
    ? porkbun(keys, limitedFetch)
    : namecom(keys, limitedFetch);
}
export async function enqueue(
  userId: number,
  kind: string,
  payload: object = {},
  domainId?: number,
  connectionId?: number,
  status = "queued",
) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO domain_jobs(id,user_id,kind,payload,domain_id,connection_id,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, userId, kind, payload, domainId || null, connectionId || null, status],
  );
  return id;
}
export async function saveConnection(
  userId: number,
  provider: string,
  label: string,
  key: string,
  secret: string,
) {
  const {
    rows: [c],
  } = await pool.query(
    "INSERT INTO domain_connections(user_id,provider,label,credentials) VALUES($1,$2,$3,$4) RETURNING id",
    [userId, provider, label, encryptToken(JSON.stringify({ key, secret }))],
  );
  await enqueue(userId, "discover", {}, undefined, c.id);
  return c.id;
}
/** Recorded on queued registrar work whose API key was removed before it ran. */
export const CONNECTION_REMOVED =
  "Not run: the registrar API key was removed from ConstructHUB.";
/** A change already made at the registrar; only its follow-up DNS check stopped. */
export const CONNECTION_REMOVED_VERIFY =
  "Applied at the registrar, but verification stopped: the registrar API key was removed from ConstructHUB.";
/** Where each registrar's own key management lives (see guides.ts). */
const REGISTRAR_KEY_PAGE: Record<string, [string, string]> = {
  porkbun: ["Porkbun", "Account → API Access"],
  namecom: ["Name.com", "API token management"],
};
/**
 * Delete a saved registrar API key (domain_connections) for its owner. The
 * domain worker's lock is taken first, so no registrar call is in flight with
 * these credentials. Domains stay listed (their connection is cleared by the
 * foreign key) and keep DNS and website monitoring; queued registrar work that
 * has not run is closed with CONNECTION_REMOVED; job history is kept. The key
 * itself still works at the registrar until the owner deletes it there, and
 * the message says so.
 */
export async function disconnectConnection(userId: number, id: number) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '15s'");
    try {
      await c.query("SELECT pg_advisory_xact_lock(8189,7)");
    } catch (e: any) {
      if (e?.code === "55P03")
        throw new DomainError(
          "A domain job is running. Try again in a minute.",
          409,
        );
      throw e;
    }
    const {
      rows: [conn],
    } = await c.query(
      "SELECT id,provider,label FROM domain_connections WHERE user_id=$1 AND id=$2 FOR UPDATE",
      [userId, id],
    );
    if (!conn) throw new DomainError("Connection not found", 404);
    const { rows: closed } = await c.query(
      `UPDATE domain_jobs SET status=CASE WHEN status='verifying' THEN 'verification_failed' ELSE 'failed' END,
         error=CASE WHEN status='verifying' THEN $4 ELSE $3 END,updated_at=now()
       WHERE user_id=$1 AND connection_id=$2 AND kind<>'monitor' AND status IN ('queued','previewing','ready','working','verifying')
       RETURNING status`,
      [userId, id, CONNECTION_REMOVED, CONNECTION_REMOVED_VERIFY],
    );
    const stopped = closed.filter((j) => j.status === "failed").length,
      unverified = closed.length - stopped;
    // Keep every job's history: detach it before the connection row goes (the FK would cascade).
    await c.query(
      "UPDATE domain_jobs SET connection_id=NULL WHERE user_id=$1 AND connection_id=$2",
      [userId, id],
    );
    await c.query(
      "DELETE FROM domain_connections WHERE user_id=$1 AND id=$2",
      [userId, id],
    );
    await c.query("COMMIT");
    const [name, where] = REGISTRAR_KEY_PAGE[conn.provider] ?? [
      "the registrar",
      "its API settings",
    ];
    const notes = [
      stopped
        ? `${stopped} queued ${stopped === 1 ? "task for this key was" : "tasks for this key were"} stopped before reaching ${name}.`
        : "",
      unverified
        ? `${unverified} applied ${unverified === 1 ? "change is" : "changes are"} no longer verified here; check ${unverified === 1 ? "it" : "them"} at ${name}.`
        : "",
    ].filter(Boolean);
    return {
      id: Number(conn.id),
      provider: conn.provider as string,
      label: conn.label as string,
      message: [
        `Removed "${conn.label}" from ConstructHUB. The key still works at ${name} until you delete it there (${where}).`,
        "Your domains stay listed with DNS and website monitoring; registrar details are no longer refreshed and DNS changes need a connected key.",
        ...notes,
      ].join(" "),
    };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function autoMapDomains(userId: number) {
  await pool.query(
    `WITH matches AS (
  SELECT d.id,min(l.id) location_id FROM managed_domains d JOIN business_locations l ON l.user_id=d.user_id
   AND substring(lower(l.website) from '^https?://([^/:?#]+)') IN (d.domain,'www.'||d.domain)
  WHERE d.user_id=$1 AND d.location_id IS NULL GROUP BY d.id HAVING count(*)=1
 ) UPDATE managed_domains d SET location_id=m.location_id FROM matches m WHERE d.id=m.id`,
    [userId],
  );
}
export async function ownedDomains(userId: number, ids: number[]) {
  const { rows } = await pool.query(
    "SELECT * FROM managed_domains WHERE user_id=$1 AND id=ANY($2::bigint[]) ORDER BY id",
    [userId, ids],
  );
  if (rows.length !== new Set(ids).size)
    throw new DomainError("Domain not found", 404);
  return rows;
}
export async function preview(userId: number, ids: number[], change: Change) {
  const rows = await ownedDomains(userId, ids);
  if (rows.some((d) => !d.connection_id))
    throw new DomainError("Manual domains must be changed at the registrar.");
  const jobs = [];
  for (const d of rows)
    jobs.push(
      await enqueue(
        userId,
        "change",
        { change },
        d.id,
        d.connection_id,
        "previewing",
      ),
    );
  return jobs;
}
export async function rollbackPreview(userId: number, jobId: string) {
  const {
    rows: [job],
  } = await pool.query(
    "SELECT * FROM domain_jobs WHERE user_id=$1 AND id=$2 AND kind='change' AND status IN ('verified','verifying','verification_failed','uncertain')",
    [userId, jobId],
  );
  if (!job?.before_state || !job.result?.inverse)
    throw new DomainError("No rollback snapshot available", 404);
  return preview(userId, [Number(job.domain_id)], job.result.inverse);
}
export async function confirm(
  userId: number,
  ids: string[],
  warningAccepted: boolean,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      "SELECT * FROM domain_jobs WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",
      [userId, ids],
    );
    if (
      rows.length !== new Set(ids).size ||
      rows.some(
        (j) =>
          j.status !== "ready" || new Date(j.expires_at).getTime() < Date.now(),
      )
    )
      throw new DomainError(
        "Preview expired or changed. Create a new preview.",
        409,
      );
    if (
      rows.some((j) => emailWarning(j.payload.change, j.before_state)) &&
      !warningAccepted
    )
      throw new DomainError("Acknowledge the email/DNS interruption warning.");
    await c.query(
      "UPDATE domain_jobs SET status='queued',updated_at=now(),expires_at=now()+interval '10 minutes' WHERE user_id=$1 AND id=ANY($2::uuid[])",
      [userId, ids],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function alert(d: any, key: string, title: string) {
  const { rowCount } = await pool.query(
    "INSERT INTO domain_alert_dedup(user_id,domain_id,key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [d.user_id, d.id, key],
  );
  if (rowCount) {
    await logActivity(null, d.user_id, "domains.monitor", {
      domainId: d.id,
      alert: title,
    });
    await notifyUser(d.user_id, "domains.monitor", {
      title,
      body: d.domain,
      link: "/domains",
      severity: "warning",
    });
  }
}
export async function monitor(d: any, deps: Dependencies) {
  const observed = await dnsSnapshot(
      d.domain,
      d.state,
      deps.http || limitedFetch,
    ),
    health = await (deps.health || websiteHealth)(d.domain);
  if (d.observed && canonical(d.observed) !== canonical(observed)) {
    const nsChanged =
      canonical(d.observed[`${d.domain}:NS`]) !==
      canonical(observed[`${d.domain}:NS`]);
    const {
      rows: [pending],
    } = await pool.query(
      "SELECT id FROM domain_jobs WHERE domain_id=$1 AND kind='change' AND status IN ('applying','verifying') LIMIT 1",
      [d.id],
    );
    if (!pending)
      await alert(
        d,
        `dns:${createHash("sha256").update(canonical(observed)).digest("hex")}`,
        nsChanged
          ? "Domain nameservers changed outside ConstructHUB"
          : "Domain DNS changed outside ConstructHUB",
      );
  }
  const days = d.state?.expires
    ? Math.ceil((Date.parse(d.state.expires) - Date.now()) / 86400000)
    : null;
  if (days !== null) {
    const threshold = [7, 30, 60].find((t) => days <= t);
    if (threshold)
      await alert(
        d,
        `expiry:${d.state.expires}:${threshold}`,
        `Domain expires within ${threshold} days`,
      );
  }
  if (d.state?.autoRenew === false)
    await alert(
      d,
      `autorenew:${d.state.expires || "unknown"}`,
      "Domain auto-renew is off",
    );
  if (health.up === false)
    await alert(
      d,
      `down:${new Date().toISOString().slice(0, 10)}`,
      "Website HTTPS check failed",
    );
  if (
    health.sslExpires &&
    Date.parse(health.sslExpires) - Date.now() < 30 * 86400000
  )
    await alert(
      d,
      `ssl:${health.sslExpires}`,
      "Website SSL certificate expires within 30 days",
    );
  await pool.query(
    "UPDATE managed_domains SET observed=$2,checked_at=now(),next_check=now()+interval '1 day' WHERE id=$1",
    [d.id, observed],
  );
  return { health, questions: Object.keys(observed).length };
}
export async function processJob(job: any, deps: Dependencies = {}) {
  const {
    rows: [connection],
  } = await pool.query(
    "SELECT * FROM domain_connections WHERE id=$1 AND user_id=$2",
    [job.connection_id, job.user_id],
  );
  const a = connection ? adapter(connection, deps) : null;
  if (job.kind === "discover") {
    if (!a) throw new DomainError("Connection no longer available");
    const page = await a.list(job.payload.cursor);
    for (const d of page.domains)
      await pool.query(
        `INSERT INTO managed_domains(user_id,connection_id,domain,registrar,state) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,domain) DO UPDATE SET connection_id=$2,registrar=$4,state=COALESCE(managed_domains.state,'{}'::jsonb)||$5::jsonb`,
        [job.user_id, connection.id, d.domain, connection.provider, d],
      );
    await autoMapDomains(job.user_id);
    if (page.next && page.next !== job.payload.cursor)
      await enqueue(
        job.user_id,
        "discover",
        { cursor: page.next },
        undefined,
        connection.id,
      );
    await pool.query(
      "UPDATE domain_jobs SET status='complete',result=$2,updated_at=now() WHERE id=$1",
      [job.id, { count: page.domains.length }],
    );
    return;
  }
  const [d] = await ownedDomains(job.user_id, [Number(job.domain_id)]);
  if (job.kind === "monitor") {
    if (a) {
      d.state = await a.read(d.domain);
      await pool.query("UPDATE managed_domains SET state=$2 WHERE id=$1", [
        d.id,
        d.state,
      ]);
    }
    const result = await monitor(d, deps);
    await pool.query(
      "UPDATE domain_jobs SET status='complete',result=$2,updated_at=now() WHERE id=$1",
      [job.id, result],
    );
    return;
  }
  if (!a) throw new DomainError("Connection no longer available");
  if (String(d.connection_id) !== String(job.connection_id))
    throw new DomainError(
      "Domain connection changed. Create a new preview.",
      409,
    );
  let change: Change = job.payload.change;
  if (job.status === "verifying") {
    const ok = await verify(
      d.domain,
      change,
      job.after_state,
      deps.http || limitedFetch,
    );
    await pool.query(
      "UPDATE domain_jobs SET status=$2,error=NULL,attempts=attempts+1,run_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1",
      [
        job.id,
        ok
          ? "verified"
          : job.attempts >= 288
            ? "verification_failed"
            : "verifying",
      ],
    );
    if (ok) {
      const r = change.kind === "nameservers" ? null : change.record;
      const dnsKey = r
        ? `${r.name === "@" ? d.domain : r.name + "." + d.domain}:${r.type}`
        : `${d.domain}:NS`;
      const values = r
        ? job.after_state.records
            .filter((x: any) => x.name === r.name && x.type === r.type)
            .map((x: any) =>
              normalize(
                x.type,
                x.type === "MX" ? `${x.priority} ${x.content}` : x.content,
              ),
            )
        : change.kind === "nameservers"
          ? change.nameservers
          : [];
      await pool.query(
        "UPDATE managed_domains SET state=$2,observed=CASE WHEN observed IS NULL THEN NULL ELSE observed||$3::jsonb END WHERE id=$1",
        [d.id, job.after_state, { [dnsKey]: values }],
      );
    }
    return;
  }
  const current = await a.read(d.domain);
  if (job.status === "previewing") {
    if (change.kind === "delete" && change.record.id) {
      const actual = current.records.find(
        (r) => r.id === (change as any).record.id,
      );
      if (!actual) throw new DomainError("Record no longer exists", 409);
      change = { kind: "delete", record: actual };
      await pool.query("UPDATE domain_jobs SET payload=$2 WHERE id=$1", [
        job.id,
        { change },
      ]);
    }
    if (
      (change.kind === "update" || change.kind === "delete") &&
      !change.record.id
    ) {
      const candidates = current.records.filter(
        (r) =>
          r.type === (change as any).record.type &&
          r.name === (change as any).record.name &&
          (change.kind !== "delete" || r.content === change.record.content),
      );
      if (candidates.length !== 1)
        throw new DomainError(
          "Update/delete needs exactly one matching record per domain. Use the registrar for multi-value record sets.",
          409,
        );
      change = {
        ...change,
        record:
          change.kind === "delete"
            ? candidates[0]
            : { ...change.record, id: candidates[0].id },
      };
      await pool.query("UPDATE domain_jobs SET payload=$2 WHERE id=$1", [
        job.id,
        { change },
      ]);
    }
    const after = desired(current, change);
    await pool.query(
      "UPDATE domain_jobs SET status='ready',before_state=$2,after_state=$3,expires_at=now()+interval '15 minutes',updated_at=now() WHERE id=$1",
      [job.id, current, after],
    );
    return;
  }
  if (new Date(job.expires_at).getTime() < Date.now())
    throw new DomainError(
      "Authorization expired. Create and confirm a new preview.",
      409,
    );
  if (canonical(current) !== canonical(job.before_state))
    throw new DomainError(
      "Domain changed since preview. Create a new preview.",
      409,
    );
  desired(current, change); // Re-check current delegation at the last possible moment.
  let inverse: Change;
  if (change.kind === "nameservers")
    inverse = { kind: "nameservers", nameservers: current.nameservers };
  else if (change.kind === "create")
    inverse = { kind: "delete", record: { ...change.record, id: undefined } };
  else {
    const old = current.records.find((r) => r.id === change.record.id);
    if (!old) throw new DomainError("Record unavailable");
    inverse =
      change.kind === "delete"
        ? { kind: "create", record: { ...old, id: undefined } }
        : { kind: "update", record: old };
  }
  if (!changeInput.safeParse(inverse).success)
    throw new DomainError(
      "The original DNS values cannot be safely restored by this adapter. Use the registrar dashboard.",
      409,
    );
  await pool.query("UPDATE domain_jobs SET result=$2 WHERE id=$1", [
    job.id,
    { inverse },
  ]);
  // Persist intent BEFORE the network write. A crash leaves an uncertain operation, never an automatic replay.
  await pool.query(
    "UPDATE domain_jobs SET status='applying',updated_at=now() WHERE id=$1",
    [job.id],
  );
  if (change.kind === "nameservers") {
    inverse = { kind: "nameservers", nameservers: current.nameservers };
    await a.setNameservers(d.domain, change.nameservers);
  } else if (change.kind === "create") {
    const record = await a.createRecord(d.domain, change.record);
    inverse = { kind: "delete", record };
    job.after_state = desired(current, { kind: "create", record });
  } else {
    const old = current.records.find((r) => r.id === change.record.id);
    if (!old) throw new DomainError("Record unavailable");
    inverse =
      change.kind === "delete"
        ? { kind: "create", record: { ...old, id: undefined } }
        : { kind: "update", record: old };
    if (change.kind === "delete") await a.deleteRecord(d.domain, old);
    else await a.updateRecord(d.domain, change.record);
  }
  await pool.query(
    "UPDATE domain_jobs SET status='verifying',result=$2,after_state=$3,updated_at=now(),run_at=now() WHERE id=$1",
    [job.id, { inverse }, job.after_state],
  );
  await logActivity(null, job.user_id, "domains.changed", {
    domain: d.domain,
    jobId: job.id,
    operation: change.kind,
  });
  await notifyUser(job.user_id, "domains.changed", {
    title: "Domain change applied; DNS verification pending",
    body: d.domain,
    link: "/domains",
    severity: "warning",
  });
}
/** `deps.onlyUser` narrows a run to one owner (tests on a shared database). */
export async function runDomainWorker(
  deps: Dependencies & { onlyUser?: number } = {},
) {
  const c = await pool.connect();
  let locked = false;
  try {
    const {
      rows: [l],
    } = await c.query("SELECT pg_try_advisory_lock(8189,7) locked");
    locked = l.locked;
    if (!locked) return false;
    // Recover reads, but never replay a write whose response may have been lost.
    await c.query(
      "UPDATE domain_jobs SET status=CASE WHEN status='applying' THEN 'uncertain' ELSE 'queued' END,error='Worker interrupted; review before retrying' WHERE status IN ('applying','working') AND updated_at<now()-interval '10 minutes'",
    );
    const {
      rows: [job],
    } = await c.query(
      "SELECT * FROM domain_jobs WHERE status IN ('queued','previewing','verifying') AND run_at<=now() AND ($1::int IS NULL OR user_id=$1) ORDER BY CASE kind WHEN 'change' THEN 0 WHEN 'discover' THEN 1 ELSE 2 END,run_at,created_at LIMIT 1",
      [deps.onlyUser ?? null],
    );
    if (!job) return false;
    if (!(await domainsAllowed(job.user_id))) {
      // Nothing reaches the registrar. An applied change awaiting verification keeps that distinction.
      await c.query(
        "UPDATE domain_jobs SET status=CASE WHEN status='verifying' THEN 'verification_failed' ELSE 'failed' END,error=CASE WHEN status='verifying' THEN $3 ELSE $2 END,updated_at=now() WHERE id=$1",
        [job.id, DOMAINS_PLAN_PAUSED, DOMAINS_VERIFY_PAUSED],
      );
      if (job.kind === "monitor")
        await c.query(
          "UPDATE managed_domains SET next_check=now()+interval '1 day' WHERE id=$1",
          [job.domain_id],
        );
      return true;
    }
    if (job.kind === "monitor")
      await c.query(
        "UPDATE managed_domains SET next_check=now()+interval '1 day' WHERE id=$1",
        [job.domain_id],
      );
    if (job.kind !== "change")
      await c.query(
        "UPDATE domain_jobs SET status='working',updated_at=now() WHERE id=$1",
        [job.id],
      );
    try {
      await processJob(job, deps);
    } catch (e) {
      await c.query(
        "UPDATE domain_jobs SET status=CASE WHEN status='applying' THEN 'uncertain' WHEN status='verifying' AND attempts<288 THEN 'verifying' WHEN status='verifying' THEN 'verification_failed' ELSE 'failed' END,error=$2,attempts=attempts+1,run_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1",
        [
          job.id,
          e instanceof DomainError
            ? e.message
            : "Operation failed. Review credentials, DNS and provider status.",
        ],
      );
    }
    return true;
  } finally {
    if (locked) await c.query("SELECT pg_advisory_unlock(8189,7)");
    c.release();
  }
}
/** `onlyUser` narrows a run to one owner (tests on a shared database). */
export async function scheduleMonitors(onlyUser?: number) {
  // Daily monitoring only for owners whose plan still includes the module; others are looked at again tomorrow.
  const due =
    "d.next_check<=now() AND NOT EXISTS(SELECT 1 FROM domain_jobs j WHERE j.domain_id=d.id AND j.kind='monitor' AND j.status IN ('queued','working'))";
  const { rows } = await pool.query(
    `SELECT DISTINCT d.user_id FROM managed_domains d WHERE ${due} AND ($1::int IS NULL OR d.user_id=$1) LIMIT 100`,
    [onlyUser ?? null],
  );
  const allowed: number[] = [],
    paused: number[] = [];
  for (const r of rows)
    ((await domainsAllowed(r.user_id)) ? allowed : paused).push(r.user_id);
  if (paused.length)
    await pool.query(
      `UPDATE managed_domains d SET next_check=now()+interval '1 day' WHERE ${due} AND d.user_id=ANY($1::int[])`,
      [paused],
    );
  if (allowed.length)
    await pool.query(
      `INSERT INTO domain_jobs(id,user_id,domain_id,connection_id,kind,status)
 SELECT gen_random_uuid(),d.user_id,d.id,d.connection_id,'monitor','queued' FROM managed_domains d WHERE ${due} AND d.user_id=ANY($1::int[]) ORDER BY d.next_check LIMIT 100 ON CONFLICT DO NOTHING`,
      [allowed],
    );
}
export function startDomainWorker() {
  if (process.env.DOMAINS_WORKER_ENABLED !== "true") return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await scheduleMonitors();
      await runDomainWorker();
    } catch {
      console.error("[domains] Worker cycle failed");
    } finally {
      busy = false;
    }
  }, 1000);
  timer.unref();
}
