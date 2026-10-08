/**
 * /seo/usage — where the SEO data went: every lookup, what it was and what it
 * cost, with the month's totals and credit purchases (GET /api/seo/usage).
 * Free to open.
 */
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtNum, money, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Row = { id: string; at: string; what: string; status: "charged" | "free" | "running"; cents: number; fromIncluded: number; fromPurchased: number };
type Usage = { rows: Row[]; purchases: { at: string; cents: number }[]; months: { month: string; cents: number; lookups: number }[] };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const csvCell = (v: string | number) => { const s = String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export default function SeoUsagePage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const q = useQuery<Usage>({ queryKey: ["/api/seo/usage"] });
  const d = q.data, c = status.data?.credits, unlimited = c?.includedCents === -1;
  const thisMonth = d?.months[0];
  const exportCsv = () => {
    if (!d) return;
    const blob = new Blob([[["When", "What", "Status", "Cost (USD)", "From included data", "From purchased credit"], ...d.rows.map((r) => [new Date(r.at).toISOString(), r.what, r.status === "charged" ? "Charged" : r.status === "free" ? "No charge" : "Running", (r.cents / 100).toFixed(2), (r.fromIncluded / 100).toFixed(2), (r.fromPurchased / 100).toFixed(2)])].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "seo-data-usage.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <SeoShell title="Usage" description="Every SEO data lookup on your account: what it was, when, and what it cost." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      {q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your usage…</p>}
      {q.isError && <div className="g-callout" role="alert" data-testid="usage-error"><h3>Couldn't load your usage</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {d && (
        <>
          <div className="g-tiles mb-5">
            <Tile label="Used this month" value={unlimited ? "Unlimited plan" : money(thisMonth?.cents ?? 0)} hint={`${fmtNum(thisMonth?.lookups ?? 0)} lookup${thisMonth?.lookups === 1 ? "" : "s"}`} testId="tile-usage-month" />
            {c && !unlimited && <Tile label="Included data left" value={money(Math.max(0, c.includedCents - c.includedUsedCents))} hint={`of ${money(c.includedCents)} a month — comes back on the 1st`} testId="tile-usage-included" />}
            {c && !unlimited && <Tile label="Purchased credit" value={money(c.walletCents)} hint="Never expires; used after the included data" testId="tile-usage-wallet" />}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="g-text text-[16px] font-medium">Lookups</h2>
            <span className="g-text-2 text-[13px]">the latest {fmtNum(d.rows.length)}</span>
            <button type="button" className="g-pill g-pill--sm ml-auto" disabled={!d.rows.length} onClick={exportCsv} data-testid="button-usage-export"><Download /> Export</button>
          </div>
          {d.rows.length === 0 ? (
            <Empty testId="usage-empty"><h3>No lookups yet</h3><p>Each report, keyword lookup, rank check and backlink refresh will be listed here with its cost. Opening something you already ran is free and is not listed.</p></Empty>
          ) : (
            <table className="g-table" data-testid="table-usage">
              <thead><tr><th>When</th><th>What</th><th className="num">Cost</th><th>Paid from</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="g-text-2 whitespace-nowrap">{when(r.at)}</td>
                    <td data-label="What">{r.what}</td>
                    <td className="num" data-label="Cost">{r.status === "running" ? <span className="g-text-2" title="Still running — this is the amount set aside">up to {money(r.cents)}</span> : r.status === "free" ? <span className="g-text-2">no charge</span> : money(r.cents)}</td>
                    <td data-label="Paid from" className="g-text-2">{r.status !== "charged" ? "—" : [r.fromIncluded ? `included data ${money(r.fromIncluded)}` : "", r.fromPurchased ? `purchased credit ${money(r.fromPurchased)}` : ""].filter(Boolean).join(" + ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="g-text-2 mt-2 text-[12px]">A lookup that fails or returns nothing is not charged. While one is running, the most it can cost is set aside and the unused part comes straight back.</p>

          {d.months.length > 1 && (
            <section className="mt-6" data-testid="usage-months">
              <h2 className="g-text mb-2 text-[16px] font-medium">By month</h2>
              <table className="g-table"><thead><tr><th>Month</th><th className="num">Lookups</th><th className="num">SEO data used</th></tr></thead>
                <tbody>{d.months.map((m) => <tr key={m.month}><td>{monthName(m.month)}</td><td className="num" data-label="Lookups">{fmtNum(m.lookups)}</td><td className="num" data-label="Used">{money(m.cents)}</td></tr>)}</tbody>
              </table>
            </section>
          )}
          {d.purchases.length > 0 && (
            <section className="mt-6" data-testid="usage-purchases">
              <h2 className="g-text mb-2 text-[16px] font-medium">Credit you bought</h2>
              <table className="g-table"><thead><tr><th>When</th><th className="num">Credit added</th></tr></thead>
                <tbody>{d.purchases.map((p, i) => <tr key={i}><td>{when(p.at)}</td><td className="num" data-label="Credit">{money(p.cents)}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}
