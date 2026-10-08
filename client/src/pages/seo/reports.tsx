/**
 * /seo/reports — the SEO report for a site: where it stands and what changed,
 * to read here, download as a PDF, or have emailed every week or month (to
 * you, or to a client). Built from saved numbers only (GET /api/seo/sites/:id/report):
 * making or sending a report never spends SEO data.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Mover = { keyword: string; location: string | null; device: string; from: number | null; to: number | null };
type Report = {
  domain: string; generatedAt: string; comparedWith: string | null;
  rankings: { byTag?: { tag: string; keywords: number; top3: number; top10: number; top10Change: number | null; visibility: number | null; visibilityChange: number | null; compared: number; newSince: number; weighted?: boolean; changeWeighted?: boolean | null }[]; moreTags?: number; tracked: number; checked?: number; device?: string; improvedCount?: number; declinedCount?: number; checkedOn: string | null; top3: number; top10: number; averagePosition: number | null; inMapPack: number; withMapPack: number; improved: Mover[]; declined: Mover[];
    keywords: { keyword: string; location: string | null; position: number | null; previous: number | null; local: number | null; volume: number | null }[] } | null;
  search: { fetchedAt: string } | null;
  searchConsole?: { clicks: number; /** The server's verdict on the reads of these days: unfinished / failed, or not checkable (`completenessUnknown`) — the counts may be short and are not compared. */ incomplete?: boolean; completenessUnknown?: boolean } | null;
  audit: { scannedAt: string | null; health: number | null; topIssues: { title: string; severity: string; count: number }[] } | null;
  auditUnreadable?: string | null; auditUnavailable?: boolean;
  alerts: { title: string; kind: string; createdAt: string }[];
  work?: { unavailable?: boolean; since?: string | null; days: number; done: { title: string; doneAt: string; target: string | null; note: string | null; kind: string }[]; doneCount: number; open: number; inProgress: number; today?: string; overdue?: { title: string; dueOn: string; owner: string | null }[]; overdueCount?: number; dueSoon?: number } | null;
};
type Schedule = { frequency: "off" | "weekly" | "monthly"; recipients: string[]; nextSendAt: string | null; lastSentAt: string | null; uncertain?: { recipient: string; period: string; at: string }[] | null; uncertainMore?: number; uncertainDays?: number };
type Data = { report: Report; highlights: [string, string][]; empty: boolean; schedule: Schedule; brandName: string | null; accountEmail: string | null; optedOut?: string[] };

const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
const moverText = (m: Mover) => `${m.keyword}${m.location ? ` · ${m.location}` : ""}: ${m.from === null ? `now ${m.to}` : m.to === null ? `was ${m.from}, now not ranked` : `${m.from} → ${m.to}`}`;
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

/** A tag's change since the earlier check: measured zero is "±0"; none measured (no keyword in both) is "—". */
const TagChange = ({ v }: { v: number | null }) => (v === null ? <span className="g-text-2 ml-1 text-[12px]" title="No keyword was in both checks">—</span>
  : v === 0 ? <span className="g-text-2 ml-1 text-[12px]">±0</span>
  : <span className={`g-move ${v > 0 ? "g-move--up" : "g-move--down"} ml-1`}>{v > 0 ? "+" : "−"}{Math.abs(v)}</span>);

