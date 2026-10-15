/**
 * "Look up any website" — the SEO Suite's front door (owner, 2026-10-15: "a very very important tool, and a way to add
 * that URL to your list of businesses"). One box, two buttons:
 *
 *   Look it up    → Site explorer for that site. Opening it buys NOTHING: a saved report opens free, otherwise the
 *                   explorer's own Analyse button waits, with the price beside it (explorer.tsx).
 *   Add to my sites → POST /api/seo/sites, the same request the shell's "Add a site" form and Site explorer send
 *                   (desktop + mobile, top 10). Free: a site with no keywords is never checked (server/seo/jobs.ts
 *                   reads only sites that have keywords), and the dashboard card's Analyse / Run first crawl each
 *                   show their cost before they run.
 *
 * The typed address is cleaned here (domain.ts) the way the server cleans it, so "https://www.Example.com/about"
 * is looked up and saved as example.com. A text the server would refuse is said so here, with no request sent.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, priceOf, refreshSeoData, SAVED_FOR, type SeoSite, type SeoStatus } from "./shell";
import { seoLinks } from "./links";
import { cleanDomain } from "./domain";

/**
 * Adds a website to the account's sites (dashboard + rank tracker) — the one request every "Add to my sites" button
 * sends. A site already on the list is not sent again: it is simply chosen, and the caller is told.
 */
export function useAddSite({ sites, onSite, onAdded }: { sites: SeoSite[] | undefined; onSite: (id: number) => void; onAdded?: (site: SeoSite, already: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: (domain: string) => api("POST", "/api/seo/sites", { domain, devices: "both", serpDepth: 10 }) as Promise<SeoSite>,
    onSuccess: (site) => { refreshSeoData(qc); onSite(site.id); toast({ title: `${site.domain} added to your sites`, description: "It's on your SEO dashboard. Add the keywords you care about under Rank tracker — checks only run, and only cost SEO data, once there are keywords." }); onAdded?.(site, false); },
    onError: (e) => toast({ title: "Couldn't add the site", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const add = (domain: string) => {
    const have = (sites ?? []).find((s) => s.domain === domain);
    if (have) { onSite(have.id); toast({ title: `${domain} is already one of your sites` }); onAdded?.(have, true); return; }
    m.mutate(domain);
  };
  return { add, pending: m.isPending, pendingDomain: m.isPending ? m.variables ?? null : null };
}

export function LookupBox({ status, sites, onSite }: { status: SeoStatus | undefined; sites: SeoSite[] | undefined; onSite: (id: number) => void }) {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const adder = useAddSite({ sites, onSite });
  const domain = cleanDomain(text);
  const check = (): string | null => { if (domain) { setError(null); return domain; } setError("Enter a website like example.com — a full address is fine too."); return null; };
  const lookUp = () => { const d = check(); if (d) navigate(seoLinks.explorer(d)); };
  const addSite = () => { const d = check(); if (d) adder.add(d); };
  const price = priceOf(status, "explorerReport");
  return (
    <section className="g-callout mb-4" aria-labelledby="seo-lookup-title" data-testid="seo-lookup">
      <h3 id="seo-lookup-title" className="flex items-center gap-2"><Search className="h-4 w-4" aria-hidden /> Look up any website</h3>
      <p>Yours or a competitor's. Type the site name or paste its address, then look it up — or add it straight to your sites.</p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); lookUp(); }} data-testid="form-seo-lookup">
        <label className="min-w-0 flex-1 sm:max-w-xl"><span className="sr-only">Website</span>
          <input className="g-input w-full" placeholder="example.com" value={text} onChange={(e) => { setText(e.target.value); if (error) setError(null); }} autoComplete="off" spellCheck={false} inputMode="url" aria-invalid={!!error} aria-describedby={error ? "seo-lookup-error" : "seo-lookup-note"} data-testid="input-seo-lookup" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!text.trim()} data-testid="button-seo-lookup"><Search className="mr-1 h-4 w-4" aria-hidden /> Look it up</Button>
          <button type="button" className="g-pill min-h-[44px]" disabled={!text.trim() || adder.pending} onClick={addSite} data-testid="button-seo-lookup-add">{adder.pending ? <Loader2 className="animate-spin" /> : <Plus />} Add to my sites</button>
        </div>
      </form>
      {domain && domain !== text.trim() && <p className="mt-1 text-[12px]" data-testid="text-seo-lookup-cleaned">Read as <b className="g-text font-medium">{domain}</b>.</p>}
      {error && <p id="seo-lookup-error" className="mt-1 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="text-seo-lookup-error">{error}</p>}
      <p id="seo-lookup-note" className="mt-2 text-[12px]" data-testid="text-seo-lookup-note">
        <b className="g-text font-medium">Look it up</b> opens Site explorer. A report you already have opens free for {SAVED_FOR}; a new one{price ? ` costs ${price} of your SEO data and` : ""} is bought only when you press Analyse there.
        {" "}<b className="g-text font-medium">Add to my sites</b> is free: the site goes on this dashboard and in the rank tracker, and nothing is checked or charged until you add keywords.
      </p>
    </section>
  );
}
