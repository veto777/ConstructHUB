/**
 * Site Explorer -> Directories: which review sites, trade directories, maps and social profiles link to
 * this site — and to up to three competitors — side by side. A directory that links to a competitor and
 * not to you is a link worth checking for: it says nothing about whether you have a profile there.
 * See server/seo/directories.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, isNotRunYet, money, type SeoStatus } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Kind = "reviews" | "trade" | "maps" | "social" | "business";
type Row = { domain: string; name: string; kind: Kind; links: (number | null)[]; uncounted?: boolean[] };
type Data = { sites: string[]; rows: Row[]; missing: string[]; partial?: string[]; fetchedAt: string };
const KIND: Record<Kind, string> = { reviews: "Review sites", trade: "Trade directories", maps: "Maps and neighbourhoods", business: "Business directories", social: "Social profiles" };
const ORDER: Kind[] = ["reviews", "trade", "maps", "business", "social"];
const MAX_RIVALS = 3;
const clean = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
const looksLikeDomain = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export function DirectoriesView({ domain, status, suggestions, planSiteId }: { domain: string; status: SeoStatus | undefined; /** Likely competitors to offer. */ suggestions: string[]; /** The customer's own site, when this is it. */ planSiteId?: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<string[] | null>(null);
  useEffect(() => { setDraft([]); setInput(""); setApplied(null); }, [domain]);
  const add = (d: string) => { const c = clean(d); if (looksLikeDomain(c) && c !== domain && !draft.includes(c) && draft.length < MAX_RIVALS) setDraft([...draft, c]); setInput(""); };
  const body = useMemo(() => (applied ? { domain, competitors: applied } : null), [domain, applied]);
  const queryKey = ["/api/seo/directories", body];
  const saved = useQuery<{ page: Data } | null>({
    queryKey, enabled: !!body, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/directories", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; key: readonly unknown[]; again: boolean; missingOnly?: boolean }) => api("POST", "/api/seo/directories", v.missingOnly ? { ...v.body, retryMissing: true } : v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: { page: Data; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    // A second try with nothing saved to complete buys nothing: look again, so the full offer and its price come back.
    onError: (e, v) => { toast({ title: "Couldn't check the directories", description: apiErrorMessage(e), variant: "destructive" }); if (v.missingOnly) void qc.invalidateQueries({ queryKey: v.key }); },
  });
  // The server's own figure for exactly this many sites — what is set aside, and the most that can be charged.
  const quote = (sites: number) => status?.quotes?.directories?.[sites - 1] ?? null;
  const sitesAsked = 1 + (applied ?? draft).length;
  const price = quote(sitesAsked);
  // Without a price on screen nothing can be bought here.
  const canPay = price != null && (!status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= price);
  const d = saved.data?.page ?? null;
  const dirty = !!applied && (applied.length !== draft.length || applied.some((c, i) => c !== draft[i]));
  const us = d ? d.sites.indexOf(domain) : -1;
  const usKnown = d ? !d.missing.includes(domain) : false;
  // A gap: we are not linked from it (known), and at least one competitor is.
  const isGap = (r: Row) => usKnown && r.links[us] === 0 && r.links.some((n, i) => i !== us && (n ?? 0) > 0);
  const gaps = d ? d.rows.filter(isGap) : [];
  const onIt = d && usKnown ? d.rows.filter((r) => (r.links[us] ?? 0) > 0).length : null;
  const planTask = (r: Row): PlanTask => ({ kind: "link_prospect", title: `Check your ${r.name} profile and its link to the website`, target: r.domain, facts: { linksTo: d!.sites.filter((s, i) => i !== us && (r.links[i] ?? 0) > 0).join(", ") }, source: `dir:${r.domain}` });
  const exportCsv = () => {
    if (!d) return;
    const rows: (string | number | null)[][] = [["Directory", "Kind", ...d.sites.map((s) => `Links found to ${s}`)], ...d.rows.map((r) => [r.name, KIND[r.kind], ...r.links.map((n, i) => (n == null ? "not checked" : r.uncounted?.[i] ? "found (number unknown)" : n))])];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${domain}-directories.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div data-testid="directories">
      <p className="g-text-2 mb-3 text-[13px]">The review sites, trade directories, maps and social profiles that matter to a local contractor — which of them link to {domain}, and to your competitors. Compare with up to {MAX_RIVALS} competitors to see which directories link to them and not to you. A missing link is something to check, not proof that you have no profile there.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        {draft.map((c) => <span key={c} className="g-chip">{c} <button type="button" onClick={() => setDraft(draft.filter((x) => x !== c))} aria-label={`Remove ${c}`}><X className="inline h-3 w-3" /></button></span>)}
        {draft.length < MAX_RIVALS && (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(input); }}>
            <label><span className="sr-only">A competitor's website</span><input className="g-input !py-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="competitor.com" data-testid="input-directories-rival" /></label>
            <button type="submit" className="g-pill g-pill--sm" disabled={!looksLikeDomain(clean(input))}><Plus /> Add</button>
          </form>
        )}
        {suggestions.filter((s) => s !== domain && !draft.includes(s)).slice(0, 4).map((s) => draft.length < MAX_RIVALS ? <button key={s} type="button" className="g-pill g-pill--sm" onClick={() => add(s)} title="Add this competitor">+ {s}</button> : null)}
      </div>
      {(!applied || dirty) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => setApplied([...draft])} data-testid="button-directories-prepare">{applied ? "Use these sites" : `Check ${draft.length ? `${1 + draft.length} sites` : "this site"}`}</Button>
          <span className="g-text-2 text-[13px]">{quote(1 + draft.length) != null ? `Up to ${money(quote(1 + draft.length)!)} of your SEO data for ${draft.length ? `these ${1 + draft.length} sites` : "this site"}; kept for a day and free to reopen.` : status ? "The price couldn't be loaded, so this can't be bought yet — reload the page." : "Getting the price…"}</span>
        </div>
      )}
      {applied && !dirty && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved copy…</p>}
      {applied && !dirty && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved copy</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {applied && !dirty && saved.isSuccess && !d && (
        <Empty testId="directories-not-run">
          <h3>{sitesAsked} site{sitesAsked === 1 ? "" : "s"} ready to check</h3>
          <p>{price == null ? "The price couldn't be loaded, so this can't be bought yet — reload the page." : !canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay || !body} onClick={() => body && run.mutate({ body, key: queryKey, again: false })} data-testid="button-directories-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking…</> : <><Play className="mr-1 h-4 w-4" /> Check the directories{price != null ? ` — up to ${money(price)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && applied && !dirty && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-directories-meta">
              {onIt != null ? `${domain} is linked from ${onIt} of these ${d.rows.length}` : `${domain}'s own check didn't load`}{d.sites.length > 1 && usKnown ? ` · ${gaps.length} that link to a competitor and not to you` : ""} · as of {fmtDate(d.fetchedAt)} ·{" "}
              <button type="button" className="g-link" disabled={run.isPending || !canPay || !status?.configured || !body} onClick={() => body && run.mutate({ body, key: queryKey, again: true })}>{run.isPending ? "Checking…" : `Check again${price != null ? ` — up to ${money(price)}` : ""}`}</button>
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {planSiteId != null && gaps.length > 0 && <AddToPlan siteId={planSiteId} label={`Add the ${gaps.length} to check to the plan`} testId="button-directories-plan" tasks={gaps.map(planTask)} />}
              <button type="button" className="g-pill g-pill--sm" onClick={exportCsv} data-testid="button-directories-export"><Download /> Export</button>
            </span>
          </div>
          {d.missing.length > 0 && <p className="mb-2 text-[13px]" role="status" style={{ color: "var(--g-red)" }} data-testid="text-directories-missing">The check for {d.missing.join(", ")} didn't load and was not charged — {d.missing.length === 1 ? "its column shows" : "their columns show"} "?" rather than a guess.{" "}
            <button type="button" className="g-link" disabled={run.isPending || !status?.configured || !body || quote(d.missing.length) == null || !(status?.credits == null || status.credits.availableCents === -1 || status.credits.availableCents >= quote(d.missing.length)!)} onClick={() => body && run.mutate({ body, key: queryKey, again: false, missingOnly: true })} data-testid="button-directories-retry">
              {run.isPending ? "Checking…" : `Check just ${d.missing.length === 1 ? "that site" : "those sites"} again${quote(d.missing.length) != null ? ` — up to ${money(quote(d.missing.length)!)}` : ""}`}
            </button> The columns that loaded are kept and not bought again.</p>}
          {(d.partial?.length ?? 0) > 0 && <p className="mb-2 text-[13px]" role="status" data-testid="text-directories-partial">For {d.partial!.join(", ")} there were more linking pages than one lookup returns. A directory not among them shows "?" for {d.partial!.length === 1 ? "that site" : "those sites"} — not looked at, rather than "no link".</p>}
          <div className="overflow-x-auto">
            <table className="g-table" data-testid="table-directories">
              <caption className="sr-only">For each directory, how many links it has to each site. A dash means no link was found, which is not the same as having no profile there.</caption>
              <thead><tr><th scope="col">Directory</th>{d.sites.map((s) => <th key={s} scope="col" className="num">{s === domain ? <b className="font-medium">{s}</b> : s}</th>)}{planSiteId != null && <th><span className="sr-only">Action plan</span></th>}</tr></thead>
                {ORDER.map((kind) => {
                  const rows = d.rows.filter((r) => r.kind === kind);
                  return rows.length ? (
                    <tbody key={kind}>
                    <tr><th scope="rowgroup" colSpan={1 + d.sites.length + (planSiteId != null ? 1 : 0)} className="g-text-2 text-left text-[12px] font-medium uppercase tracking-wide">{KIND[kind]}</th></tr>
                    {rows.map((r) => (
                      <tr key={r.domain} style={isGap(r) ? { background: "rgba(197,34,31,.06)" } : undefined}>
                        <th scope="row" className="text-left font-normal"><a href={`https://${r.domain}`} className="g-link" target="_blank" rel="noreferrer">{r.name}</a>{isGap(r) && <span className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: "#c5221f", color: "#fff" }}>Link to check</span>}</th>
                        {r.links.map((n, i) => <td key={i} className="num" data-label={d.sites[i]}>{n == null ? <span className="g-text-2"><span aria-hidden>?</span><span className="sr-only">Not checked for this site</span></span> : n > 0 ? <span style={{ color: "#188038" }} className="font-medium"><span aria-hidden>✓ </span><span className="g-text-2 font-normal">{r.uncounted?.[i] ? "linked" : `${n} link${n === 1 ? "" : "s"}`}</span></span> : <span className="g-text-2"><span aria-hidden>—</span><span className="sr-only">No link found</span></span>}</td>)}
                        {planSiteId != null && <td className="num">{usKnown && r.links[us] === 0 ? <AddToPlan siteId={planSiteId} label="Plan" testId={`button-plan-${r.domain}`} tasks={[planTask(r)]} /> : null}</td>}
                      </tr>
                    ))}
                    </tbody>
                  ) : null;
                })}
            </table>
          </div>
          <p className="g-text-2 mt-2 text-[12px]">A directory counts here only when a page on it <b>links to the website</b> and the link database has seen that page. A profile with no website link, a brand-new listing, or a page the database has not crawled shows as a dash — so a dash means "no link found", not "not listed". The list is {d.rows.length} directories chosen for US home-service contractors, not every directory there is.</p>
        </>
      )}
    </div>
  );
}