export default function SeoReportsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/report`;
  const q = useQuery<Data>({ queryKey: [key], enabled: !!site, refetchOnMount: "always" });
  const d = q.data, r = d?.report;
  const [frequency, setFrequency] = useState<Schedule["frequency"]>("off");
  const [emails, setEmails] = useState("");
  useEffect(() => { if (d) { setFrequency(d.schedule.frequency); setEmails(d.schedule.recipients.join("\n") || d.accountEmail || ""); } }, [d?.schedule.frequency, d?.schedule.recipients.join(","), site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = parseEmails(emails), tooMany = list.length > 5, bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const save = useMutation({
    mutationFn: () => api("POST", `${key}/schedule`, { frequency, recipients: list }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [key] }); toast({ title: frequency === "off" ? "Scheduled reports turned off" : `Report scheduled ${frequency}` }); },
    onError: (e) => toast({ title: "Couldn't save the schedule", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: () => api("POST", `${key}/send`, { recipients: list }),
    // Whatever happened, the schedule's note about deliveries in doubt is read again.
    onSettled: () => void qc.invalidateQueries({ queryKey: [key] }),
    onSuccess: (x: { sent: number; failed?: number; empty: boolean; optedOut?: string[]; uncertain?: string[] }) => toast(x.empty ? { title: "Nothing to send yet", description: "The report has no numbers for this site.", variant: "destructive" }
      : { title: `Report sent to ${x.sent} address${x.sent === 1 ? "" : "es"}`, description: [x.optedOut?.length ? `${x.optedOut.join(", ")} asked not to get these reports and was skipped.` : "", x.failed ? `${x.failed} could not be sent — try again.` : "", x.uncertain?.length ? `A send to ${x.uncertain.join(", ")} broke off and may have arrived, so it was not sent again automatically.` : ""].filter(Boolean).join(" ") || undefined, variant: x.failed ? "destructive" : undefined }),
    onError: (e) => toast({ title: "Couldn't send the report", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const invalid = !list.length || tooMany || bad.length > 0;

  return (
    <SeoShell title="Reports" description="A plain-English report of where your site stands and what changed — to read, download, or have emailed to you or a client." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && d && !d.empty && <a className="g-pill w-full justify-center sm:w-auto" href={`${key}.pdf`} download data-testid="link-report-pdf"><Download /> Download PDF</a>}>
      {!site && sites.isSuccess && <Empty testId="reports-empty-sites"><h3>No sites yet</h3><p>Add your site above; its report builds itself from the rank tracker, Site explorer and Site audit.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Building the report…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="reports-error"><h3>Couldn't build the report</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && d && r && d.empty && (
        <Empty testId="reports-empty">
          <h3>Nothing to report on {site.domain} yet</h3>
          <p>The report is made from numbers you already have. Get them from any of these, then come back:</p>
          <ul className="mt-2 list-disc pl-5 text-[14px]">
            <li><Link href="/seo/rank-tracker" className="g-link">Rank tracker</Link> — add keywords and run a check</li>
            <li><Link href={`/seo/explorer?domain=${encodeURIComponent(site.domain)}`} className="g-link">Site explorer</Link> — analyse the site</li>
            <li><Link href="/seo/audit" className="g-link">Site audit</Link> — run a crawl</li>
          </ul>
        </Empty>
      )}
      {site && d && r && !d.empty && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2" data-testid="report-preview">
            <section className="rounded-lg border p-4" style={card}>
              <h2 className="g-text text-[16px] font-medium">At a glance <span className="g-text-2 text-[12px] font-normal">· {fmtDate(r.generatedAt)}{r.comparedWith ? ` · rankings compared with ${fmtDate(r.comparedWith)}` : ""}</span></h2>
              <table className="g-table mt-2" data-testid="table-report-highlights"><tbody>
                {d.highlights.map(([label, value]) => <tr key={label}><td className="g-text-2">{label}</td><td className="num g-text font-medium">{value}</td></tr>)}
              </tbody></table>
            </section>
            {r.rankings && (
              <section className="rounded-lg border p-4" style={card} data-testid="report-rankings">
                <h2 className="g-text mb-2 text-[16px] font-medium">Rankings <span className="g-text-2 text-[12px] font-normal">· {r.rankings.device ?? "desktop"} · checked {fmtDate(r.rankings.checkedOn)}</span></h2>
                {!r.comparedWith && <p className="g-text-2 text-[13px]">This is the first check, so there is nothing to compare with yet. The next report shows what moved.</p>}
                {r.comparedWith && r.rankings.improved.length === 0 && r.rankings.declined.length === 0 && <p className="g-text-2 text-[13px]">{(r.rankings as { compared?: number | null }).compared === 0 ? `No keyword was in both this check and the one of ${fmtDate(r.comparedWith)}, so nothing is compared.` : `No keyword changed position since ${fmtDate(r.comparedWith)}.`}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {r.rankings.improved.length > 0 && <div><h3 className="g-move g-move--up mb-1 text-[13px]">▲ Moved up{(r.rankings.improvedCount ?? 0) > r.rankings.improved.length ? ` — the ${r.rankings.improved.length} biggest of ${r.rankings.improvedCount}` : ""}</h3><ul className="g-text space-y-0.5 text-[13px]">{r.rankings.improved.map((m, i) => <li key={i}>{moverText(m)}</li>)}</ul></div>}
                  {r.rankings.declined.length > 0 && <div><h3 className="g-move g-move--down mb-1 text-[13px]">▼ Moved down{(r.rankings.declinedCount ?? 0) > r.rankings.declined.length ? ` — the ${r.rankings.declined.length} biggest of ${r.rankings.declinedCount}` : ""}</h3><ul className="g-text space-y-0.5 text-[13px]">{r.rankings.declined.map((m, i) => <li key={i}>{moverText(m)}</li>)}</ul></div>}
                </div>
                <details className="mt-3 text-[13px]"><summary className="g-link cursor-pointer">All {fmtNum(r.rankings.keywords.length)} keywords in the report</summary>
                  <div className="overflow-x-auto"><table className="g-table mt-2"><thead><tr><th>Keyword</th><th className="num">Position</th><th className="num">Was</th><th className="num">Map pack</th><th className="num">Searches / mo</th></tr></thead>
                    <tbody>{r.rankings.keywords.map((k, i) => <tr key={i}><td>{k.keyword}{k.location && <span className="g-text-2 text-[12px]"> · {k.location}</span>}</td><td className="num">{k.position ?? "not ranked"}</td><td className="num g-text-2">{k.previous ?? "—"}</td><td className="num">{k.local != null ? `#${k.local}` : "—"}</td><td className="num">{fmtNum(k.volume)}</td></tr>)}</tbody></table></div>
                </details>
                {(r.rankings.byTag?.length ?? 0) > 0 && (
                  <div className="mt-3 overflow-x-auto" data-testid="report-by-tag">
                    <h3 className="g-text mb-1 text-[14px] font-medium">By tag</h3>
                    <table className="g-table w-full text-[13px]"><thead><tr><th>Tag</th><th className="num">Keywords</th><th className="num">In the top 10</th><th className="num">Visibility index</th></tr></thead>
                      <tbody>{r.rankings.byTag!.map((t) => (
                        <tr key={t.tag}>
                          <td className="!whitespace-normal [overflow-wrap:anywhere]" data-label="Tag"><span className="sr-only">Tag: </span>{t.tag}</td>
                          <td className="num" data-label="Keywords"><span className="sr-only">Keywords: </span>{fmtNum(t.keywords)}{r.comparedWith && <span className="g-text-2 block text-[11px]">{fmtNum(t.compared)} in both · {fmtNum(t.newSince)} new</span>}</td>
                          <td className="num" data-label="In the top 10"><span className="sr-only">In the top 10: </span>{fmtNum(t.top10)}{r.comparedWith && <TagChange v={t.top10Change} />}</td>
                          <td className="num" data-label="Visibility index"><span className="sr-only">Visibility index: </span>{t.visibility === null ? "—" : t.visibility}{r.comparedWith && <TagChange v={t.visibilityChange} />}{t.visibility !== null && t.weighted !== undefined && <span className="g-text-2 block text-[11px]">{t.weighted ? "by search volume" : "each keyword once"}{t.changeWeighted != null && t.changeWeighted !== t.weighted ? `; change ${t.changeWeighted ? "by volume" : "each once"}` : ""}</span>}</td>
                        </tr>))}</tbody></table>
                    {(r.rankings.moreTags ?? 0) > 0 && <p className="g-text-2 mt-1 text-[12px]">…and {r.rankings.moreTags} more tags.</p>}
                    <p className="g-text-2 mt-1 text-[12px]">{r.comparedWith ? `Changes count only the keywords in both checks (${fmtDate(r.rankings.checkedOn)} and ${fmtDate(r.comparedWith)}); ` : ""}a keyword can carry several tags. The visibility index is not a share of real clicks: 100 would mean every keyword first (weighted by search volume where every keyword has one).</p>
                  </div>
                )}
              </section>
            )}
            {r.auditUnavailable && <p className="g-text-2 text-[13px]" role="note" data-testid="report-audit-unavailable">Site health could not be looked up just now, so it is left out of this report.</p>}
            {r.auditUnreadable !== undefined && !r.audit && <p className="g-text-2 text-[13px]" role="note" data-testid="report-audit-unreadable">Site health: the newest crawl{r.auditUnreadable ? ` (${fmtDate(r.auditUnreadable)})` : ""} could not be read, so no health score is reported.</p>}
            {r.audit && r.audit.topIssues.length > 0 && (
              <section className="rounded-lg border p-4" style={card} data-testid="report-audit">
                <h2 className="g-text mb-2 text-[16px] font-medium">What to fix first <span className="g-text-2 text-[12px] font-normal">· crawled {fmtDate(r.audit.scannedAt)}</span></h2>
                <ul className="g-text space-y-0.5 text-[13px]">{r.audit.topIssues.map((i) => <li key={i.title}>{i.title} <span className="g-text-2">— {fmtNum(i.count)} affected ({i.severity})</span></li>)}</ul>
              </section>
            )}
            {r.work && (
              <section className="rounded-lg border p-4" style={card} data-testid="report-work">
                <h2 className="g-text mb-2 text-[16px] font-medium">Work done <span className="g-text-2 text-[12px] font-normal">· {r.work.since ? `since ${fmtDate(r.work.since)}` : `the last ${r.work.days} days`}, from the <Link href="/seo/plan" className="g-link">action plan</Link></span></h2>
                {r.work.unavailable && <p className="text-[13px]" role="status" style={{ color: "#b06000" }}>The action plan couldn't be read just now, so nothing is said about the work done. Reload to try again.</p>}
                {r.work.unavailable ? null : r.work.done.length === 0 ? <p className="g-text-2 text-[13px]">No task was marked done in this period.</p> : (
                  <ul className="g-text space-y-0.5 text-[13px]">{r.work.done.map((t, i) => <li key={i}><span className="g-text-2">{fmtDate(t.doneAt)}</span> — {t.title}{t.note && <span className="g-text-2"> ({t.note})</span>}</li>)}</ul>
                )}
                {r.work.doneCount > r.work.done.length && <p className="g-text-2 mt-1 text-[12px]">…and {fmtNum(r.work.doneCount - r.work.done.length)} more.</p>}
                {(r.work.overdue?.length ?? 0) > 0 && (
                  <div className="mt-2" data-testid="report-overdue">
                    <p className="text-[13px]" style={{ color: "var(--g-red, #c5221f)" }}>Past their due date ({fmtNum(r.work.overdueCount ?? 0)}) <span className="g-text-2 text-[12px]">— due before {r.work.today ? new Date(`${r.work.today}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "today"}, UTC</span></p>
                    <ul className="g-text space-y-0.5 text-[13px]">{r.work.overdue!.map((t, i) => <li key={i} className="[overflow-wrap:anywhere]"><span className="g-text-2">due {new Date(`${t.dueOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span> — {t.title}{t.owner && <span className="g-text-2"> · {t.owner}</span>}</li>)}</ul>
                  </div>
                )}
                {!r.work.unavailable && <p className="g-text-2 mt-1 text-[12px]">{fmtNum(r.work.open)} still open{r.work.inProgress ? `, ${fmtNum(r.work.inProgress)} in progress` : ""}{r.work.dueSoon ? `, ${fmtNum(r.work.dueSoon)} due today or in the next 7 days` : ""}. "Done" is what was marked in the plan; whether a site issue is gone shows in the next crawl.</p>}
              </section>
            )}
            {r.alerts.length > 0 && (
              <section className="rounded-lg border p-4" style={card} data-testid="report-alerts">
                <h2 className="g-text mb-2 text-[16px] font-medium">Alerts in the last month</h2>
                <ul className="g-text space-y-0.5 text-[13px]">{r.alerts.map((a, i) => <li key={i}><span className="g-text-2">{fmtDate(a.createdAt)}</span> — {a.title}</li>)}</ul>
              </section>
            )}
            {r.searchConsole?.incomplete && <p className="g-text-2 text-[13px]" role="note" data-testid="report-gsc-incomplete">Search Console: {r.searchConsole.completenessUnknown ? "whether every one of these days was fully read from Google could not be checked" : "some of these days are still being read from Google, or a read of them failed"}, so the clicks and impressions above may be short and are not compared with the 28 days before.</p>}
            {!r.searchConsole && <p className="g-text-2 text-[13px]" data-testid="report-gsc-missing">Want real clicks in this report, not just estimates? <Link href="/search-console" className="g-link">Connect Google Search Console</Link> for {site.domain} and the report adds Google's own count of clicks and impressions.</p>}
            <p className="g-text-2 text-[12px]">The PDF has the same content{d.brandName ? `, under the name "${d.brandName}"` : ""}. Set your own name and logo for reports under <Link href="/site-scan" className="g-link">Site Scan → Branding</Link>. Missing a section? It appears once that tool has numbers for this site.</p>
          </div>
          <form className="h-fit rounded-lg border p-4" style={card} onSubmit={(e) => { e.preventDefault(); save.mutate(); }} data-testid="form-report-schedule">
            <h2 className="g-text text-[16px] font-medium">Email this report</h2>
            <p className="g-text-2 mt-1 text-[13px]">Sent as an email with the PDF attached. Free — it uses the numbers you already have.</p>
            <label className="mt-3 block text-[13px]"><span className="g-text-2">How often</span>
              <select className="g-input g-select mt-1" value={frequency} onChange={(e) => setFrequency(e.target.value as Schedule["frequency"])} data-testid="select-report-frequency">
                <option value="off">Not scheduled</option><option value="weekly">Every week</option><option value="monthly">On the 1st of every month</option>
              </select>
            </label>
            <label className="mt-3 block text-[13px]"><span className="g-text-2">Send to — up to 5 addresses, one per line</span>
              <textarea className="g-input mt-1 min-h-[96px] py-2" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={"you@yourcompany.com\nclient@theirs.com"} aria-invalid={bad.length > 0 || tooMany} data-testid="textarea-report-recipients" />
            </label>
            {(bad.length > 0 || tooMany) && <p className="mt-1 text-[12px]" style={{ color: "var(--g-red)" }} role="alert">{tooMany ? "Up to 5 addresses." : `Not an email address: ${bad.slice(0, 2).join(", ")}`}</p>}
            <p className="g-text-2 mt-2 text-[12px]">Every email says you asked for it and has a link the recipient can use to stop them.</p>
            {(d.optedOut?.length ?? 0) > 0 && <p className="g-text-2 mt-1 text-[12px]" data-testid="text-report-optouts">Asked not to get your reports (they are skipped): {d.optedOut!.join(", ")}</p>}
            {d.schedule.uncertain === null && <p className="g-text-2 mt-2 text-[12px]" role="note" data-testid="text-report-uncertain-unread">Couldn't check just now whether any report email is in doubt.</p>}
            {(d.schedule.uncertain?.length ?? 0) > 0 && <p className="mt-2 text-[12px]" role="note" data-testid="text-report-uncertain">Not known whether these arrived — the send broke off and may have gone through, so it was not sent again automatically (the last {d.schedule.uncertainDays ?? 60} days): {d.schedule.uncertain!.map((u) => `${u.period} to ${u.recipient} (${fmtDate(u.at)})`).join("; ")}{d.schedule.uncertainMore ? `; and ${d.schedule.uncertainMore} more` : ""}.</p>}
            {d.schedule.frequency !== "off" && <p className="g-text-2 mt-2 text-[12px]" data-testid="text-report-next">Next report {fmtDate(d.schedule.nextSendAt)}{d.schedule.lastSentAt ? ` · last sent ${fmtDate(d.schedule.lastSentAt)}` : ""}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending || (frequency !== "off" && invalid)} data-testid="button-report-save">{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{save.isPending ? "Saving…" : "Save schedule"}</Button>
              <button type="button" className="g-pill" disabled={send.isPending || invalid} onClick={() => send.mutate()} data-testid="button-report-send">{send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send now</button>
            </div>
          </form>
        </div>
      )}
    </SeoShell>
  );
}
