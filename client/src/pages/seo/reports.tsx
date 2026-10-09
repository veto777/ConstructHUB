/**
 * /seo/reports — the SEO report for a site: where it stands and what changed,
 * to read here, download as a PDF, or have emailed every week or month (to
 * you, or to a client). Built from saved numbers only (GET /api/seo/sites/:id/report):
 * making or sending a report never spends SEO data.
 *
 * Every figure and row is a link to the tool it was read from, with that tool narrowed to it (links.ts): a count of
 * keywords opens the rank tracker on that band, an issue opens Site audit on it, a task opens the action plan on it.
 * The address honours ?site=, and ?section= (rankings | fixes | work | visibility | grid) scrolls to and outlines a
 * section. Arriving by link never sends or schedules anything: the email schedule stays a form.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, clearParams, Empty, fmtDate, fmtNum, SeoShell, useAddress, useScrollTo, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing, type SeoSite } from "./shell";
import { seoLinks } from "./links";
import { DeltaBadge, DistributionBar, PALETTE } from "./viz";
import { BarList, BLUE_WORDS, CARD, FIGURE_LINK, Heading, leadFigure, LinkedFigure, MetricRow, MiniBar, QUIET_LINK, Section, TEXT_LINK } from "./viz-more";

type Mover = { keyword: string; location: string | null; device: string; from: number | null; to: number | null };
type GridLine = { scanId?: number; keyword: string; size: number; spacing: number; at: string; top3: number; checked: number; score: number | null; previous: { scanId?: number; top3: number; checked: number; score: number | null; at: string } | null };
type Report = {
  domain: string; generatedAt: string; comparedWith: string | null;
  rankings: { byTag?: { tag: string; keywords: number; top3: number; top10: number; top10Change: number | null; visibility: number | null; visibilityChange: number | null; compared: number; newSince: number; weighted?: boolean; changeWeighted?: boolean | null }[]; moreTags?: number; tracked: number; checked?: number; device?: string; improvedCount?: number; declinedCount?: number; checkedOn: string | null; top3: number; top10: number; averagePosition: number | null; inMapPack: number; withMapPack: number; improved: Mover[]; declined: Mover[];
    /** Changes measured only on the keywords in BOTH checks (how many those are), and the average of those ranked both times. */
    compared?: number | null; top10Change?: number | null; top3Change?: number | null; averageNow?: number | null; averageBefore?: number | null; rankedBoth?: number;
    keywords: { keyword: string; location: string | null; position: number | null; previous: number | null; local: number | null; volume: number | null }[] } | null;
  search: { fetchedAt: string } | null;
  searchConsole?: { clicks: number; /** The server's verdict on the reads of these days: unfinished / failed, or not checkable (`completenessUnknown`) — the counts may be short and are not compared. */ incomplete?: boolean; completenessUnknown?: boolean } | null;
  audit: { scannedAt: string | null; health: number | null; topIssues: { key?: string; title: string; severity: string; count: number }[] } | null;
  auditUnreadable?: string | null; auditUnavailable?: boolean;
  alerts: { id?: number; title: string; kind: string; createdAt: string }[];
  grids?: GridLine[];
  work?: { unavailable?: boolean; since?: string | null; days: number; done: { id?: number; title: string; doneAt: string; target: string | null; note: string | null; kind: string }[]; doneCount: number; open: number; inProgress: number; today?: string; overdue?: { id?: number; title: string; dueOn: string; owner: string | null }[]; overdueCount?: number; dueSoon?: number } | null;
};
type Schedule = { frequency: "off" | "weekly" | "monthly"; recipients: string[]; nextSendAt: string | null; lastSentAt: string | null; uncertain?: { recipient: string; period: string; at: string }[] | null; uncertainMore?: number; uncertainDays?: number };
type Data = { report: Report; highlights: [string, string][]; empty: boolean; schedule: Schedule; brandName: string | null; accountEmail: string | null; optedOut?: string[] };

const card = CARD;
// A missing position is "not found": the site was not within the result pages the check read, which is not proof it ranks nowhere.
const moverText = (m: Mover) => `${m.keyword}${m.location ? ` · ${m.location}` : ""}: ${m.from === null ? `now ${m.to}` : m.to === null ? `was ${m.from}, now not found` : `${m.from} → ${m.to}`}`;
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const device = (d: string | undefined) => (d === "mobile" || d === "desktop" ? d : undefined);
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined);

/** The sections ?section= can land on: the element it scrolls to and the words the chip says. */
const SECTIONS: Record<string, { id: string; words: string }> = {
  rankings: { id: "report-rankings", words: "Rankings" }, fixes: { id: "report-audit", words: "What to fix first" }, work: { id: "report-work", words: "Work done" },
  visibility: { id: "report-by-tag", words: "Visibility index, by tag" }, grid: { id: "report-grid", words: "Local grid" },
};
/** Whether a section is in this report at all (each renders only when its tool has numbers). */
const hasSection = (r: Report, key: string) => key === "rankings" ? !!r.rankings : key === "fixes" ? !!r.audit?.topIssues.length : key === "work" ? !!r.work : key === "visibility" ? !!r.rankings?.byTag?.length : key === "grid" ? !!r.grids?.length : false;
/** Rows of the report's keyword table shown before "Show all". */
const KEYWORD_ROWS = 10;
const outlined = (section: string | null, key: string) => (section === key ? "outline outline-2 outline-offset-2 outline-[color:var(--g-blue,#1a73e8)]" : "");

