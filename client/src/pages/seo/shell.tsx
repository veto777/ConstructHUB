/**
 * Shared frame for the ConstructHUB SEO pages (/seo, /seo/explorer, /seo/keywords,
 * /seo/backlinks, /seo/competitors): Google surface with the brand accent,
 * the tab strip, the site picker, this account's plan units (tracked keywords,
 * keyword searches, backlink refreshes), a quiet "being switched on" notice
 * while the server reports configured:false, and the plan gate.
 *
 * White-label: nothing here names the data vendor or a price. Platform admins
 * see the "Data source" card on /admin (Platform admin), fed by `status.admin`; the SEO pages themselves are vendor-free.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { GoogleSurface } from "@/components/google";
import { AppPage } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { planRequiredFrom } from "@/components/plan-required";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PLANS } from "@shared/plans";
import { inNativeApp } from "@/lib/app-shell";
import { seoLinks, setParam } from "./links";

export const api = async (method: string, url: string, body?: unknown) => (await apiRequest(method, url, body)).json();

/** One plan unit: used of limit (-1 = unlimited, 0 = not in the plan). */
export type Unit = { used: number; limit: number };
export type SeoUsage = { keywords: Unit };
/** SEO data credit, in cents at the customer's price (shared/seo-credits.ts). -1 = unlimited. */
export type SeoCreditsInfo = { includedCents: number; includedUsedCents: number; walletCents: number; availableCents: number };
export type SeoPrices = { explorerReport: number; reportPage: number; adsReport?: number; gridLocate?: number; gridPer100?: number; keywordOverview: number; keywordResearch: number; competitorGap: number; backlinkRefresh: number; rankChecksPer100: number; linkIntersect?: number; bulkBase?: number; bulkPer100?: number; searchVolumes?: number; aiChatgpt?: number; aiGemini?: number; aiPerplexity?: number; aiMentions?: number; batchBase?: number; batchPer100?: number; contentSearch?: number; mentions?: number; mentionsRetry?: number };
export type SeoStatus = {
  configured: boolean;
  usage: SeoUsage;
  credits: SeoCreditsInfo;
  prices: SeoPrices;
  /** Alerts not yet read (the badge on the Alerts tab). */
  alertsUnread?: number;
  /** Alerts whose delivery (bell / email) was given up after repeated tries; they stay on the Alerts page, marked. */
  alertsUndelivered?: number;
  /** The most a lookup can cost: what must be available for it to start. */
  holds?: Partial<Record<keyof SeoPrices, number>>;
  /** Exact quotes in cents for lookups sized by the customer: entry n-1 is for n sites or pages. */
  quotes?: Record<string, number[] | undefined>;
  packs: number[];
  resetsAt: string;
  /** Platform admins only: the real state of the data source. */
  admin?: {
    vendor: string; configured: boolean; env: readonly string[];
    month: string; capUsd: number; spentUsd: number; remainingUsd: number; accountUsd: number; accountRequests: number;
  };
};
export type SeoSite = {
  id: number; domain: string; businessName?: string | null; alertsEnabled?: boolean; alertDrop?: number; rankFrequency?: "weekly" | "twice_weekly" | "daily"; group?: string | null; locationCode: number; languageCode: string; devices: "desktop" | "mobile" | "both"; serpDepth: number;
  keywordCount: number; nextRankCheckAt: string | null; lastRankCheckAt: string | null; nextBacklinksAt: string | null; lastBacklinksAt: string | null;
  starred?: boolean; createdAt?: string;
};

export const fmtNum = (n: number | null | undefined) => n == null ? "—" : Math.round(n).toLocaleString("en-US");
/** A date as its UTC day ("Oct 8"): a date-only value is that day, a timestamp the UTC day it falls in — the day the
 *  product files checks, crawls and reports under (the PDF and email say the same day). SeoShell says so once per page. */
export const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
/** "12 of 50" / "12 · unlimited". */
export const fmtUnit = (u: Unit | undefined) => !u ? "—" : u.limit < 0 ? `${fmtNum(u.used)} · unlimited` : `${fmtNum(u.used)} of ${fmtNum(u.limit)}`;
/** Units left this month (Infinity when unlimited). */
export const unitsLeft = (u: Unit | undefined) => !u ? 0 : u.limit < 0 ? Infinity : Math.max(0, u.limit - u.used);

