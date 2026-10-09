/**
 * /seo/usage — where the SEO data went: every lookup, what it was and what it
 * cost, with the month's totals and credit purchases (GET /api/seo/usage).
 * Free to open.
 *
 * Every row opens the page that spent it when the ledger names it (a Site Explorer report its domain, a rank check its
 * site, a keyword lookup its keyword); ?month= narrows the lookups to one month (links.ts seoLinks.usage) and
 * ?credits=add opens the add-credit panel in the usage line above.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { ActiveFilter, clearParams, Empty, fmtNum, money, SeoShell, Tile, useAddress, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { seoLinks } from "./links";
import { spentOn } from "./usage-links";
import { FIGURE_LINK, FOCUS_RING, QUIET_LINK, TEXT_LINK } from "./viz-more";

type Row = { id: string; at: string; what: string; status: "charged" | "free" | "running"; cents: number; fromIncluded: number; fromPurchased: number };
type Usage = { rows: Row[]; purchases: { at: string; cents: number }[]; months: { month: string; cents: number; lookups: number }[]; thisMonth?: string };

/** Date and time in the reader's own zone, named — the one place a clock time is shown (the export keeps the ISO UTC time). */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
/** A month from the address in words — or as written, quoted, when it is not one (never "Invalid Date"). */
const monthWords = (m: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? monthName(m) : `"${m}"`);
/** A whole tile as a link: its label carries the dotted underline (the cue without a hover), the focus ring around it. */
const TILE_LINK = `block min-w-0 rounded-lg ${FOCUS_RING} [&_.g-tile__label]:underline [&_.g-tile__label]:decoration-dotted [&_.g-tile__label]:underline-offset-2`;
const csvCell = (v: string | number) => { const s = String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export default function SeoUsagePage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const params = useAddress();
  const month = params.get("month");
  const q = useQuery<Usage>({ queryKey: ["/api/seo/usage"], refetchOnMount: "always" });
  const d = q.data, c = status.data?.credits, unlimited = c?.includedCents === -1;
  // The row of the calendar month we are in — not simply the newest month that has one.
  const now = d?.thisMonth ?? new Date().toISOString().slice(0, 7);
  const thisMonth = d?.months.find((m) => m.month === now);
  const rows = d ? (month ? d.rows.filter((r) => r.at.slice(0, 7) === month) : d.rows) : [];
  const exportCsv = () => {
    if (!d) return;
    const blob = new Blob([[["When", "What", "Status", "Cost (USD)", "From included data", "From purchased credit"], ...d.rows.map((r) => [new Date(r.at).toISOString(), r.what, r.status === "charged" ? "Charged" : r.status === "free" ? "No charge" : "Running", (r.cents / 100).toFixed(2), (r.fromIncluded / 100).toFixed(2), (r.fromPurchased / 100).toFixed(2)])].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "seo-data-usage.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <SeoShell title="Usage" description="Every SEO data lookup on your account: what it was, when, and what it cost." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      {month && <ActiveFilter onClear={() => clearParams(["month"], false)} clearLabel="Every month">{/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `Lookups in ${monthName(month)}` : `"${month}" — not a month (YYYY-MM)`}{d ? ` — ${fmtNum(rows.length)} of the latest ${fmtNum(d.rows.length)}` : ""}</ActiveFilter>}
      {q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your usage…</p>}
      {q.isError && <div className="g-callout" role="alert" data-testid="usage-error"><h3>Couldn't load your usage</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {d && (
        <>
          {/* Each figure opens what explains it: this month's lookups, or the add-credit panel. */}
          <div className="g-tiles mb-5">
            <Link href={seoLinks.usage({ month: now })} className={TILE_LINK} data-testid="link-usage-month"><Tile label="Used this month" value={unlimited ? "Unlimited plan" : money(thisMonth?.cents ?? 0)} hint={`${fmtNum(thisMonth?.lookups ?? 0)} lookup${thisMonth?.lookups === 1 ? "" : "s"}`} testId="tile-usage-month" /></Link>
            {c && !unlimited && <Link href={seoLinks.usage({ month: now })} className={TILE_LINK} data-testid="link-usage-included"><Tile label="Included data left" value={money(Math.max(0, c.includedCents - c.includedUsedCents))} hint={`of ${money(c.includedCents)} a month — comes back on the 1st`} testId="tile-usage-included" /></Link>}
            {c && !unlimited && <Link href={seoLinks.usage({ credits: "add" })} className={TILE_LINK} data-testid="link-usage-wallet"><Tile label="Purchased credit" value={money(c.walletCents)} hint="Never expires; used after the included data" testId="tile-usage-wallet" /></Link>}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="g-text text-[16px] font-medium">Lookups</h2>
            <span className="g-text-2 text-[13px]">{month ? <><Link href={seoLinks.usage({ month })} className={QUIET_LINK}>{fmtNum(rows.length)} in {monthWords(month)}</Link>, of </> : ""}<Link href={seoLinks.usage()} className={QUIET_LINK}>{d.rows.length >= 200 ? "the latest 200" : `the latest ${fmtNum(d.rows.length)}`}</Link>{d.rows.length >= 200 ? " — older lookups are in the monthly totals below" : ""}</span>
            <button type="button" className="g-pill g-pill--sm !min-h-11 ml-auto" disabled={!d.rows.length} onClick={exportCsv} data-testid="button-usage-export"><Download /> Export</button>
          </div>
          {d.rows.length === 0 ? (
            <Empty testId="usage-empty"><h3>No lookups yet</h3><p>Each report, keyword lookup, rank check and backlink refresh will be listed here with its cost. Opening something you already ran is free and is not listed.</p></Empty>
          ) : rows.length === 0 ? (
            <Empty testId="usage-none-in-month"><h3>No lookups in {monthWords(month!)} among the latest {fmtNum(d.rows.length)}</h3><p>The monthly totals below count every lookup, also the older ones this list no longer shows.</p></Empty>
          ) : (
            <table className="g-table" data-testid="table-usage">
              <thead><tr><th>When</th><th>What</th><th className="num">Cost</th><th>Paid from</th></tr></thead>
              {/* A lookup opens the page it was made on when its words say which (the ledger keeps the words, not the page). */}
              <tbody>
                {rows.map((r) => { const to = spentOn(r.what, sites.data ?? []), inMonth = seoLinks.usage({ month: r.at.slice(0, 7) }); return (
                  <tr key={r.id}>
                    <td className="g-text-2 whitespace-nowrap"><Link href={inMonth} className={QUIET_LINK}>{when(r.at)}</Link></td>
                    <td data-label="What">{to ? <Link href={to} className={TEXT_LINK} data-testid={`link-usage-${r.id}`}>{r.what}</Link> : <span title="The ledger's words do not say which of your pages this was (or the site is no longer yours)">{r.what}</span>}</td>
                    {/* The cost opens the page that spent it (else that month's lookups); what paid for it opens the balance it came from. */}
                    <td className="num" data-label="Cost"><Link href={to ?? inMonth} className={r.status === "charged" ? FIGURE_LINK : `${QUIET_LINK} g-text-2`}>{r.status === "running" ? `up to ${money(r.cents)} set aside — still running` : r.status === "free" ? "no charge" : money(r.cents)}</Link></td>
                    <td data-label="Paid from" className="g-text-2">{r.status !== "charged" ? "—" : <>{r.fromIncluded ? <Link href={seoLinks.usage({ month: r.at.slice(0, 7) })} className={QUIET_LINK} title="This month's included SEO data">included data {money(r.fromIncluded)}</Link> : null}{r.fromIncluded && r.fromPurchased ? " + " : null}{r.fromPurchased ? <Link href={seoLinks.usage({ credits: "add" })} className={QUIET_LINK} title="Your purchased credit">purchased credit {money(r.fromPurchased)}</Link> : null}</>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
          <p className="g-text-2 mt-2 text-[12px]">A lookup that fails or returns nothing is not charged. While one is running, the most it can cost is set aside and the unused part comes straight back.</p>

          {d.months.length > 1 && (
            <section className="mt-6" data-testid="usage-months">
              <h2 className="g-text mb-2 text-[16px] font-medium">By month</h2>
              {/* A month opens its lookups above (the latest 200 only; the totals here count every one). */}
              <table className="g-table"><thead><tr><th>Month</th><th className="num">Lookups</th><th className="num">SEO data used</th></tr></thead>
                <tbody>{d.months.map((m) => <tr key={m.month} style={month === m.month ? { background: "var(--g-hover, rgba(26,115,232,.06))" } : undefined}><td><Link href={seoLinks.usage({ month: m.month })} className={TEXT_LINK} data-testid={`link-usage-month-${m.month}`}>{monthName(m.month)}</Link></td><td className="num" data-label="Lookups"><Link href={seoLinks.usage({ month: m.month })} className={FIGURE_LINK}>{fmtNum(m.lookups)}</Link></td><td className="num" data-label="Used"><Link href={seoLinks.usage({ month: m.month })} className={FIGURE_LINK}>{money(m.cents)}</Link></td></tr>)}</tbody>
              </table>
            </section>
          )}
          {d.purchases.length > 0 && (
            <section className="mt-6" data-testid="usage-purchases">
              <h2 className="g-text mb-2 text-[16px] font-medium">Credit you bought</h2>
              {/* A purchase has no page of its own here (the receipt was emailed by Stripe); its month opens that month's lookups. */}
              <table className="g-table"><thead><tr><th>When</th><th className="num">Credit added</th></tr></thead>
                <tbody>{d.purchases.map((p, i) => <tr key={i}><td><Link href={seoLinks.usage({ month: p.at.slice(0, 7) })} className={QUIET_LINK}>{when(p.at)}</Link></td><td className="num" data-label="Credit"><Link href={seoLinks.usage({ credits: "add" })} className={FIGURE_LINK} title="Your purchased credit (the add-credit panel)">{money(p.cents)}</Link></td></tr>)}</tbody>
              </table>
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}
