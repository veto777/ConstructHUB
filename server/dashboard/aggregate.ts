/**
 * buildDashboard — the signed-in home dashboard for one user (SPEC §3).
 *
 *   entitlements (required: no gate can be computed without them)
 *   → read-only CRM context (never creates an org)
 *   → every tile, the account header, the checklist and the recent feed, each
 *     settled on its own with a DASHBOARD_TILE_TIMEOUT_MS budget, so one
 *     failing source is one "error" tile and never the page.
 *
 * Locked and coming-soon tiles are decided by tileAccess before any query
 * runs: a locked tile reads no feature data.
 */
import { PLANS } from "@shared/plans";
import {
  DASHBOARD_TILES, DASHBOARD_TILE_TIMEOUT_MS,
  type DashboardAccount, type DashboardPayload, type DashboardTile, type DashboardTileDef, type DashboardTileKey,
} from "@shared/dashboard";
import { getEntitlements } from "../entitlements";
import type { OrgContext } from "../crm/tenancy";
import { tileAccess } from "./access";
import { readOnlyCrmContext } from "./crm";
import { makeContext, type DashboardContext } from "./context";
import { accountHeader, accountUsage, resetsAt, unreadNotifications } from "./account";
import { buildChecklist } from "./checklist";
import { buildRecent } from "./recent";
import { CTA_START, COMING_SOON_MESSAGE, failedMessage, lockedMessage, timeoutMessage } from "./copy";
import { tileSource, type TileOutcome, type TileSources } from "./tiles";

export class DashboardTimeout extends Error {
  constructor(what: string, ms: number) { super(`${what} took longer than ${ms} ms`); this.name = "DashboardTimeout"; }
}

/** Settle `p` within `ms`, or reject with DashboardTimeout. (The SQL itself is bounded by the pool's statement_timeout.) */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "source"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DashboardTimeout(what, ms)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Tiles that read the active CRM org: when the org lookup itself failed they are "error", never "set up the CRM". */
const CRM_TILES: ReadonlySet<DashboardTileKey> = new Set(["crm", "crmSchedule", "crmLeads", "texting"]);

/** Link tiles with nothing to count. */
const LINK_TILE_CTA: Partial<Record<DashboardTileKey, string>> = { guides: "Browse guides", reinstatement: "Get help" };

export type BuildDashboardOptions = {
  /** req.session.activeOrgId — the pinned CRM org, if any. */
  activeOrgId?: string | null;
  now?: Date;
  /** Per-source budget (tests shorten it). */
  timeoutMs?: number;
  /** Test hook: replace tile sources (a source that throws or never settles). */
  sources?: TileSources;
  /** One line per failed source; never the user's data. */
  log?: (line: string) => void;
};