/** Cents as dollars: "$1.04". */
export const money = (cents: number | null | undefined) => cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
/** "about $1.04" for a price shown before a lookup runs. */
export const priceOf = (status: SeoStatus | undefined, key: keyof SeoPrices) => status?.prices ? `about ${money(status.prices[key])}` : "";
/** Enough credit for this lookup? (true while the status is loading, so buttons are not disabled for nothing) */
export const canAfford = (status: SeoStatus | undefined, key: keyof SeoPrices) =>
  !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= (status.holds?.[key] ?? status.prices[key] ?? 0);

/**
 * After something changed what the worker-fed pages show (keywords tracked, a site added): every tracked-site view,
 * the dashboard, alerts and the balance are fetched again, wherever they are next opened.
 */
export const refreshSeoData = (qc: { invalidateQueries: (f: { predicate: (q: { queryKey: readonly unknown[] }) => boolean }) => unknown }) =>
  void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/api\/seo\/(sites|dashboard|status|alerts|keywords\/\d+\/history)/.test(q.queryKey[0]) });

/** Says so when more than the typical price is set aside while a lookup runs. */
export const holdNote = (status: SeoStatus | undefined, key: keyof SeoPrices) => {
  const hold = status?.holds?.[key], price = status?.prices?.[key];
  return hold != null && price != null && hold > price ? ` Up to ${money(hold)} is set aside while it runs; what isn't used comes straight back.` : "";
};

/** A saved-copy check that answered 404: not run yet — as opposed to a check that failed. */
export const isNotRunYet = (e: unknown) => /^404:/.test(String((e as { message?: unknown } | null)?.message ?? ""));

export const useSeoStatus = () => useQuery<SeoStatus>({ queryKey: ["/api/seo/status"] });
export const useSeoSites = () => useQuery<SeoSite[]>({ queryKey: ["/api/seo/sites"] });

const SITE_KEY = "seo:site";
/** The parameters of the current address, read again whenever it changes (a link followed, a filter picked, the back button). */
export function useAddress(): URLSearchParams {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/**
 * The chosen site: `?site=<id>` in the address when it names one of this account's sites (every SEO page honours it,
 * also when the address changes while the page is open), else the one remembered per browser, else the first one.
 */
export function useSelectedSite(sites: SeoSite[] | undefined): [SeoSite | null, (id: number) => void] {
  const wanted = Number(useAddress().get("site")) || null;
  const [id, setId] = useState<number | null>(() => { try { return wanted || Number(localStorage.getItem(SITE_KEY)) || null; } catch { return wanted; } });
  // A site arrived at by link is the site from then on (the nav tabs carry no site), so it is remembered too.
  useEffect(() => { if (wanted && sites?.some((s) => s.id === wanted)) { setId(wanted); try { localStorage.setItem(SITE_KEY, String(wanted)); } catch { /* private window */ } } }, [wanted, sites]);
  const site = sites?.find((s) => s.id === id) ?? sites?.[0] ?? null;
  useEffect(() => { if (site && site.id !== id) { setId(site.id); try { localStorage.setItem(SITE_KEY, String(site.id)); } catch { /* private window */ } } }, [site, id]);
  return [site, (next) => { setId(next); try { localStorage.setItem(SITE_KEY, String(next)); } catch { /* private window */ } }];
}

/** The address names a site that is not one of this account's (or was removed): the page says so and shows its own. */
export function useSiteMissing(sites: SeoSite[] | undefined): number | null {
  const wanted = Number(useAddress().get("site")) || null;
  return wanted && sites && !sites.some((s) => s.id === wanted) ? wanted : null;
}

/**
 * What narrowed this view, in the visitor's words, with a way to clear it (data-testid="active-filter"). A page shows
 * one whenever a parameter of the address narrows, opens or highlights something on it.
 */
export function ActiveFilter({ children, onClear, clearLabel = "Show everything" }: { children: ReactNode; onClear: () => void; clearLabel?: string }) {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" role="status" data-testid="active-filter">
      <span className="g-chip min-h-10 !whitespace-normal py-1 [overflow-wrap:anywhere]" style={{ textTransform: "none" }}>{children}</span>
      <button type="button" className="g-pill g-pill--sm" onClick={onClear} data-testid="button-clear-filter"><X /> {clearLabel}</button>
    </p>
  );
}

