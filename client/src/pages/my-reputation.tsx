/**
 * /my-reputation — Reputation for every account (server/reputation/account.ts): watch your business or your own
 * name, see what Google shows (page 1–2 and autocomplete, scored), the official removal route for each negative
 * result, the people-search sites to opt out of, and ask our team to fix the rest (a lead in /admin/reputation).
 * Re-checked weekly. No prices on this page (owner, 2026-10-24): the team quotes them.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Image as ImageIcon, LifeBuoy, Loader2, Plus, RefreshCw, Trash2, UserX, Youtube } from "lucide-react";
import { REP_SUBJECT_KINDS, type RepScanReport, type RepSubjectKind } from "@shared/reputation";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, PageHeader, Section, Stat, StatGrid } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Guide = {
  key: string; platform: string; title: string; whenItApplies: string; notEligible: string | null; requestUrl: string | null; whoMustSubmit: string | null;
  evidence: string[]; steps: string[]; timeline: string | null; fees: string | null; verified: boolean;
};
type Watch = {
  id: number; query: string; kind: RepSubjectKind; ownedDomains: string[]; monitor: boolean; lastCheckedAt: string | null; helpRequestedAt: string | null;
  report: RepScanReport | null; history: { at: string; score: number }[]; guides: Record<string, Guide>;
};
type Broker = { key: string; name: string; domain: string; optOutUrl: string | null; optOutEmail: string | null; requires: string[]; method: string };
type Me = { available: boolean; limits: { watches: number; scansPer30Days: number; scansLeft: number; intervalDays: number }; watches: Watch[]; brokers: Broker[] };

const KEY = ["/api/reputation/me"];
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
const send = async <T,>(method: string, url: string, body?: unknown): Promise<T> => (await apiRequest(method, url, body)).json();
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

function AddWatch({ onDone, first }: { onDone: (w: Watch) => void; first: boolean }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<RepSubjectKind>("business");
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("");
  const add = useMutation({
    mutationFn: () => send<Watch>("POST", "/api/reputation/me/watches", { query, kind, ownedDomains: site.trim() ? [site.trim()] : [] }),
    onSuccess: async (w) => { await refresh(); setQuery(""); setSite(""); onDone(w); },
    onError: (e) => toast({ title: "Couldn't check that name", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2 && !add.isPending) add.mutate(); }} data-testid="form-rep-watch">
      <div className="flex gap-2" role="radiogroup" aria-label="What to check">
        {REP_SUBJECT_KINDS.map((k) => (
          <Button key={k} type="button" variant={kind === k ? "default" : "outline"} size="sm" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} data-testid={`rep-kind-${k}`}>
            {k === "business" ? "My business" : "Me (a person)"}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="rep-query">{kind === "business" ? "Business name, as customers search it" : "Your name, as people search it"}</Label>
          <Input id="rep-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "business" ? "Smith Roofing Tampa" : "Jane Smith Seattle"} data-testid="input-rep-watch-query" /></div>
        <div className="space-y-1.5"><Label htmlFor="rep-site">Your website (optional)</Label>
          <Input id="rep-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="smithroofing.com" data-testid="input-rep-watch-site" /></div>
      </div>
      <Button type="submit" disabled={query.trim().length < 2 || add.isPending} data-testid="button-rep-watch-add">
        {add.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking Google… about 20 seconds</> : first ? "Check my reputation" : "Add and check"}
      </Button>
    </form>
  );
}

function GuideDialog({ guide, onClose }: { guide: Guide | null; onClose: () => void }) {
  return (
    <Dialog open={!!guide} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {guide && <>
          <DialogHeader>
            <DialogTitle>{guide.platform}: {guide.title}</DialogTitle>
            <DialogDescription>{guide.whenItApplies}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {!guide.verified && <Notice tone="warning">We couldn't confirm this site's current process. Check the site's own help pages before you rely on these steps.</Notice>}
            {guide.notEligible && <div><div className="font-medium">Usually not removed</div><p className="text-muted-foreground">{guide.notEligible}</p></div>}
            {guide.steps.length > 0 && <div><div className="font-medium">Steps</div><ol className="mt-1 list-decimal space-y-1 pl-5">{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
            {guide.evidence.length > 0 && <div><div className="font-medium">Have ready</div><ul className="mt-1 list-disc space-y-1 pl-5">{guide.evidence.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            <div className="grid gap-2 sm:grid-cols-3">
              {guide.whoMustSubmit && <div><div className="text-xs text-muted-foreground">Who submits</div>{guide.whoMustSubmit}</div>}
              {guide.timeline && <div><div className="text-xs text-muted-foreground">Typical time</div>{guide.timeline}</div>}
              {guide.fees && <div><div className="text-xs text-muted-foreground">Site's fees</div>{guide.fees}</div>}
            </div>
            {guide.requestUrl && <Button asChild><a href={guide.requestUrl} target="_blank" rel="noreferrer">Open the official request form <ExternalLink className="ml-2 h-4 w-4" /></a></Button>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function HelpDialog({ watch, open, onClose }: { watch: Watch; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(""); const [notes, setNotes] = useState("");
  const help = useMutation({
    mutationFn: () => send("POST", `/api/reputation/me/watches/${watch.id}/help`, { phone: phone || undefined, notes: notes || undefined }),
    onSuccess: async () => { await refresh(); onClose(); toast({ title: "Request sent", description: "Our reputation team will contact you, usually within one business day." }); },
    onError: (e) => toast({ title: "Couldn't send the request", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Have our team fix “{watch.query}”</DialogTitle>
          <DialogDescription>We go through every result with you, tell you what can be removed and what has to be pushed down, and quote a plan. The call is free.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="rep-help-phone">Best phone (optional)</Label><Input id="rep-help-phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
          <div className="space-y-1.5"><Label htmlFor="rep-help-notes">Anything we should know (optional)</Label><Textarea id="rep-help-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="The result that worries you most, deadlines, etc." /></div>
          <Button onClick={() => help.mutate()} disabled={help.isPending} data-testid="button-rep-help-send">{help.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send to the reputation team</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WatchView({ watch, me }: { watch: Watch; me: Me }) {
  const { toast } = useToast();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [site, setSite] = useState(watch.ownedDomains.join(", "));
  useEffect(() => setSite(watch.ownedDomains.join(", ")), [watch.id, watch.ownedDomains.join(",")]);
  const r = watch.report;
  const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const rescan = useMutation({ mutationFn: () => send("POST", `/api/reputation/me/watches/${watch.id}/scan`), onSuccess: refresh, onError: fail("Couldn't check again") });
  const update = useMutation({ mutationFn: (b: { monitor?: boolean; ownedDomains?: string[] }) => send("PUT", `/api/reputation/me/watches/${watch.id}`, b), onSuccess: refresh, onError: fail("Couldn't save") });
  const remove = useMutation({ mutationFn: () => send("DELETE", `/api/reputation/me/watches/${watch.id}`), onSuccess: refresh, onError: fail("Couldn't remove") });
  const negatives = r?.results.filter((x) => x.sentiment === "negative") ?? [];
  const acGuide = watch.guides["google-autocomplete"];

  return (
    <div className="space-y-6">
      {r && (
        <StatGrid cols={4}>
          <Stat label="Reputation score" value={`${r.score} · ${r.grade}`} hint={watch.history.length > 1 ? `was ${watch.history[watch.history.length - 2].score} on ${when(watch.history[watch.history.length - 2].at)}` : `checked ${when(r.checkedAt)}`} tone={r.score < 65 ? "bad" : "default"} testId="stat-rep-score" />
          <Stat label="Negative on page 1" value={r.counts.negativeTop10} tone={r.counts.negativeTop10 ? "bad" : "default"} />
          <Stat label="Negative suggestions" value={r.counts.negativeAutocomplete} tone={r.counts.negativeAutocomplete ? "bad" : "default"} />
          <Stat label="Your pages on page 1" value={r.counts.ownedTop10} />
        </StatGrid>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => rescan.mutate()} disabled={rescan.isPending || me.limits.scansLeft === 0 || !me.available} data-testid="button-rep-rescan">
          {rescan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check again
        </Button>
        <span className="text-xs text-muted-foreground">{me.limits.scansLeft} of {me.limits.scansPer30Days} checks left this month</span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch checked={watch.monitor} onCheckedChange={(v) => update.mutate({ monitor: v })} data-testid="switch-rep-monitor" />
          Re-check every {me.limits.intervalDays} days and email me if it gets worse
        </label>
      </div>

      {r && (
        <Section title="What Google shows" description={`Google results for “${r.query}” in the United States, checked ${new Date(r.checkedAt).toLocaleString()}.`} flush>
          <ol className="divide-y">
            {r.results.map((x, i) => {
              const g = x.playbook ? watch.guides[x.playbook] : undefined;
              return (
                <li key={i} className="flex items-start gap-3 p-3" data-testid={`rep-result-${i}`}>
                  <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">#{x.position}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {x.kind === "video" && <Youtube className="h-4 w-4 shrink-0 text-red-600" />}{x.kind === "image" && <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{x.title || x.url}</a> : <span className="truncate font-medium">{x.title}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{x.domain}{x.reason ? ` · ${x.reason}` : ""}</div>
                    {x.sentiment === "negative" && (
                      <div className="mt-1.5">
                        {g ? <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setGuide(g)} data-testid={`button-rep-guide-${i}`}>How to request removal</Button>
                          : <span className="text-xs text-muted-foreground">No removal route on file for this site; it usually has to be pushed down.</span>}
                      </div>
                    )}
                  </div>
                  <Badge variant={x.sentiment === "negative" ? "destructive" : "secondary"} className="shrink-0">
                    {x.sentiment === "negative" ? "Negative" : x.control === "owned" ? "Yours" : x.sentiment === "positive" ? "Positive" : "Neutral"}
                  </Badge>
                </li>
              );
            })}
            {!r.results.length && <li className="p-4 text-sm text-muted-foreground">Google returned no results for this name.</li>}
          </ol>
        </Section>
      )}

      {r && r.autocomplete.length > 0 && (
        <Section title="What Google suggests" description="The predictions shown when someone starts typing this name.">
          <div className="flex flex-wrap gap-2">
            {r.autocomplete.map((a) => (
              <span key={a.suggestion} className={cn("rounded-full border px-3 py-1 text-sm", a.sentiment === "negative" && "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200")}>{a.suggestion}</span>
            ))}
          </div>
          {acGuide && <Button variant="link" size="sm" className="mt-2 h-auto p-0" onClick={() => setGuide(acGuide)}>How to report a prediction</Button>}
        </Section>
      )}

      <Section title="Have it fixed for you" icon={LifeBuoy}>
        {watch.helpRequestedAt
          ? <p className="text-sm">Our reputation team has your request from {when(watch.helpRequestedAt)} and will contact you. You can also email <a className="text-primary underline" href="mailto:support@constructhub.us">support@constructhub.us</a>.</p>
          : <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-muted-foreground">{negatives.length ? `${negatives.length} result${negatives.length > 1 ? "s" : ""} could be hurting you. ` : ""}Our team removes what qualifies, pushes down what doesn't, cleans up suggestions and takes you off people-search sites. Pricing is quoted on a free call.</p>
              <Button onClick={() => setHelpOpen(true)} data-testid="button-rep-help">Talk to the reputation team</Button>
            </div>}
      </Section>

      <Section title="Your websites" description="Results on these sites count as yours.">
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-md" value={site} onChange={(e) => setSite(e.target.value)} placeholder="smithroofing.com, facebook.com/smithroofing" />
          <Button variant="outline" onClick={() => update.mutate({ ownedDomains: site.split(",").map((s) => s.trim()).filter(Boolean) })} disabled={update.isPending}>Save</Button>
          <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={() => { if (window.confirm(`Stop watching “${watch.query}”?`)) remove.mutate(); }} data-testid="button-rep-remove"><Trash2 className="mr-2 h-4 w-4" />Stop watching</Button>
        </div>
      </Section>

      <GuideDialog guide={guide} onClose={() => setGuide(null)} />
      <HelpDialog watch={watch} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export default function MyReputationPage() {
  const { data: me, isLoading } = useQuery<Me>({ queryKey: KEY, queryFn: () => send<Me>("GET", "/api/reputation/me") });
  const [selected, setSelected] = useState<number | "add" | null>(null);
  const watches = me?.watches ?? [];
  const current = selected === "add" ? null : watches.find((w) => w.id === selected) ?? watches[0] ?? null;
  const adding = selected === "add" || (!isLoading && !watches.length);

  return (
    <AppPage testId="page-my-reputation">
      <PageHeader title="Reputation" description="See what Google shows for your business or your name, remove what qualifies, and get help with the rest." />
      {isLoading || !me ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
        <div className="space-y-6">
          {!me.available && <Notice tone="warning">Reputation checks are unavailable right now. Please try again later.</Notice>}
          {watches.length > 0 && (
            <div className="flex flex-wrap gap-2" role="tablist">
              {watches.map((w) => (
                <Button key={w.id} role="tab" aria-selected={!adding && current?.id === w.id} variant={!adding && current?.id === w.id ? "default" : "outline"} size="sm" onClick={() => setSelected(w.id)} data-testid={`tab-rep-watch-${w.id}`}>
                  {w.query}{w.report && <span className="ml-2 tabular-nums opacity-75">{w.report.score}</span>}
                </Button>
              ))}
              {watches.length < me.limits.watches && <Button variant={adding ? "default" : "ghost"} size="sm" onClick={() => setSelected("add")} data-testid="button-rep-add"><Plus className="mr-1 h-4 w-4" />Add a name</Button>}
            </div>
          )}
          {adding ? (
            <Section title={watches.length ? "Watch another name" : "Check your reputation"} description={`Free with your account: up to ${me.limits.watches} names, re-checked every ${me.limits.intervalDays} days.`}>
              <AddWatch first={!watches.length} onDone={(w) => setSelected(w.id)} />
            </Section>
          ) : current && <WatchView key={current.id} watch={current} me={me} />}

          <Section title="People-search sites" icon={UserX} description="Sites that publish home addresses, phones and relatives. Opt out of these first; most take a few days and some come back, so check again every few months." flush>
            <ul className="divide-y">
              {me.brokers.map((b) => (
                <li key={b.key} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1"><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{b.domain}{b.requires.length ? ` · needs ${b.requires.join(", ")}` : ""}</div></div>
                  {b.optOutUrl ? <Button variant="outline" size="sm" asChild><a href={b.optOutUrl} target="_blank" rel="noreferrer">Opt-out page <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
                    : b.optOutEmail ? <a className="text-primary underline" href={`mailto:${b.optOutEmail}?subject=${encodeURIComponent("Request to delete my personal information")}`}>{b.optOutEmail}</a>
                    : <span className="text-xs text-muted-foreground">Look for “Do not sell” or “Privacy” at the bottom of {b.domain}</span>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </AppPage>
  );
}