export type BuiltDashboard = {
  payload: DashboardPayload;
  /** False when the account header failed: such an answer is never cached. */
  cacheable: boolean;
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export async function buildDashboard(userId: number, opts: BuildDashboardOptions = {}): Promise<BuiltDashboard> {
  const now = opts.now ?? new Date();
  const budget = opts.timeoutMs ?? DASHBOARD_TILE_TIMEOUT_MS;
  const log = opts.log ?? ((line: string) => console.error(line));
  const fail = (what: string) => (err: unknown) => log(`[dashboard] ${what} failed: ${errText(err)}`);

  // Throws → the route answers 500: without entitlements no gate is known.
  const ent = await getEntitlements(userId, now);

  let crm: OrgContext | null = null;
  let crmFailed = false;
  try {
    crm = await withTimeout(readOnlyCrmContext(userId, opts.activeOrgId), budget, "crm context");
  } catch (err) {
    crmFailed = true;
    fail("crm context")(err);
  }

  const ctx = makeContext(userId, ent, crm, now);
  const access = { accessPlan: ent.accessPlan, allowances: ent.allowances, modules: ent.modules, hasCrmOrg: crmFailed || !!crm };

  const tilesP = Promise.all(DASHBOARD_TILES.map((def) => computeTile(def, ctx, access, { budget, crmFailed, sources: opts.sources, onError: (e) => fail(`tile ${def.key}`)(e) })));

  const [header, usage, unread, checklist, recent] = await Promise.allSettled([
    withTimeout(accountHeader(ctx), budget, "account"),
    withTimeout(accountUsage(ctx), budget, "usage"),
    withTimeout(unreadNotifications(userId), budget, "notifications"),
    withTimeout(buildChecklist(ctx, (k, e) => fail(`checklist ${k}`)(e)), budget, "checklist"),
    withTimeout(buildRecent(ctx, (k, e) => fail(`recent ${k}`)(e)), budget, "recent"),
  ]);
  if (header.status === "rejected") fail("account")(header.reason);
  if (usage.status === "rejected") fail("usage")(usage.reason);
  if (unread.status === "rejected") fail("unread notifications")(unread.reason);
  if (checklist.status === "rejected") fail("checklist")(checklist.reason);
  if (recent.status === "rejected") fail("recent")(recent.reason);

  const account: DashboardAccount = {
    ...(header.status === "fulfilled" ? header.value : {
      // The header failed: what entitlements alone can say, nothing guessed.
      firstName: null, displayName: null, plan: ent.plan,
      planName: ent.accessPlan ? PLANS[ent.accessPlan].name : null,
      status: "none" as const, isPlatformAdmin: ent.isPlatformAdmin, trialEndsAt: null, renewsAt: null,
    }),
    usage: usage.status === "fulfilled" ? usage.value : [],
    resetsAt: resetsAt(now),
    unreadNotifications: unread.status === "fulfilled" ? unread.value : 0,
  };

  return {
    payload: {
      generatedAt: now.toISOString(),
      cached: false,
      fixture: false,
      account,
      tiles: await tilesP,
      checklist: checklist.status === "fulfilled" ? checklist.value : [],
      recent: recent.status === "fulfilled" ? recent.value : [],
    },
    cacheable: header.status === "fulfilled",
  };
}

async function computeTile(
  def: DashboardTileDef,
  ctx: DashboardContext,
  accessInput: Parameters<typeof tileAccess>[1],
  opts: { budget: number; crmFailed: boolean; sources?: TileSources; onError: (err: unknown) => void },
): Promise<DashboardTile> {
  const access = tileAccess(def, accessInput);
  const page = { href: def.href, surface: def.surface };
  const base: DashboardTile = {
    key: def.key, group: def.group, title: def.title, description: def.description, href: def.href, surface: def.surface,
    entitled: access.entitled, status: "ok", metrics: [], updatedAt: ctx.now.toISOString(),
    ...(def.links ? { links: [...def.links] } : {}),
    ...(access.requiredPlan && !access.entitled ? { requiredPlan: access.requiredPlan } : {}),
    ...(access.module ? { module: access.module } : {}),
    ...(access.addon ? { addon: access.addon } : {}),
  };
  if (access.comingSoon) {
    return { ...base, status: "coming_soon", message: COMING_SOON_MESSAGE, cta: { label: "See add-ons", href: "/pricing#add-ons", surface: "app" } };
  }
  if (!access.entitled) {
    return { ...base, status: "locked", message: lockedMessage(access.requiredPlan), cta: { label: "See plans", href: "/pricing", surface: "app" } };
  }

  const source = tileSource(def.key, opts.sources);
  let outcome: TileOutcome;
  try {
    if (opts.crmFailed && CRM_TILES.has(def.key)) throw new Error("CRM context unavailable");
    if (!source) throw new Error("no source for this tile");
    outcome = await withTimeout(source(ctx), opts.budget, `tile ${def.key}`);
  } catch (err) {
    opts.onError(err);
    return {
      ...base, status: "error",
      message: err instanceof DashboardTimeout ? timeoutMessage(def.title) : failedMessage(def.title),
      cta: { label: `Open ${def.title}`, ...page },
    };
  }

  if (outcome.status === "empty") {
    return {
      ...base, status: "empty",
      message: outcome.message ?? def.description,
      cta: outcome.cta ?? { label: CTA_START[def.key] ?? "Open", ...page },
    };
  }
  return {
    ...base, status: "ok", metrics: outcome.metrics,
    cta: outcome.cta ?? { label: LINK_TILE_CTA[def.key] ?? "Open", ...page },
  };
}