/**
 * A strip of tabs (the SEO sections, a page's own lists). Each tab is at least 44 px tall. On a phone the strip scrolls
 * sideways — its scrollbar stays visible and a fade at the right edge says there is more; from 640 px it wraps, so
 * every tab shows.
 */
export function TabStrip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative mb-4 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:bg-gradient-to-l after:from-[color:var(--g-surface,#fff)] after:to-transparent sm:after:hidden ${className}`}>
      <nav className="g-tabs !mb-0 pr-10 ![scrollbar-width:thin] sm:!flex-wrap sm:!overflow-visible sm:pr-0 [&>a]:flex [&>a]:min-h-11 [&>a]:items-center" aria-label={label}>{children}</nav>
    </div>
  );
}

/** Scrolls to the element with `id` once `ready` (the data is on the page). The element is outlined by its own page. */
export function useScrollTo(id: string | null | undefined, ready: boolean) {
  useEffect(() => {
    if (!id || !ready) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [id, ready]);
}

/** The outline on the row, card or point a link landed on. */
export const HIGHLIGHT = { outline: "2px solid var(--g-blue, #1a73e8)", outlineOffset: 2 } as const;

/**
 * Drops parameters from the address: replaced in place (a page's own narrowing when its site changes), or as ONE new
 * history entry when `replace` is false (a chip's clear control), so the back button brings the whole narrowing back.
 */
export const clearParams = (names: string[], replace = true) => { names.forEach((n, i) => setParam(n, null, replace || i > 0)); };

/** The #fragment of the current address, read again whenever it changes (a link to a part of the page). */
export function useHash(): string {
  return useSyncExternalStore(
    (onChange) => { const events = ["hashchange", "popstate", "pushState", "replaceState"]; for (const e of events) window.addEventListener(e, onChange); return () => { for (const e of events) window.removeEventListener(e, onChange); }; },
    () => window.location.hash.slice(1), () => "",
  );
}

const TABS = [
  { href: "/seo", label: "Dashboard" },
  { href: "/seo/explorer", label: "Site explorer" },
  { href: "/seo/keywords", label: "Keywords explorer" },
  { href: "/seo/content", label: "Content explorer" },
  { href: "/seo/rank-tracker", label: "Rank tracker" },
  { href: "/seo/local-grid", label: "Local grid" },
  { href: "/seo/plan", label: "Action plan" },
  { href: "/seo/audit", label: "Site audit" },
  { href: "/seo/ai", label: "AI visibility" },
  { href: "/seo/alerts", label: "Alerts" },
  { href: "/seo/reports", label: "Reports" },
  { href: "/seo/backlinks", label: "Backlinks" },
  { href: "/seo/batch", label: "Batch analysis" },
  { href: "/seo/usage", label: "Usage" },
];

export function SeoShell({ title, description, actions, children, site, onSite, sites, status, picker = true }: {
  title: string; description: string; actions?: ReactNode; children: ReactNode;
  /** false on pages that are not about one tracked site (Site explorer takes any domain). */
  picker?: boolean;
  site: SeoSite | null; onSite: (id: number) => void; sites: ReturnType<typeof useSeoSites>; status: ReturnType<typeof useSeoStatus>;
}) {
  const [location] = useLocation();
  const gate = planRequiredFrom(status.error) ?? planRequiredFrom(sites.error);
  return (
    <GoogleSurface page accent="brand" testId="seo-surface">
      <AppPage className="before:hidden [&_button]:min-h-10">
        <div className="g-header flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="g-header__title" data-testid="text-page-title">{title}</h1>
            <p className="g-header__sub">{description}</p>
          </div>
          {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
        </div>
        {gate ? (
          <PlanGate requiredPlan={gate.requiredPlan} message={gate.message} />
        ) : (
          <>
            <TabStrip label="SEO sections">
              {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={location === t.href ? "page" : undefined}>{t.label}{t.href === "/seo/alerts" && (status.data?.alertsUnread ?? 0) > 0 && <span className="g-chip g-chip--sm ml-1" aria-label={`${status.data!.alertsUnread} unread`}>{status.data!.alertsUnread}</span>}</Link>)}
            </TabStrip>
            {picker && sites.isError && <div className="g-callout mb-4" role="alert" data-testid="seo-sites-error"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(sites.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void sites.refetch()}>Try again</button></div>}
            {picker && !sites.isError && <SitePicker site={site} onSite={onSite} sites={sites} />}
            <UsageLine status={status} />
            <p className="g-text-2 mb-4 text-[12px]" data-testid="seo-dates-note">Dates of checks, crawls and reports are UTC days — the day each is filed under; in the US evening that is already the next day.</p>
            {status.data && !status.data.configured && <NotReadyNotice />}
            {children}
          </>
        )}
      </AppPage>
    </GoogleSurface>
  );
}

function PlanGate({ requiredPlan, message }: { requiredPlan: keyof typeof PLANS; message: string }) {
  return (
    <div className="g-callout" data-testid="seo-plan-gate">
      <h3>ConstructHUB SEO is included with the {PLANS[requiredPlan].name} plan</h3>
      <p>{message}</p>
      <p className="mt-1">Accounts that already have the SEO tools keep them.</p>
      <div className="mt-3"><Link href={seoLinks.pricing()} className="g-pill g-pill--solid">See {PLANS[requiredPlan].name}</Link></div>
    </div>
  );
}

/** SEO data credit: this month's allowance, purchased credit, and the way to add more. */
function UsageLine({ status }: { status: ReturnType<typeof useSeoStatus> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const u = status.data?.usage, c = status.data?.credits;
  const search = useSearch();
  // Back from Stripe: say what happened once, then drop the flag. ?credits=add (a link from the usage line or the usage
  // page) opens the add-credit panel — also when the address changes while the page is open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("credits");
    if (!flag) return;
    if (flag === "success") { toast({ title: "Credit added", description: "It can take a few seconds to show in your balance." }); window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }), 3000); }
    else if (flag === "canceled") toast({ title: "Checkout canceled", description: "No charges were made." });
    else if (flag === "add") setAdding(true);
    params.delete("credits");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [toast, qc, search]);
  const buy = useMutation({
    mutationFn: (cents: number) => api("POST", "/api/seo/credits/checkout", { cents }),
    onSuccess: (data: { url?: string }) => { if (data?.url) window.location.href = data.url; },
    onError: (e) => toast({ title: "Couldn't start checkout", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!u || !c) return null;
  // The iPhone apps sell nothing (App Store 3.1.3(f)): the balance shows, the way to buy more does not.
  const unlimited = c.includedCents === -1, canBuy = !unlimited && !inNativeApp();
  const left = Math.max(0, c.includedCents - c.includedUsedCents);
  // Every figure leads to its data: the balance to the usage page, the purchased credit to its add-credit panel, the
  // tracked keywords to the dashboard ordered by keywords. Figures keep the text colour; the dotted underline says
  // "link" without a hover, and each link is a 44 px-tall hit area on a phone.
  const link = "inline-flex min-h-11 items-center gap-1 rounded-sm underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue,#1a73e8)]";
  return (
    <div className="mb-4" data-testid="seo-usage-line">
      <p className="g-text-2 flex flex-wrap items-center gap-x-1 text-[13px]">
        <span className="inline-flex flex-wrap items-center gap-x-1" data-testid="text-seo-balance">
          <Link href={seoLinks.usage()} className={link} data-testid="link-usage-balance">SEO data this month{" "}
            <b className="g-text font-medium">{unlimited ? "unlimited" : `${money(left)} left of ${money(c.includedCents)} included`}</b></Link>
          {!unlimited && <> · <Link href={seoLinks.usage({ credits: "add" })} className={link} data-testid="link-usage-credit">purchased credit <b className="g-text font-medium">{money(c.walletCents)}</b></Link></>}
          {" · "}<Link href={seoLinks.dashboard({ sort: "keywords" })} className={link} data-testid="link-usage-keywords">tracked keywords <b className="g-text font-medium">{fmtUnit(u.keywords)}</b></Link>
        </span>
        {canBuy && !adding && <button type="button" className="g-pill g-pill--sm ml-1" onClick={() => setAdding(true)} data-testid="button-add-credit"><Plus /> Add credit</button>}
      </p>
      {!unlimited && c.availableCents === 0 && !adding && (
        <p className="mt-1 text-[13px]" style={{ color: "var(--g-red)" }} role="status" data-testid="text-seo-out-of-credit">
          You've used this month's SEO data. {canBuy ? "Add credit to keep running lookups, or wait for the 1st." : "It comes back on the 1st."}
        </p>
      )}
      {adding && canBuy && (
        <div className="g-callout mt-2" data-testid="panel-add-credit">
          <h3>Add SEO data credit</h3>
          <p>Prepaid, used only after this month's included allowance, and it doesn't expire. Paid by card through Stripe; a receipt is emailed.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(status.data?.packs ?? []).map((cents) => (
              <Button key={cents} variant="outline" disabled={buy.isPending} onClick={() => buy.mutate(cents)} data-testid={`button-buy-credit-${cents}`}>
                {buy.isPending && buy.variables === cents ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Add {money(cents).replace(".00", "")}
              </Button>
            ))}
            <button type="button" className="g-pill" onClick={() => setAdding(false)}>Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown while the server reports configured:false. Sites and keywords still save; checks run once the source is live. */
export function NotReadyNotice() {
  return (
    <p className="g-text-2 mb-4 text-[13px]" role="status" data-testid="seo-not-ready">
      Rank tracking is being switched on for your account — check back shortly. You can add sites and keywords now; the first check runs as soon as it's on.
    </p>
  );
}

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

/** Platform admins only — rendered on /admin (never on the customer-facing SEO pages): the vendor, this month's
 * wholesale spend against the internal cap, the env names. */
export function DataSourceCard({ admin }: { admin: NonNullable<SeoStatus["admin"]> }) {
  const pct = admin.capUsd > 0 ? Math.min(100, Math.round((admin.spentUsd / admin.capUsd) * 100)) : 100;
  return (
    <div className="g-callout mb-5" data-testid="seo-admin-data-source">
      <h3>Data source <span className="g-text-2 text-[12px] font-normal">· platform admins only</span></h3>
      <p>
        {admin.vendor}: <b className="g-text font-medium">{admin.configured ? "connected" : "not connected"}</b>
        {" · "}wholesale spend {admin.month}: <b className="g-text font-medium">{fmtUsd(admin.spentUsd)}</b> of the {fmtUsd(admin.capUsd)} internal cap ({pct}%)
        {admin.accountRequests > 0 && <> · this account {admin.accountRequests.toLocaleString("en-US")} request{admin.accountRequests === 1 ? "" : "s"} ({fmtUsd(admin.accountUsd)})</>}
      </p>
      <p className="mt-1 text-[12px]">Server env: {admin.env.map((e, i) => <span key={e}>{i > 0 && ", "}<code>{e}</code></span>)}. Per-account spend: <code>GET /api/seo/admin/usage</code>.</p>
    </div>
  );
}

function SitePicker({ site, onSite, sites }: { site: SeoSite | null; onSite: (id: number) => void; sites: ReturnType<typeof useSeoSites> }) {
  const [adding, setAdding] = useState(false);
  const list = sites.data ?? [];
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      {list.length > 0 && (
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] g-text-2 sm:max-w-md">
          <span className="flex-none">Site</span>
          {/* A site picked here is written to the address (?site=), so the view is the same as one arrived at by link and
              the back button returns to the site before. This is the ONE writer of ?site= for a pick: a page's `onSite`
              only drops its own parameters (clearParams, in place) and remembers the site — it never writes ?site=
              itself, so one pick is one history entry. */}
          <select className="g-input g-select" value={site?.id ?? ""} onChange={(e) => { onSite(Number(e.target.value)); setParam("site", Number(e.target.value)); }} data-testid="select-seo-site">
            {list.map((s) => <option key={s.id} value={s.id}>{s.domain} · {s.keywordCount} keyword{s.keywordCount === 1 ? "" : "s"}</option>)}
          </select>
        </label>
      )}
      {!adding && <button type="button" className="g-pill" onClick={() => setAdding(true)} data-testid="button-add-site"><Plus /> {list.length ? "Add a site" : "Add your first site"}</button>}
      {adding && <AddSiteForm onDone={(id) => { setAdding(false); if (id) onSite(id); }} />}
    </div>
  );
}

const DEPTHS = [
  { depth: 10, label: "Top 10" },
  { depth: 20, label: "Top 20" },
  { depth: 50, label: "Top 50" },
  { depth: 100, label: "Top 100" },
];

function AddSiteForm({ onDone }: { onDone: (id?: number) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [devices, setDevices] = useState<"both" | "desktop" | "mobile">("both");
  const [serpDepth, setDepth] = useState(10);
  const m = useMutation({
    mutationFn: () => api("POST", "/api/seo/sites", { domain, devices, serpDepth }),
    onSuccess: (site: SeoSite) => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); onDone(site.id); },
    onError: (e) => toast({ title: "Couldn't add the site", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <form className="flex w-full flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) m.mutate(); }} data-testid="form-add-site">
      <input className="g-input sm:max-w-[240px]" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus data-testid="input-site-domain" />
      <select className="g-input g-select sm:w-auto" value={devices} onChange={(e) => setDevices(e.target.value as any)} aria-label="Devices">
        <option value="both">Desktop + mobile</option><option value="desktop">Desktop only</option><option value="mobile">Mobile only</option>
      </select>
      <select className="g-input g-select sm:w-auto" value={serpDepth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="How deep to check">
        {DEPTHS.map((d) => <option key={d.depth} value={d.depth}>{d.label}</option>)}
      </select>
      <div className="flex gap-2">
        <Button type="submit" disabled={m.isPending || !domain.trim()} data-testid="button-save-site">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        <button type="button" className="g-pill" onClick={() => onDone()}>Cancel</button>
      </div>
    </form>
  );
}

/** Position movement since the previous check: a glyph and the number, never colour alone. A position is where the check
 *  found the site in the results it read; "new" / "lost" say found / not found, not that a ranking exists or is gone. */
export function Move({ now, before, hadBefore }: { now: number | null; before: number | null; /** There was an earlier check, so a missing position means "not found then". */ hadBefore?: boolean }) {
  if (hadBefore && now != null && before == null) return <span className="g-move g-move--up" aria-label="Newly found in the results — not found in the last check">new</span>;
  if (hadBefore && now == null && before != null) return <span className="g-move g-move--down" aria-label={`No longer found in the results — was ${before} in the last check`}>lost</span>;
  if (now == null || before == null) return null;
  const d = before - now;
  if (d === 0) return <span className="g-move g-move--flat" aria-label="No change">·</span>;
  return d > 0
    ? <span className="g-move g-move--up" aria-label={`Up ${d}`}>▲{d}</span>
    : <span className="g-move g-move--down" aria-label={`Down ${-d}`}>▼{-d}</span>;
}

/** A summary tile; with `href` the whole tile is a link to the figure's data (links.ts), its label dotted-underlined as the cue. */
export function Tile({ label, value, hint, testId, href }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string; href?: string }) {
  const body = (
    <>
      <div className={`g-tile__label ${href ? "underline decoration-dotted underline-offset-2" : ""}`}>{label}</div>
      <div className="g-tile__value">{value}</div>
      {hint && <div className="g-tile__hint">{hint}</div>}
    </>
  );
  if (href) return <Link href={href} className="g-tile block min-w-0 rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue,#1a73e8)]" data-testid={testId}>{body}</Link>;
  return <div className="g-tile" data-testid={testId}>{body}</div>;
}

export function Empty({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="g-callout" data-testid={testId}>{children}</div>;
}

/** Keyword difficulty 0–100 as a word + number. */
export const kd = (n: number | null | undefined) => n == null ? "—" : `${n} ${n < 30 ? "easy" : n < 60 ? "medium" : "hard"}`;
