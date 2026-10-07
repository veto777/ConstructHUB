/**
 * Shared frame for the SEO pages (/seo, /seo/keywords, /seo/backlinks,
 * /seo/competitors): Google surface with the orange accent, the site picker,
 * the tab strip, this month's DataForSEO budget line, the "Connect DataForSEO"
 * card when the server has no credentials, and the plan gate.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { GoogleSurface } from "@/components/google";
import { AppPage } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { planRequiredFrom } from "@/components/plan-required";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PLANS } from "@shared/plans";

export const api = async (method: string, url: string, body?: unknown) => (await apiRequest(method, url, body)).json();

export type SeoStatus = {
  configured: boolean;
  budget: { month: string; capUsd: number; spentUsd: number; remainingUsd: number; accountUsd: number; accountRequests: number };
  prices: { fetchedOn: string; minimumDepositUsd: number; lines: { what: string; price: string; source: string }[]; example: string };
};
export type SeoSite = {
  id: number; domain: string; locationCode: number; languageCode: string; devices: "desktop" | "mobile" | "both"; serpDepth: number;
  keywordCount: number; nextRankCheckAt: string | null; lastRankCheckAt: string | null; nextBacklinksAt: string | null; lastBacklinksAt: string | null;
};

export const fmtUsd = (n: number | null | undefined) => n == null ? "—" : n > 0 && n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
export const fmtNum = (n: number | null | undefined) => n == null ? "—" : Math.round(n).toLocaleString("en-US");
export const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export const useSeoStatus = () => useQuery<SeoStatus>({ queryKey: ["/api/seo/status"] });
export const useSeoSites = () => useQuery<SeoSite[]>({ queryKey: ["/api/seo/sites"] });

const SITE_KEY = "seo:site";
/** The chosen site: remembered per browser; falls back to the first one. */
export function useSelectedSite(sites: SeoSite[] | undefined): [SeoSite | null, (id: number) => void] {
  const [id, setId] = useState<number | null>(() => { try { return Number(localStorage.getItem(SITE_KEY)) || null; } catch { return null; } });
  const site = sites?.find((s) => s.id === id) ?? sites?.[0] ?? null;
  useEffect(() => { if (site && site.id !== id) { setId(site.id); try { localStorage.setItem(SITE_KEY, String(site.id)); } catch { /* private window */ } } }, [site, id]);
  return [site, (next) => { setId(next); try { localStorage.setItem(SITE_KEY, String(next)); } catch { /* private window */ } }];
}

const TABS = [
  { href: "/seo", label: "Rank tracker" },
  { href: "/seo/keywords", label: "Keywords" },
  { href: "/seo/backlinks", label: "Backlinks" },
  { href: "/seo/competitors", label: "Competitors" },
];

export function SeoShell({ title, description, actions, children, site, onSite, sites, status }: {
  title: string; description: string; actions?: ReactNode; children: ReactNode;
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
            <nav className="g-tabs" aria-label="SEO sections">
              {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={location === t.href ? "page" : undefined}>{t.label}</Link>)}
            </nav>
            <SitePicker site={site} onSite={onSite} sites={sites} />
            <BudgetLine status={status} />
            {status.data && !status.data.configured && <ConnectCard status={status.data} />}
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
      <h3>SEO tools are included with the {PLANS[requiredPlan].name} plan</h3>
      <p>{message}</p>
      <div className="mt-3"><Link href="/pricing" className="g-pill g-pill--solid">See {PLANS[requiredPlan].name}</Link></div>
    </div>
  );
}

function BudgetLine({ status }: { status: ReturnType<typeof useSeoStatus> }) {
  const b = status.data?.budget;
  if (!b) return null;
  const pct = b.capUsd > 0 ? Math.min(100, Math.round((b.spentUsd / b.capUsd) * 100)) : 100;
  return (
    <p className="g-text-2 mb-4 text-[13px]" data-testid="seo-budget-line">
      SEO data this month: <b className="g-text font-medium">{fmtUsd(b.spentUsd)}</b> of {fmtUsd(b.capUsd)} ({pct}%) · {status.data?.configured ? "DataForSEO connected" : "DataForSEO not connected"}
      {b.accountRequests > 0 && <> · {b.accountRequests.toLocaleString("en-US")} request{b.accountRequests === 1 ? "" : "s"} by this account ({fmtUsd(b.accountUsd)})</>}
    </p>
  );
}

/** Shown while the DataForSEO credentials (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD, server env) are not set. Prices are the server's price sheet (vendor pages, 2026-10-06). */
export function ConnectCard({ status }: { status: SeoStatus }) {
  const p = status.prices;
  return (
    <div className="g-callout mb-5" data-testid="seo-connect-card">
      <h3>Connect DataForSEO to start</h3>
      <p>
        Rank checks, keyword research, backlinks and competitor gaps come from DataForSEO, pay-as-you-go: no plan, no monthly fee, a one-time
        minimum top-up of ${p.minimumDepositUsd} that never expires. DataForSEO is not connected yet — your ConstructHUB administrator connects it
        in the server settings. Spend is capped at {fmtUsd(status.budget.capUsd)} a month.
      </p>
      <ul>
        {p.lines.map((l) => <li key={l.what}><b className="g-text font-medium">{l.what}:</b> {l.price}</li>)}
      </ul>
      <p className="mt-2">{p.example}</p>
      <p className="mt-1 text-[12px]">Prices from DataForSEO's pricing pages on {p.fetchedOn}.</p>
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
          <select className="g-input g-select" value={site?.id ?? ""} onChange={(e) => onSite(Number(e.target.value))} data-testid="select-seo-site">
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
  { depth: 10, label: "Top 10 ($0.0006 per check)" },
  { depth: 20, label: "Top 20 ($0.0012 per check)" },
  { depth: 50, label: "Top 50 ($0.003 per check)" },
  { depth: 100, label: "Top 100 ($0.006 per check)" },
];

function AddSiteForm({ onDone }: { onDone: (id?: number) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [devices, setDevices] = useState<"both" | "desktop" | "mobile">("both");
  const [serpDepth, setDepth] = useState(10);
  const m = useMutation({
    mutationFn: () => api("POST", "/api/seo/sites", { domain, devices, serpDepth }),
    onSuccess: (site: SeoSite) => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); onDone(site.id); },
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

/** Position movement since the previous check: a glyph and the number, never colour alone. */
export function Move({ now, before }: { now: number | null; before: number | null }) {
  if (now == null || before == null) return null;
  const d = before - now;
  if (d === 0) return <span className="g-move g-move--flat" aria-label="No change">·</span>;
  return d > 0
    ? <span className="g-move g-move--up" aria-label={`Up ${d}`}>▲{d}</span>
    : <span className="g-move g-move--down" aria-label={`Down ${-d}`}>▼{-d}</span>;
}

export function Tile({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="g-tile" data-testid={testId}>
      <div className="g-tile__label">{label}</div>
      <div className="g-tile__value">{value}</div>
      {hint && <div className="g-tile__hint">{hint}</div>}
    </div>
  );
}

export function Empty({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="g-callout" data-testid={testId}>{children}</div>;
}

/** Keyword difficulty 0–100 as a word + number. */
export const kd = (n: number | null | undefined) => n == null ? "—" : `${n} ${n < 30 ? "easy" : n < 60 ? "medium" : "hard"}`;
