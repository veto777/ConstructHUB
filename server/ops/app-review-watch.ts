/**
 * App Review watch for the two iPhone apps (docs/app/APP-STORE-PLAN.md, Remindr lesson 6: Apple's "please resubmit"
 * was read as approval and 10 days were lost). Every 15 minutes, when the App Store Connect key is on this server
 * (IOS_SIGNING_DIR: asc.json + asc-api-<keyId>.p8, the same folder the iOS release workflow uses), it reads each
 * app's newest version state and its review submission, and when either changes it tells every platform admin —
 * bell + iPhone push (notifyUser kind "ops.app_review"; email off by default, switchable in Settings →
 * Notifications). The last state seen is kept in ops_app_review_state, so a restart neither repeats nor misses one.
 */
import { createSign } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../db";

export const WATCHED_APPS = [
  { id: "6819417454", name: "ConstructHUB: Contractor Tools" },
  { id: "6819417824", name: "ConstructHUB CRM" },
] as const;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type AppReviewState = { appId: string; name: string; version: string; versionState: string; submissionState: string | null };

/** Plain words for each state — what it means and what to do. "Approved" only when Apple says so. */
export function describeState(s: AppReviewState): { title: string; body: string; severity: "info" | "warning" | "critical" } {
  const v = `${s.name} ${s.version}`;
  if (s.submissionState === "UNRESOLVED_ISSUES") return { severity: "critical", title: `${v}: Apple needs a reply`,
    body: "App Review left a message. Open App Store Connect → the app → App Review, answer it and resubmit today. This is NOT an approval." };
  switch (s.versionState) {
    case "WAITING_FOR_REVIEW": return { severity: "info", title: `${v}: submitted, waiting for review`, body: "Apple has it in the queue." };
    case "IN_REVIEW": return { severity: "info", title: `${v}: Apple is reviewing it now`, body: "Keep app-visible changes frozen until the decision." };
    case "PENDING_DEVELOPER_RELEASE": return { severity: "warning", title: `${v}: approved — waiting for release`, body: "Approved by Apple; release it in App Store Connect." };
    case "PENDING_APPLE_RELEASE": return { severity: "info", title: `${v}: approved — Apple is releasing it`, body: "It goes live shortly." };
    case "READY_FOR_SALE": case "READY_FOR_DISTRIBUTION": return { severity: "warning", title: `${v}: approved and live on the App Store`, body: "Approved. It's on the App Store (United States)." };
    case "REJECTED": return { severity: "critical", title: `${v}: rejected by App Review`, body: "Read Apple's message in App Store Connect → App Review, fix it and resubmit today. This is NOT an approval." };
    case "METADATA_REJECTED": return { severity: "critical", title: `${v}: listing rejected`, body: "Apple rejected the listing text or screenshots. Fix them in the repo (scripts/asc-listing.ts) and resubmit today." };
    case "INVALID_BINARY": return { severity: "critical", title: `${v}: build rejected as invalid`, body: "The uploaded build was refused. Check the iOS release run and upload a new build." };
    case "DEVELOPER_REJECTED": return { severity: "warning", title: `${v}: pulled from review`, body: "The submission was withdrawn before a decision." };
    default: return { severity: "info", title: `${v}: ${s.versionState.toLowerCase().replace(/_/g, " ")}`, body: s.submissionState ? `Review submission: ${s.submissionState.toLowerCase().replace(/_/g, " ")}.` : "" };
  }
}

const stateKey = (s: AppReviewState) => `${s.version}|${s.versionState}|${s.submissionState ?? "-"}`;

export async function ensureAppReviewWatchSchema(q: Queryable = pool): Promise<void> {
  await q.query(`CREATE TABLE IF NOT EXISTS ops_app_review_state (
    app_id text PRIMARY KEY, state text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
}

/** Compare with what was seen last; record and announce changes. The very first reading is recorded silently. */
export async function checkAppReview(opts: {
  read: () => Promise<AppReviewState[]>;
  notify: (s: AppReviewState, msg: ReturnType<typeof describeState>) => Promise<void>;
  q?: Queryable;
}): Promise<AppReviewState[]> {
  const q = opts.q ?? pool;
  const changed: AppReviewState[] = [];
  for (const s of await opts.read()) {
    const { rows: [prev] } = await q.query("SELECT state FROM ops_app_review_state WHERE app_id = $1", [s.appId]);
    if (prev?.state === stateKey(s)) continue;
    await q.query(`INSERT INTO ops_app_review_state (app_id, state) VALUES ($1, $2)
      ON CONFLICT (app_id) DO UPDATE SET state = $2, updated_at = now()`, [s.appId, stateKey(s)]);
    if (prev) { changed.push(s); await opts.notify(s, describeState(s)); }
  }
  return changed;
}

/** App Store Connect reads with the team key in IOS_SIGNING_DIR (read-only calls). */
function ascReader(dir: string) {
  const cfg = JSON.parse(readFileSync(join(dir, "asc.json"), "utf8"));
  const key = readFileSync(join(dir, `asc-api-${cfg.ascKeyId}.p8`), "utf8");
  const token = () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const data = `${b64({ alg: "ES256", kid: cfg.ascKeyId, typ: "JWT" })}.${b64({ iss: cfg.ascIssuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
    return `${data}.${createSign("SHA256").update(data).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const get = async (path: string) => {
    const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return (await res.json()) as any;
  };
  return async (): Promise<AppReviewState[]> => Promise.all(WATCHED_APPS.map(async (a) => {
    const v = (await get(`/v1/apps/${a.id}/appStoreVersions?filter[platform]=IOS&limit=1`)).data[0];
    const subs = (await get(`/v1/reviewSubmissions?filter[app]=${a.id}&limit=5`)).data as any[];
    // The newest submission that has left the draft stage says the most (waiting, in review, unresolved issues…).
    const sub = subs.filter((x) => x.attributes.state !== "READY_FOR_REVIEW")
      .sort((x, y) => String(y.attributes.submittedDate ?? "").localeCompare(String(x.attributes.submittedDate ?? "")))[0];
    return { appId: a.id, name: a.name, version: v?.attributes.versionString ?? "?", versionState: v?.attributes.appStoreState ?? "UNKNOWN", submissionState: sub?.attributes.state ?? null };
  }));
}

let timer: NodeJS.Timeout | null = null;
export function startAppReviewWatch(): void {
  const dir = process.env.IOS_SIGNING_DIR;
  if (!dir || process.env.APP_REVIEW_WATCH === "false" || timer) return;
  let read: () => Promise<AppReviewState[]>;
  try { read = ascReader(dir); } catch (e: any) { console.warn(`[app-review] off: ${e?.message ?? e}`); return; }
  const run = async () => {
    try {
      await ensureAppReviewWatchSchema();
      const { platformAdminUsers } = await import("./digest");
      const { notifyUser } = await import("../account-events");
      const changed = await checkAppReview({ read, notify: async (s, msg) => {
        for (const admin of await platformAdminUsers(pool)) {
          await notifyUser(admin.id, "ops.app_review", { title: msg.title, body: msg.body, severity: msg.severity });
        }
        console.log(`[app-review] ${msg.title}`);
      } });
      if (changed.length) console.log(`[app-review] ${changed.length} change(s)`);
    } catch (e: any) { console.warn(`[app-review] check failed: ${e?.message ?? e}`); }
  };
  void run();
  timer = setInterval(run, 15 * 60_000);
  timer.unref();
}