/** A tag's change since the earlier check, a link to the tag's history: measured zero is "±0"; none measured (no keyword in both) is "—". */
const TagChange = ({ v, href }: { v: number | null; href: string }) => (v === null ? <span className="g-text-2 ml-1 text-[12px]" title="No keyword was in both checks">— <span className="sr-only">no keyword was in both checks</span></span>
  : <Link href={href} className={`${QUIET_LINK} ml-1 ${v === 0 ? "g-text-2 text-[12px]" : `g-move ${v > 0 ? "g-move--up" : "g-move--down"}`}`}>{v === 0 ? "±0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`}</Link>);

type Part = { test: RegExp; href: string };
/**
 * Where a highlight of "At a glance" leads: the tool its figure was read from, narrowed to it. `parts` are phrases of
 * the rest of the line that lead somewhere of their own ("5 still open" → the open tasks; "(+3)" → the same view).
 * The server words the highlights (server/seo/site-report.ts reportHighlights) in the same order as the report's own
 * sections — a grid line is matched to its scan by that order, never by its keyword alone (two grids can share one).
 */
function highlightLink(label: string, site: SeoSite, grid: GridLine | undefined): { href: string; parts: Part[] } | null {
  const id = site.id, domain = site.domain;
  const history = seoLinks.rankTracker(id, { panel: "history" });
  const one = (href: string, parts: Part[] = []): { href: string; parts: Part[] } => ({ href, parts: [...parts, { test: /\([+−-][\d,.]+%?\)|\(no change\)/, href }] });
  if (/^Keywords in the top 10/.test(label)) return one(seoLinks.rankTracker(id, { band: "top10" }), [{ test: /of \d[\d,]* checked/, href: seoLinks.rankTracker(id) }, { test: /on the \d[\d,]* in both checks/, href: history }]);
  if (/^Not covered by the latest check/.test(label)) return one(seoLinks.rankTracker(id, { band: "notFound" }), [{ test: /of \d[\d,]* tracked keywords/, href: seoLinks.rankTracker(id) }]);
  if (/^Keywords in the top 3/.test(label)) return one(seoLinks.rankTracker(id, { band: "top3" }), [{ test: /on the \d[\d,]* in both checks/, href: history }]);
  if (/^Average position/.test(label)) return one(seoLinks.rankTracker(id), [{ test: /the \d[\d,]* ranked both times: [\d.]+ then, [\d.]+ now/, href: history }]);
  if (/^Compared with the earlier check/.test(label)) return one(history);
  if (/^In the Google map pack/.test(label)) return one(seoLinks.rankTracker(id, { mapPack: true }), [{ test: /of \d[\d,]* searches that show a map/, href: seoLinks.rankTracker(id, { mapPack: true }) }]);
  if (/^(Clicks from|Times shown in) Google/.test(label)) return one(seoLinks.rankTracker(id, { panel: "gsc" }));
  if (/^Estimated visits/.test(label)) return one(seoLinks.explorer(domain, "pages"));
  if (/^Keywords the site ranks for/.test(label)) return one(seoLinks.explorer(domain, "keywords"));
  if (/^Websites linking to it/.test(label)) return one(seoLinks.explorer(domain, "referringDomains"));
  if (/^Authority/.test(label)) return one(seoLinks.explorer(domain));
  if (/^Local grid — "/.test(label)) {
    const scan = grid?.scanId ? { scan: grid.scanId } : {}, was = grid?.previous?.scanId ? { scan: grid.previous.scanId } : {};
    return one(seoLinks.localGrid(id, scan), [
      { test: /in the first 3 local results at \d+ of \d+ points/, href: seoLinks.localGrid(id, { ...scan, show: "top3" }) },
      { test: /was \d+ of \d+ on [\d-]+/, href: seoLinks.localGrid(id, { ...was, show: "top3" }) },
      { test: /position score [\d.]+|position score —/, href: seoLinks.localGrid(id, { ...scan, show: "checked" }) },
      { test: /was [\d.]+(?=\))/, href: seoLinks.localGrid(id, { ...was, show: "checked" }) },
      { test: /scanned [\d-]+/, href: seoLinks.localGrid(id, scan) },
    ]);
  }
  if (/^Work done/.test(label)) return one(seoLinks.plan(id, { status: "done" }), [{ test: /\d[\d,]* tasks? marked done/, href: seoLinks.plan(id, { status: "done" }) }, { test: /\d[\d,]* still open/, href: seoLinks.plan(id, { status: "open" }) }, { test: /\d[\d,]* past their due date/, href: seoLinks.plan(id, { status: "overdue" }) }, { test: /the action plan could not be read just now/, href: seoLinks.plan(id) }]);
  if (/^Site health/.test(label)) return one(seoLinks.audit(id), [{ test: /\d[\d,]* errors?/, href: seoLinks.audit(id, { severity: "error" }) }, { test: /\d[\d,]* warnings?/, href: seoLinks.audit(id, { severity: "warning" }) }]);
  return null;
}

/** The rest of a highlight line with each phrase that leads somewhere of its own as a link (the first match of each, left to right). */
function RestOfLine({ rest, parts }: { rest: string; parts: Part[] }) {
  const nodes: ReactNode[] = [];
  let s = rest, n = 0;
  const left = [...parts];
  while (s) {
    let best: { m: RegExpExecArray; i: number } | null = null;
    left.forEach((p, i) => { const m = p.test.exec(s); if (m && (!best || m.index < best.m.index)) best = { m, i }; });
    if (!best) { nodes.push(s); break; }
    const { m, i } = best as { m: RegExpExecArray; i: number };
    if (m.index > 0) nodes.push(s.slice(0, m.index));
    nodes.push(<Link key={n++} href={left[i].href} className={QUIET_LINK}>{m[0]}</Link>);
    s = s.slice(m.index + m[0].length);
    left.splice(i, 1);
  }
  return <>{nodes}</>;
}

export default function SeoReportsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  const section = params.get("section");
  const target = section ? SECTIONS[section] ?? null : null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/report`;
  const q = useQuery<Data>({ queryKey: [key], enabled: !!site, refetchOnMount: "always" });
  const d = q.data, r = d?.report;
  const sectionHere = !!r && !!section && !!target && hasSection(r, section);
  useScrollTo(sectionHere ? target!.id : null, !!r && !d?.empty);
  // Another site is another report: the section jumped to belonged to the one before.
  const changeSite = (id: number) => { clearParams(["section"]); onSite(id); };
  /** The report's keyword table: the first KEYWORD_ROWS, or all of them (the report keeps up to 50). */
  const [allKeywords, setAllKeywords] = useState(false);
  useEffect(() => setAllKeywords(false), [site?.id]);
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
  // The rank tracker narrowed to one keyword, a tag, a band or a move — the same addresses the dashboard and alerts use.
  const kw = (keyword: string, dev?: string, p: { panel?: string; mapPack?: boolean } = {}) => seoLinks.rankTracker(site!.id, { keyword, device: device(dev), ...p });

  return (
    <SeoShell title="Reports" description="A plain-English report of where your site stands and what changed — to read, download, or have emailed to you or a client." site={site} onSite={changeSite} sites={sites} status={status}
      actions={site && d && !d.empty && <a className="g-pill !min-h-11 w-full justify-center sm:w-auto" href={`${key}.pdf`} download data-testid="link-report-pdf"><Download /> Download PDF</a>}>
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="reports-site-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
      {/* Said also when the report is empty: the address still asks for a section, and the page says it is not there. */}
      {section && r && <ActiveFilter onClear={() => clearParams(["section"], false)} clearLabel="Whole report">{!target ? `No section called "${section}" in a report (rankings, fixes, work, visibility, grid)` : d?.empty ? `"${target.words}" is not in this report — the report has no numbers for ${site?.domain ?? "the site"} yet` : sectionHere ? `Jumped to: ${target!.words}` : `"${target.words}" is not in this report yet — it appears once that tool has numbers for ${site?.domain ?? "the site"}`}</ActiveFilter>}
      {!site && sites.isSuccess && <Empty testId="reports-empty-sites"><h3>No sites yet</h3><p>Add your site above; its report builds itself from the rank tracker, Site explorer and Site audit.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Building the report…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="reports-error"><h3>Couldn't build the report</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && d && r && d.empty && (
        <Empty testId="reports-empty">
          <h3>Nothing to report on {site.domain} yet</h3>
          <p>The report is made from numbers you already have. Get them from any of these, then come back:</p>
          <ul className="mt-2 list-disc pl-5 text-[14px]">
            <li><Link href={seoLinks.rankTracker(site.id)} className={TEXT_LINK}>Rank tracker</Link> — add keywords and run a check</li>
            <li><Link href={seoLinks.explorer(site.domain)} className={TEXT_LINK}>Site explorer</Link> — analyse the site</li>
            <li><Link href={seoLinks.audit(site.id)} className={TEXT_LINK}>Site audit</Link> — run a crawl</li>
          </ul>
        </Empty>
      )}
      {site && d && r && !d.empty && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2" data-testid="report-preview">
            <Section title="At a glance" meta={<><Link href={seoLinks.reports(site.id)} className={QUIET_LINK} title="This report, made from the saved numbers on that day (UTC)">{fmtDate(r.generatedAt)}</Link>{r.comparedWith ? <> · rankings compared with <Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(r.comparedWith) })} className={QUIET_LINK}>{fmtDate(r.comparedWith)}</Link></> : ""}</>}>
              {/* Each highlight as the report words it: its leading number big, the rest of the line under it, the label and
                  number one link to the tool it was read from, and every figure in the rest a link of its own. */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 xl:grid-cols-4" data-testid="table-report-highlights">
                {(() => { let gridN = 0; return d.highlights.map(([label, value]) => {
                  const f = leadFigure(value);
                  // The grid lines come in the order of the report's grids: the n-th line is the n-th grid (its keyword is checked, never relied on).
                  const kwOf = /^Local grid — "(.+)"$/.exec(label)?.[1];
                  const g = kwOf !== undefined ? r.grids?.[gridN++] : undefined;
                  const to = highlightLink(label, site, g && g.keyword === kwOf ? g : undefined);
                  const inner: ReactNode = (<>
                    <span className={`block text-[13px] font-medium [overflow-wrap:anywhere] ${to ? "underline decoration-dotted underline-offset-2" : ""}`} style={BLUE_WORDS}>{label}</span>
                    {f.big ? <span className="g-text mt-0.5 block text-[26px] leading-9 tabular-nums">{f.big}</span> : null}
                  </>);
                  return (
                  <div key={label} className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:nth-child(4n+1))]:border-l">
                    {to ? <Link href={to.href} className="block min-w-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue,#1a73e8)]" data-testid={`link-highlight-${slug(label)}`}>{inner}</Link> : <div>{inner}</div>}
                    {f.rest && <div className={f.big ? "g-text-2 text-[12px] leading-4 [overflow-wrap:anywhere]" : "g-text mt-1 text-[13px] leading-5 [overflow-wrap:anywhere]"}><RestOfLine rest={f.rest} parts={to?.parts ?? []} /></div>}
                  </div>
                ); }); })()}
              </div>
            </Section>
            {r.rankings && (() => {
              const k = r.rankings, checked = k.checked ?? k.tracked, compared = k.compared ?? 0;
              const avgMove = k.averageNow != null && k.averageBefore != null && k.rankedBoth ? k.averageNow - k.averageBefore : null;
              const dev = device(k.device);
              const history = seoLinks.rankTracker(site.id, { panel: "history", device: dev });
              return (
              <Section title={<Link href={seoLinks.rankTracker(site.id, { device: dev })} className={QUIET_LINK} data-testid="link-report-rankings">Rankings</Link>} meta={<>{k.device ?? "desktop"} · checked <Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(k.checkedOn), device: dev })} className={QUIET_LINK}>{fmtDate(k.checkedOn)}</Link></>} id="report-rankings" testId="report-rankings" className={`scroll-mt-4 ${outlined(section, "rankings")}`}>
                {/* The figures of the latest check; a change is measured only on the keywords in both checks, and says on how many. Each opens the rank tracker on those keywords. */}
                <MetricRow cols={k.withMapPack > 0 ? 5 : 4} className="mb-4" testId="report-rankings-figures">
                  <LinkedFigure href={seoLinks.rankTracker(site.id, { band: "top3", device: dev })} testId="report-top3" label="In the top 3" value={fmtNum(k.top3)} delta={compared ? <DeltaBadge value={k.top3Change} label={`Change on the ${compared} keywords in both checks`} /> : null} foot={<>of <Link href={seoLinks.rankTracker(site.id, { device: dev })} className={QUIET_LINK}>{fmtNum(checked)} checked</Link>{compared ? <> · change on <Link href={history} className={QUIET_LINK}>the {fmtNum(compared)} in both checks</Link></> : ""}</>} />
                  <LinkedFigure href={seoLinks.rankTracker(site.id, { band: "top10", device: dev })} testId="report-top10" label="In the top 10" value={fmtNum(k.top10)} delta={compared ? <DeltaBadge value={k.top10Change} label={`Change on the ${compared} keywords in both checks`} /> : null} foot={<>of <Link href={seoLinks.rankTracker(site.id, { device: dev })} className={QUIET_LINK}>{fmtNum(checked)} checked</Link>{k.tracked > checked ? <> · <Link href={seoLinks.rankTracker(site.id, { band: "notFound", device: dev })} className={TEXT_LINK} data-testid="link-report-not-covered">{fmtNum(k.tracked - checked)} of {fmtNum(k.tracked)} tracked not covered</Link></> : ""}</>} />
                  <LinkedFigure href={seoLinks.rankTracker(site.id, { device: dev })} testId="report-average" label="Average position" value={k.averagePosition ?? "—"} delta={avgMove != null ? <DeltaBadge value={avgMove} upIsBad label="Change in the average of the keywords ranked both times" /> : null} foot={avgMove != null ? <Link href={history} className={QUIET_LINK}>the {fmtNum(k.rankedBoth)} ranked both times: {k.averageBefore} then, {k.averageNow} now</Link> : "Of the keywords found; lower is better"} />
                  {k.withMapPack > 0 && <LinkedFigure href={seoLinks.rankTracker(site.id, { mapPack: true, device: dev })} testId="report-map-pack" label="In the Google map pack" value={`${fmtNum(k.inMapPack)} of ${fmtNum(k.withMapPack)}`} foot={<Link href={seoLinks.rankTracker(site.id, { mapPack: true, device: dev })} className={QUIET_LINK}>searches that show a map</Link>} />}
                  <LinkedFigure href={seoLinks.rankTracker(site.id, { device: dev })} testId="report-checked" label="Keywords checked" value={fmtNum(checked)} foot="and where they rank">
                    {/* Each part and its legend count open the rank tracker on exactly those keywords, like the tiles above:
                        the top 3, positions 4–10 (a slice `band` cannot name), and everything below 10 or not found (`rest`). */}
                    <div className="mt-1.5"><DistributionBar testId="report-checked-dist" parts={[{ key: "top3", label: "Top 3", value: k.top3, color: PALETTE.top3 }, { key: "4-10", label: "4–10", value: Math.max(0, k.top10 - k.top3), color: PALETTE.top10 }, { key: "rest", label: "Below 10 or not found", value: Math.max(0, checked - k.top10), color: PALETTE.rest }]}
                      segmentHref={(part) => part === "4-10" ? seoLinks.rankTracker(site.id, { positions: "4-10", device: dev }) : seoLinks.rankTracker(site.id, { band: part === "top3" ? "top3" : "rest", device: dev })} /></div>
                  </LinkedFigure>
                </MetricRow>
                {!r.comparedWith && <p className="g-text-2 text-[13px]">This is the first check, so there is nothing to compare with yet. The next report shows what moved.</p>}
                {r.comparedWith && k.improved.length === 0 && k.declined.length === 0 && <p className="g-text-2 text-[13px]">{k.compared === 0 ? <>No keyword was in both this check and the one of <Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(r.comparedWith), device: dev })} className={QUIET_LINK}>{fmtDate(r.comparedWith)}</Link>, so nothing is compared.</> : <>No keyword changed position since <Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(r.comparedWith), device: dev })} className={QUIET_LINK}>{fmtDate(r.comparedWith)}</Link>.</>}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {r.rankings.improved.length > 0 && <div><h3 className="mb-1 text-[13px]"><Link href={seoLinks.rankTracker(site.id, { move: "up", device: dev })} className={`g-move g-move--up ${QUIET_LINK}`} data-testid="link-report-moved-up">▲ Moved up{(r.rankings.improvedCount ?? 0) > r.rankings.improved.length ? ` — the ${r.rankings.improved.length} biggest of ${r.rankings.improvedCount}` : ""}</Link></h3><ul className="g-text space-y-0.5 text-[13px]">{r.rankings.improved.map((m, i) => <li key={i}><Link href={kw(m.keyword, m.device)} className={FIGURE_LINK} data-testid={`link-report-mover-${slug(m.keyword)}`}>{moverText(m)}</Link></li>)}</ul></div>}
                  {r.rankings.declined.length > 0 && <div><h3 className="mb-1 text-[13px]"><Link href={seoLinks.rankTracker(site.id, { move: "down", device: dev })} className={`g-move g-move--down ${QUIET_LINK}`} data-testid="link-report-moved-down">▼ Moved down{(r.rankings.declinedCount ?? 0) > r.rankings.declined.length ? ` — the ${r.rankings.declined.length} biggest of ${r.rankings.declinedCount}` : ""}</Link></h3><ul className="g-text space-y-0.5 text-[13px]">{r.rankings.declined.map((m, i) => <li key={i}><Link href={kw(m.keyword, m.device)} className={FIGURE_LINK} data-testid={`link-report-mover-${slug(m.keyword)}`}>{moverText(m)}</Link></li>)}</ul></div>}
                </div>
                {/* Every keyword of the report, the first ten on screen and the rest a button away — never hidden in a closed
                    disclosure, so each link is a real anchor on the page (the click-crawl and a thumb both reach it). */}
                <div className="mt-3 text-[13px]" data-testid="report-all-keywords">
                  <Heading level={3} className="!mb-0 !text-[14px]"><Link href={seoLinks.rankTracker(site.id, { device: dev })} className={QUIET_LINK} data-testid="link-report-all-keywords">All {fmtNum(r.rankings.keywords.length)} keywords in the report</Link></Heading>
                  <p className="g-text-2 text-[12px]">Each keyword opens in the rank tracker; its position now and before open its history there, its searches a month open Keywords explorer.</p>
                  <div className="overflow-x-auto"><table className="g-table mt-1"><thead><tr><th>Keyword</th><th className="num">Position</th><th className="num">Was</th><th className="num">Map pack</th><th className="num">Searches / mo</th></tr></thead>
                    <tbody>{(allKeywords ? r.rankings.keywords : r.rankings.keywords.slice(0, KEYWORD_ROWS)).map((k, i) => <tr key={i}><td><Link href={kw(k.keyword, dev)} className={TEXT_LINK} data-testid={`link-report-keyword-${i}`}>{k.keyword}{k.location ? ` · ${k.location}` : ""}</Link></td><td className="num" data-label="Position"><Link href={kw(k.keyword, dev)} className={FIGURE_LINK} title={k.position == null ? "Not within the result pages the check read" : undefined}>{k.position ?? "not found"}</Link></td><td className="num" data-label="Was"><Link href={kw(k.keyword, dev, { panel: "history" })} className={`${QUIET_LINK} g-text-2`}>{k.previous ?? "—"}</Link></td><td className="num" data-label="Map pack">{k.local != null ? <Link href={kw(k.keyword, dev, { mapPack: true })} className={FIGURE_LINK}>#{k.local}</Link> : <Link href={kw(k.keyword, dev)} className={`${QUIET_LINK} g-text-2`} title="No map pack recorded for this keyword in this check">—</Link>}</td><td className="num" data-label="Searches / mo"><Link href={seoLinks.keywords(k.keyword, { section: "volume" })} className={FIGURE_LINK}>{fmtNum(k.volume)}</Link></td></tr>)}</tbody></table></div>
                  {r.rankings.keywords.length > KEYWORD_ROWS && <button type="button" className={`${TEXT_LINK} text-[13px]`} aria-expanded={allKeywords} onClick={() => setAllKeywords(!allKeywords)} data-testid="button-report-all-keywords">{allKeywords ? `Show the first ${KEYWORD_ROWS}` : `Show all ${fmtNum(r.rankings.keywords.length)}`}</button>}
                  <p className="g-text-2 mt-1 text-[12px]">"Not found" means the site was not within the result pages the check read — it may rank further down.</p>
                </div>
                {(r.rankings.byTag?.length ?? 0) > 0 && (
                  <div id="report-by-tag" className={`mt-3 overflow-x-auto scroll-mt-4 ${outlined(section, "visibility")}`} data-testid="report-by-tag">
                    <Heading level={3} className="!mb-1 !text-[14px]"><Link href={seoLinks.rankTracker(site.id, { panel: "tags", device: dev })} className={QUIET_LINK} data-testid="link-report-by-tag">By tag</Link></Heading>
                    <table className="g-table w-full text-[13px]"><thead><tr><th>Tag</th><th className="num">Keywords</th><th className="num">In the top 10</th><th className="num"><Link href={history} className={TEXT_LINK} data-testid="link-report-visibility">Visibility index</Link></th></tr></thead>
                      <tbody>{r.rankings.byTag!.map((t) => { const tagged = (p: Record<string, unknown> = {}) => seoLinks.rankTracker(site.id, { tag: t.tag, device: dev, ...p }); return (
                        <tr key={t.tag}>
                          <td className="!whitespace-normal [overflow-wrap:anywhere]" data-label="Tag"><span className="sr-only">Tag: </span><Link href={tagged()} className={TEXT_LINK} data-testid={`link-report-tag-${slug(t.tag)}`}>{t.tag}</Link></td>
                          <td className="num" data-label="Keywords"><span className="sr-only">Keywords: </span><Link href={tagged()} className={FIGURE_LINK}>{fmtNum(t.keywords)}</Link>{r.comparedWith && <span className="g-text-2 block text-[11px]"><Link href={tagged({ panel: "history" })} className={QUIET_LINK}>{fmtNum(t.compared)} in both</Link> · <Link href={tagged({ move: "new" })} className={QUIET_LINK}>{fmtNum(t.newSince)} new</Link></span>}</td>
                          <td className="num" data-label="In the top 10"><span className="sr-only">In the top 10: </span><Link href={tagged({ band: "top10" })} className={FIGURE_LINK}>{fmtNum(t.top10)}</Link>{r.comparedWith && <TagChange v={t.top10Change} href={tagged({ band: "top10", panel: "history" })} />}</td>
                          <td className="num" data-label="Visibility index"><span className="sr-only">Visibility index: </span>{t.visibility !== null && <MiniBar value={t.visibility} total={100} className="mr-2" />}<Link href={tagged({ panel: "history" })} className={FIGURE_LINK}>{t.visibility === null ? "—" : t.visibility}</Link>{r.comparedWith && <TagChange v={t.visibilityChange} href={tagged({ panel: "history" })} />}{t.visibility !== null && t.weighted !== undefined && <span className="g-text-2 block text-[11px]">{t.weighted ? "by search volume" : "each keyword once"}{t.changeWeighted != null && t.changeWeighted !== t.weighted ? `; change ${t.changeWeighted ? "by volume" : "each once"}` : ""}</span>}</td>
                        </tr>); })}</tbody></table>
                    {(r.rankings.moreTags ?? 0) > 0 && <p className="g-text-2 mt-1 text-[12px]">…and <Link href={seoLinks.rankTracker(site.id, { panel: "tags", device: dev })} className={TEXT_LINK}>{r.rankings.moreTags} more tags</Link>.</p>}
                    <p className="g-text-2 mt-1 text-[12px]">{r.comparedWith ? <>Changes count only the keywords in both checks (<Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(r.rankings.checkedOn), device: dev })} className={QUIET_LINK}>{fmtDate(r.rankings.checkedOn)}</Link> and <Link href={seoLinks.rankTracker(site.id, { panel: "history", date: day(r.comparedWith), device: dev })} className={QUIET_LINK}>{fmtDate(r.comparedWith)}</Link>); </> : ""}a keyword can carry several tags. The visibility index is not a share of real clicks: 100 would mean every keyword first (weighted by search volume where every keyword has one).</p>
                  </div>
                )}
              </Section>
            ); })()}
            {r.auditUnavailable && <p className="g-text-2 text-[13px]" role="note" data-testid="report-audit-unavailable">Site health could not be looked up just now, so it is left out of this report. <Link href={seoLinks.audit(site.id)} className={TEXT_LINK}>Open Site audit</Link></p>}
            {r.auditUnreadable !== undefined && !r.audit && <p className="g-text-2 text-[13px]" role="note" data-testid="report-audit-unreadable">Site health: the newest crawl{r.auditUnreadable ? <> (<Link href={seoLinks.audit(site.id)} className={QUIET_LINK}>{fmtDate(r.auditUnreadable)}</Link>)</> : ""} could not be read, so no health score is reported. <Link href={seoLinks.audit(site.id)} className={TEXT_LINK}>Open Site audit</Link></p>}
            {r.audit && r.audit.topIssues.length > 0 && (
              <Section title={<Link href={seoLinks.audit(site.id)} className={QUIET_LINK} data-testid="link-report-audit">What to fix first</Link>} meta={<>crawled <Link href={seoLinks.audit(site.id)} className={QUIET_LINK}>{fmtDate(r.audit.scannedAt)}</Link></>} id="report-audit" testId="report-audit" className={`scroll-mt-4 ${outlined(section, "fixes")}`}>
                {/* The longest bar is the issue found on the most pages; the words say the count and how serious it is. Each opens Site audit on that issue's pages, the count too, the severity on every issue of that severity. */}
                <BarList rows={r.audit.topIssues.map((i) => { const sev = i.severity as "error" | "warning" | "notice"; const href = i.key ? seoLinks.audit(site.id, { issue: i.key }) : seoLinks.audit(site.id, { severity: sev }); return ({ key: i.key ?? i.title, label: <Link href={href} className={TEXT_LINK} data-testid={`link-report-issue-${slug(i.key ?? i.title)}`}>{i.title}</Link>, title: i.title, value: i.count, words: <><Link href={href} className={QUIET_LINK}>{fmtNum(i.count)} affected</Link> (<Link href={seoLinks.audit(site.id, { severity: sev })} className={QUIET_LINK}>{i.severity}</Link>)</> }); })} />
              </Section>
            )}
            {(r.grids?.length ?? 0) > 0 && (
              <Section title={<Link href={seoLinks.localGrid(site.id)} className={QUIET_LINK} data-testid="link-report-grid">Local grid</Link>} meta="repeating scans" id="report-grid" testId="report-grid" className={`scroll-mt-4 ${outlined(section, "grid")}`}>
                {/* Each repeating search's newest scan, with the comparable one before it; every figure opens the scan it was read from, with the points it counts outlined. */}
                <ul className="g-text space-y-1 text-[13px]" data-testid="report-grid-rows">
                  {r.grids!.map((g) => { const scan = g.scanId ? { scan: g.scanId } : {}, was = g.previous?.scanId ? { scan: g.previous.scanId } : {}; return (
                    <li key={`${g.keyword}-${g.at}`} className="[overflow-wrap:anywhere]">
                      <Link href={seoLinks.localGrid(site.id, scan)} className={TEXT_LINK} data-testid={`link-report-grid-${slug(g.keyword)}`}>"{g.keyword}"</Link>
                      <span className="g-text-2"> · <Link href={seoLinks.localGrid(site.id, scan)} className={QUIET_LINK}>{g.size} × {g.size} points, {g.spacing} mi apart</Link> · scanned <Link href={seoLinks.localGrid(site.id, scan)} className={QUIET_LINK}>{fmtDate(g.at)}</Link>: </span>
                      in the first 3 local results at <Link href={seoLinks.localGrid(site.id, { ...scan, show: "top3" })} className={FIGURE_LINK}>{g.top3} of {g.checked}</Link> points{g.previous ? <> (<Link href={seoLinks.localGrid(site.id, { ...was, show: "top3" })} className={`${QUIET_LINK} g-text-2`}>was {g.previous.top3} of {g.previous.checked} on {fmtDate(g.previous.at)}</Link>)</> : ""} · position score <Link href={seoLinks.localGrid(site.id, { ...scan, show: "checked" })} className={FIGURE_LINK}>{g.score ?? "—"}</Link>{g.previous && g.previous.score !== null ? <> (<Link href={seoLinks.localGrid(site.id, { ...was, show: "checked" })} className={`${QUIET_LINK} g-text-2`}>was {g.previous.score}</Link>)</> : ""}
                    </li>
                  ); })}
                </ul>
              </Section>
            )}
            {r.work && (
              <Section title={<Link href={seoLinks.plan(site.id)} className={QUIET_LINK} data-testid="link-report-work">Work done</Link>} meta={<>{r.work.since ? <>since <Link href={seoLinks.plan(site.id, { status: "done" })} className={QUIET_LINK}>{fmtDate(r.work.since)}</Link></> : <>the last <Link href={seoLinks.plan(site.id, { status: "done" })} className={QUIET_LINK}>{r.work.days} days</Link></>}, from the <Link href={seoLinks.plan(site.id)} className={TEXT_LINK}>action plan</Link></>} id="report-work" testId="report-work" className={`scroll-mt-4 ${outlined(section, "work")}`}>
                {r.work.unavailable && <p className="text-[13px]" role="status" style={{ color: "#b06000" }}>The action plan couldn't be read just now, so nothing is said about the work done. Reload to try again, or <Link href={seoLinks.plan(site.id)} className={TEXT_LINK}>open the plan</Link>.</p>}
                {!r.work.unavailable && (
                  <MetricRow cols={4} className="mb-3" testId="report-work-figures">
                    <LinkedFigure href={seoLinks.plan(site.id, { status: "done" })} testId="report-work-done" label="Marked done" value={fmtNum(r.work.doneCount)} foot={<Link href={seoLinks.plan(site.id, { status: "done" })} className={QUIET_LINK}>{r.work.since ? `since ${fmtDate(r.work.since)}` : `in the last ${r.work.days} days`}</Link>} />
                    <LinkedFigure href={seoLinks.plan(site.id, { status: "open" })} testId="report-work-open" label="Still open" value={fmtNum(r.work.open)} foot={r.work.dueSoon ? <Link href={seoLinks.plan(site.id, { due: "soon" })} className={QUIET_LINK} data-testid="link-report-due-soon">{fmtNum(r.work.dueSoon)} due today or in the next 7 days</Link> : undefined} />
                    <LinkedFigure href={seoLinks.plan(site.id, { status: "doing" })} testId="report-work-doing" label="In progress" value={fmtNum(r.work.inProgress)} />
                    <LinkedFigure href={seoLinks.plan(site.id, { status: "overdue" })} testId="report-work-overdue" label="Past their due date" value={fmtNum(r.work.overdueCount ?? 0)} foot={r.work.overdueCount ? <Link href={seoLinks.plan(site.id, { status: "overdue" })} className={QUIET_LINK}>listed below</Link> : undefined} />
                  </MetricRow>
                )}
                {r.work.unavailable ? null : r.work.done.length === 0 ? <p className="g-text-2 text-[13px]">No task was marked done in this period.</p> : (
                  <ul className="g-text space-y-0.5 text-[13px]">{r.work.done.map((t, i) => { const href = t.id ? seoLinks.plan(site.id, { task: t.id, status: "done" }) : seoLinks.plan(site.id, { status: "done" }); return <li key={i}><Link href={href} className={`${QUIET_LINK} g-text-2`}>{fmtDate(t.doneAt)}</Link> — <Link href={href} className={FIGURE_LINK} data-testid={t.id ? `link-report-task-${t.id}` : undefined}>{t.title}</Link>{t.note && <span className="g-text-2"> ({t.note})</span>}</li>; })}</ul>
                )}
                {r.work.doneCount > r.work.done.length && <p className="g-text-2 mt-1 text-[12px]">…and <Link href={seoLinks.plan(site.id, { status: "done" })} className={TEXT_LINK}>{fmtNum(r.work.doneCount - r.work.done.length)} more</Link>.</p>}
                {(r.work.overdue?.length ?? 0) > 0 && (
                  <div className="mt-2" data-testid="report-overdue">
                    <p className="text-[13px]" style={{ color: "var(--g-red, #c5221f)" }}><Link href={seoLinks.plan(site.id, { status: "overdue" })} className={QUIET_LINK} style={{ color: "inherit" }} data-testid="link-report-overdue">Past their due date ({fmtNum(r.work.overdueCount ?? 0)})</Link> <span className="g-text-2 text-[12px]">— due before {r.work.today ? <Link href={seoLinks.plan(site.id, { status: "overdue" })} className={QUIET_LINK}>{dayWords(r.work.today)}</Link> : "today"}, UTC</span></p>
                    <ul className="g-text space-y-0.5 text-[13px]">{r.work.overdue!.map((t, i) => { const href = t.id ? seoLinks.plan(site.id, { task: t.id, status: "overdue" }) : seoLinks.plan(site.id, { status: "overdue" }); return <li key={i} className="[overflow-wrap:anywhere]"><Link href={href} className={`${QUIET_LINK} g-text-2`}>due {dayWords(t.dueOn)}</Link> — <Link href={href} className={FIGURE_LINK}>{t.title}</Link>{t.owner && <span className="g-text-2"> · <Link href={seoLinks.plan(site.id, { owner: t.owner })} className={QUIET_LINK}>{t.owner}</Link></span>}</li>; })}</ul>
                  </div>
                )}
                {!r.work.unavailable && <p className="g-text-2 mt-1 text-[12px]"><Link href={seoLinks.plan(site.id, { status: "open" })} className={TEXT_LINK} data-testid="link-report-still-open">{fmtNum(r.work.open)} still open</Link>{r.work.inProgress ? <>, <Link href={seoLinks.plan(site.id, { status: "doing" })} className={TEXT_LINK}>{fmtNum(r.work.inProgress)} in progress</Link></> : ""}{r.work.dueSoon ? <>, <Link href={seoLinks.plan(site.id, { due: "soon" })} className={TEXT_LINK}>{fmtNum(r.work.dueSoon)} due today or in the next 7 days</Link></> : ""}. "Done" is what was marked in the plan; whether a site issue is gone shows in the next crawl.</p>}
              </Section>
            )}
            {r.alerts.length > 0 && (
              <Section title={<Link href={seoLinks.alerts({ site: site.id })} className={QUIET_LINK} data-testid="link-report-alerts">Alerts in the last month</Link>} testId="report-alerts">
                {/* Each alert opens itself on the Alerts page (outlined there, among that kind for this site); its date too. */}
                <ul className="g-text space-y-0.5 text-[13px]">{r.alerts.map((a, i) => { const href = seoLinks.alerts({ site: site.id, kind: a.kind, alert: a.id }); return <li key={i}><Link href={href} className={`${QUIET_LINK} g-text-2`}>{fmtDate(a.createdAt)}</Link> — <Link href={href} className={FIGURE_LINK} data-testid={`link-report-alert-${i}`}>{a.title}</Link></li>; })}</ul>
              </Section>
            )}
            {r.searchConsole?.incomplete && <p className="g-text-2 text-[13px]" role="note" data-testid="report-gsc-incomplete">Search Console: {r.searchConsole.completenessUnknown ? "whether every one of these days was fully read from Google could not be checked" : "some of these days are still being read from Google, or a read of them failed"}, so <Link href={seoLinks.rankTracker(site.id, { panel: "gsc" })} className={TEXT_LINK}>the clicks and impressions above</Link> may be short and are not compared with the 28 days before.</p>}
            {!r.searchConsole && <p className="g-text-2 text-[13px]" data-testid="report-gsc-missing">Want real clicks in this report, not just estimates? <Link href={seoLinks.searchConsole()} className={TEXT_LINK} data-testid="link-report-connect-gsc">Connect Google Search Console</Link> for {site.domain} and the report adds Google's own count of clicks and impressions.</p>}
            <p className="g-text-2 text-[12px]">The PDF has the same content{d.brandName ? `, under the name "${d.brandName}"` : ""}. Set your own name and logo for reports under <Link href={seoLinks.siteScan()} className={TEXT_LINK} data-testid="link-report-branding">Site Scan → Branding</Link>. Missing a section? It appears once that tool has numbers for this site.</p>
          </div>
          <form className="h-fit min-w-0 rounded-xl border p-3 sm:p-4" style={card} onSubmit={(e) => { e.preventDefault(); save.mutate(); }} data-testid="form-report-schedule">
            <Heading className="!mb-0">Email this report</Heading>
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
