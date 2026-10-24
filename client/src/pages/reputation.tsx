/**
 * /reputation — reputation restoration for people and businesses (shared/reputation.ts): what we do, the
 * individual plans, and the free scan (Google page 1–2 and autocomplete for a name, scored), which emails the
 * report link and lands as a lead in the Reputation Desk (/admin/reputation).
 * /reputation/report/<token> — a free scan's report.
 */
import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, EyeOff, FileWarning, Image as ImageIcon, Loader2, MessageSquareWarning, Search,
  ShieldCheck, Star, UserX, BookOpen, TrendingUp, Youtube,
} from "lucide-react";
import {
  REP_PLANS, REP_TERM_MONTHS, annualCents, type RepScanReport, type RepSubjectKind,
} from "@shared/reputation";
import { formatMoney } from "@shared/proposals";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { BTN_LG, BTN_PRIMARY, H2, Kicker, LEAD, useDocumentTitle } from "@/components/feature-landing/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SECTION_X = "px-4 sm:px-6 lg:px-8";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "Something went wrong — please try again.");
  return data as T;
}

const SERVICES = [
  { icon: TrendingUp, title: "Push bad results down", desc: "We build and rank pages you control — sites, profiles, articles, press and video — so the results you want fill page one." },
  { icon: FileWarning, title: "Removals", desc: "Requests through Google, Bing and the sites themselves: outdated or personal content, copyright (DMCA), images, YouTube, mugshots and complaint sites." },
  { icon: EyeOff, title: "Non-consensual images", desc: "Fast takedown requests for intimate images shared without consent, through each platform's own process and StopNCII." },
  { icon: MessageSquareWarning, title: "Autocomplete cleanup", desc: "We watch what Google suggests when people type your name and report predictions that break Google's policies." },
  { icon: UserX, title: "People-search opt-outs", desc: "We find your home address, phone and relatives on people-search and data-broker sites and opt you out, then check again." },
  { icon: BookOpen, title: "Wikipedia", desc: "A neutral, well-sourced article where you meet Wikipedia's notability rules — submitted openly through Wikipedia's own review." },
  { icon: Star, title: "Reviews & listings", desc: "Review monitoring, responses, review requests and accurate business listings everywhere customers look." },
  { icon: Search, title: "SEO, ads, social & websites", desc: "The marketing that keeps a restored name strong: search optimization, paid search, social media and web design." },
];

const STEPS = [
  { n: "1", title: "Free scan", desc: "See what Google shows for your name today, scored out of 100." },
  { n: "2", title: "Free plan call", desc: "We go through every result and tell you what can be removed, what must be pushed down, and how long it usually takes." },
  { n: "3", title: "Your plan", desc: "Choose a plan, sign and pay online — bank transfer has no fee." },
  { n: "4", title: "Work & monthly report", desc: "We work the plan, re-check your results on a schedule and report what moved every month." },
];

const FAQS = [
  { q: "Can you delete anything from Google?", a: "No one can delete everything. Some content qualifies for removal under Google's or the site's own policies, or the law (copyright, personal information, non-consensual images, outdated pages). The rest is pushed down by stronger pages. We tell you which is which before you pay." },
  { q: "How long does it take?", a: "Removals that qualify can move in weeks. Pushing results off page one usually takes months, depending on how strong the negative page is. Plans run for 12 months." },
  { q: "Do you use fake reviews, click farms or link networks?", a: "No. Those break Google's rules and put your name at risk. We build real pages and request removals through official channels." },
  { q: "Is the scan really free?", a: "Yes. You get the score and every result we found by email. No card needed." },
];

function ScoreDial({ score, grade }: { score: number; grade: string }) {
  const color = score >= 80 ? "#16a34a" : score >= 65 ? "#ca8a04" : score >= 50 ? "#ea580c" : "#dc2626";
  return (
    <div className="flex items-center gap-4" data-testid="score-dial">
      <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${color} ${score * 3.6}deg, #e5e7eb 0)` }}>
        <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-3xl font-bold tabular-nums" style={{ color }}>{score}</span>
          <span className="text-xs text-slate-500">of 100</span>
        </div>
      </div>
      <div><div className="text-sm text-slate-500">Reputation grade</div><div className="text-4xl font-bold" style={{ color }}>{grade}</div></div>
    </div>
  );
}

function ReportView({ report, name }: { report: RepScanReport; name?: string | null }) {
  const negatives = report.results.filter((r) => r.sentiment === "negative");
  return (
    <div className="space-y-6" data-testid="reputation-report">
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border-2 border-mkt-ink bg-mkt-card p-6">
        <ScoreDial score={report.score} grade={report.grade} />
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><div className="text-2xl font-bold text-red-600 tabular-nums">{report.counts.negativeTop10}</div><div className="text-xs text-mkt-muted">negative on page 1</div></div>
          <div><div className="text-2xl font-bold tabular-nums">{report.counts.negativeAutocomplete}</div><div className="text-xs text-mkt-muted">negative predictions</div></div>
          <div><div className="text-2xl font-bold text-emerald-600 tabular-nums">{report.counts.ownedTop10}</div><div className="text-xs text-mkt-muted">your pages on page 1</div></div>
        </div>
      </div>
      <p className="text-sm text-mkt-muted">Google results for <b>“{report.query}”</b> in the United States, checked {new Date(report.checkedAt).toLocaleString()}.{name ? ` Prepared for ${name}.` : ""}</p>
      {report.autocomplete.length > 0 && (
        <div>
          <h3 className="font-display text-lg font-semibold">What Google suggests</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {report.autocomplete.map((a) => (
              <span key={a.suggestion} className={cn("rounded-full border px-3 py-1 text-sm", a.sentiment === "negative" ? "border-red-300 bg-red-50 text-red-800" : "border-mkt-rule bg-white")}>{a.suggestion}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="font-display text-lg font-semibold">Your first two pages</h3>
        <ol className="mt-2 divide-y rounded-xl border bg-white">
          {report.results.map((r, i) => (
            <li key={i} className="flex gap-3 p-3" data-testid={`report-result-${i}`}>
              <span className="w-8 shrink-0 text-right font-mono text-sm text-mkt-muted">#{r.position}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.kind === "video" && <Youtube className="h-4 w-4 text-red-600" />}{r.kind === "image" && <ImageIcon className="h-4 w-4 text-slate-500" />}
                  <span className="truncate font-medium">{r.title || r.url}</span>
                </div>
                <div className="truncate text-xs text-mkt-muted">{r.domain}{r.reason ? ` · ${r.reason}` : ""}</div>
              </div>
              <span className={cn("h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                r.sentiment === "negative" ? "bg-red-100 text-red-700" : r.control === "owned" ? "bg-emerald-100 text-emerald-700" : r.sentiment === "positive" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600")}>
                {r.sentiment === "negative" ? "Negative" : r.control === "owned" ? "Yours" : r.sentiment === "positive" ? "Positive" : "Neutral"}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-2xl bg-mkt-navy p-6 text-mkt-navy-ink">
        <h3 className="font-display text-xl font-semibold">{negatives.length ? `${negatives.length} result${negatives.length > 1 ? "s" : ""} could be hurting you.` : "Your page one looks clean."}</h3>
        <p className="mt-1 text-mkt-navy-muted">{negatives.length ? "Book a free plan call: we'll tell you which can be removed and which need to be pushed down." : "Keep it that way — we can monitor it and build your presence."}</p>
        <a href="mailto:support@constructhub.us?subject=Reputation%20plan%20call" className={`${BTN_PRIMARY} ${BTN_LG} mt-4 inline-flex`}>Book my free plan call <ArrowRight className="ml-2 h-4 w-4" /></a>
      </div>
    </div>
  );
}

function ScanForm() {
  const { toast } = useToast();
  const [query, setQuery] = useState(""); const [kind, setKind] = useState<RepSubjectKind>("person");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [captcha, setCaptcha] = useState("");
  const widget = useRef<number | null>(null);
  const { data: config } = useQuery<{ captchaSiteKey: string | null; available: boolean }>({ queryKey: ["/api/reputation/public/config"], queryFn: () => call("GET", "/api/reputation/public/config") });
  useEffect(() => {
    if (!config?.captchaSiteKey) return;
    let stopped = false;
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.onload = () => { const g = (window as any).grecaptcha; g?.ready(() => { if (!stopped) widget.current = g.render("rep-captcha", { sitekey: config.captchaSiteKey, callback: setCaptcha, "expired-callback": () => setCaptcha("") }); }); };
    document.head.appendChild(script);
    return () => { stopped = true; script.remove(); };
  }, [config?.captchaSiteKey]);
  const scan = useMutation({
    mutationFn: () => call<{ token: string }>("POST", "/api/reputation/public/scan", { query, kind, name, email, phone: phone || undefined, captchaToken: captcha || undefined }),
    onSuccess: (r) => { window.location.href = `/reputation/report/${r.token}`; },
    onError: (e: Error) => { toast({ title: "Couldn't run the scan", description: e.message, variant: "destructive" }); (window as any).grecaptcha?.reset?.(widget.current); setCaptcha(""); },
  });
  const ready = query.trim().length >= 2 && name.trim() && EMAIL_PATTERN.test(email.trim()) && (!config?.captchaSiteKey || captcha);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready && !scan.isPending) scan.mutate(); }} data-testid="form-reputation-scan">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who to check">
        {(["person", "business"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={cn("rounded-lg border-2 px-3 py-2 text-sm font-semibold", kind === k ? "border-mkt-orange bg-mkt-orange/10" : "border-mkt-rule")} data-testid={`kind-${k}`}>
            {k === "person" ? "A person" : "A business"}
          </button>
        ))}
      </div>
      <div><Label htmlFor="rep-q">{kind === "person" ? "Name to check (as people search it)" : "Business name (add the city if it's common)"}</Label>
        <Input id="rep-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "person" ? "Jane Smith Seattle" : "Smith Roofing Tampa"} className="mt-1.5 h-11" data-testid="input-rep-query" /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="rep-name">Your name</Label><Input id="rep-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-11" autoComplete="name" data-testid="input-rep-name" /></div>
        <div><Label htmlFor="rep-email">Email for the report</Label><Input id="rep-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 h-11" autoComplete="email" data-testid="input-rep-email" /></div>
      </div>
      <div><Label htmlFor="rep-phone">Phone (optional)</Label><Input id="rep-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5 h-11" autoComplete="tel" /></div>
      {config?.captchaSiteKey && <div id="rep-captcha" />}
      <button type="submit" disabled={!ready || scan.isPending || config?.available === false} className={`${BTN_PRIMARY} ${BTN_LG} w-full disabled:opacity-50`} data-testid="button-rep-scan">
        {scan.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking Google… (about 20 seconds)</> : <>Scan my reputation free <ArrowRight className="ml-2 h-4 w-4" /></>}
      </button>
      {config?.available === false && <p className="text-sm text-red-600">The free scan is unavailable right now.</p>}
      <p className="text-xs text-mkt-muted">We email you the report. We use your details only to send it and to follow up about it.</p>
    </form>
  );
}

function ReportPage({ token }: { token: string }) {
  useDocumentTitle("Your Reputation Report | ConstructHUB");
  const { data, error, isLoading } = useQuery<{ name: string | null; report: RepScanReport }>({ queryKey: ["rep-report", token], queryFn: () => call("GET", `/api/reputation/public/report/${token}`), retry: false });
  return (
    <div className="h-full overflow-y-auto">
      <PublicPageHeader next="/reputation" backWhenSignedIn />
      <div className="mkt-editorial mkt-shadcn min-h-screen bg-mkt-paper text-mkt-ink" data-testid="page-reputation-report">
        <div className={`mx-auto max-w-4xl ${SECTION_X} py-10 sm:py-14`}>
          <Kicker n="">FREE REPUTATION REPORT</Kicker>
          <h1 className="font-display mt-4 text-[2.2rem] font-semibold leading-tight sm:text-[2.8rem]">{data ? `“${data.report.query}”` : "Your report"}</h1>
          <div className="mt-6">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-mkt-muted" /> : error || !data ? <p className="text-mkt-muted">{(error as Error)?.message ?? "This report isn't available."}</p> : <ReportView report={data.report} name={data.name} />}
          </div>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}

export default function ReputationPage() {
  const [isReport, params] = useRoute("/reputation/report/:token");
  useDocumentTitle("Reputation Restoration — Remove & Push Down Negative Results | ConstructHUB");
  if (isReport && params?.token) return <ReportPage token={params.token} />;
  return (
    <div className="h-full overflow-y-auto">
      <PublicPageHeader next="/reputation" backWhenSignedIn />
      <div className="mkt-editorial mkt-shadcn overflow-x-clip bg-mkt-paper text-mkt-ink" data-testid="page-reputation">
        <section className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]" aria-hidden />
          <div className={`relative mx-auto max-w-6xl ${SECTION_X} pt-8 pb-12 sm:pt-12 lg:pt-16 lg:pb-20`}>
            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-7">
                <Kicker n=""><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> REPUTATION RESTORATION</span></Kicker>
                <h1 className="font-display mt-5 text-[2.45rem] font-semibold leading-[1.04] tracking-[-0.02em] [text-wrap:balance] sm:text-[3.2rem] lg:text-[3.6rem]" data-testid="text-reputation-title">
                  What does Google say when someone <span className="mkt-marker">searches your name</span>?
                </h1>
                <p className="mt-6 max-w-[37rem] text-base leading-relaxed text-mkt-ink-soft sm:text-lg">
                  We remove what can be removed, push down what can't, clean up autocomplete and take you off people-search sites — for people and businesses. White-hat only, with a monthly report on what moved.
                </p>
                <ul className="mt-8 grid max-w-xl gap-2 sm:grid-cols-2">
                  {["Removals through official channels", "Negative results pushed off page one", "Autocomplete & people-search cleanup", "Reviews, listings and Wikipedia"].map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[15px]"><CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-mkt-orange-ink" />{t}</li>
                  ))}
                </ul>
              </div>
              <div id="scan" className="scroll-mt-16 overflow-hidden rounded-2xl border-2 border-mkt-ink bg-mkt-card lg:col-span-5">
                <div className="mkt-hazard h-2" aria-hidden />
                <div className="p-6 lg:p-7">
                  <h2 className="font-display text-[1.4rem] font-semibold leading-tight">Free reputation scan</h2>
                  <p className="mt-1 mb-5 text-sm text-mkt-muted">Your score out of 100, every result on Google's first two pages, and what autocomplete suggests.</p>
                  <ScanForm />
                </div>
              </div>
            </div>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </section>

        <section className={`py-20 lg:py-24 ${SECTION_X}`}>
          <div className="mx-auto max-w-6xl">
            <Kicker n="01">What we do</Kicker>
            <h2 className={H2}>Everything that shapes your name online</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {SERVICES.map((s) => (
                <div key={s.title} className="rounded-2xl border border-mkt-rule bg-mkt-card p-6">
                  <s.icon className="mb-3 h-7 w-7 text-mkt-orange-ink" strokeWidth={1.75} />
                  <h3 className="font-display text-[1.15rem] font-semibold leading-tight">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-mkt-ink-soft">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`relative bg-mkt-navy py-20 text-mkt-navy-ink lg:py-24 ${SECTION_X}`}>
          <div className="mx-auto max-w-6xl">
            <Kicker n="02" className="!text-mkt-orange [&>span:nth-child(2)]:!text-mkt-navy-muted">Plans for individuals</Kicker>
            <h2 className="font-display mt-5 text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[2.6rem]">Pick the plan that fits the damage</h2>
            <p className="mt-3 text-[17px] text-mkt-navy-muted">{REP_TERM_MONTHS}-month plans, billed monthly — or prepay the year and save 10%. Business and executive programs are quoted after a free review.</p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {REP_PLANS.map((p) => (
                <div key={p.key} className={cn("relative flex flex-col rounded-2xl border p-6", "badge" in p ? "border-mkt-orange bg-[color:color-mix(in_srgb,var(--mkt-orange)_10%,transparent)]" : "border-mkt-navy-rule")} data-testid={`plan-${p.key}`}>
                  {"badge" in p && <span className="absolute -top-3 left-6 rounded-full bg-mkt-orange px-3 py-0.5 text-xs font-semibold text-white">{p.badge}</span>}
                  <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                  <p className="text-sm text-mkt-navy-muted">{p.fit}</p>
                  <div className="mt-4"><span className="font-display text-[2.2rem] font-semibold">{formatMoney(p.monthlyCents)}</span><span className="text-mkt-navy-muted"> /month</span></div>
                  <div className="text-xs text-mkt-navy-muted">or {formatMoney(annualCents(p.monthlyCents))} prepaid for the year</div>
                  <div className="mt-3 text-sm font-semibold text-mkt-orange">{p.negatives}</div>
                  <ul className="mt-3 flex-1 space-y-2 text-[14px]">
                    {p.includes.map((i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mkt-orange" />{i}</li>)}
                  </ul>
                  <a href="#scan" className={`${BTN_PRIMARY} mt-5 h-11 justify-center`}>Start with a free scan</a>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-mkt-navy-muted">Removals of specific pages, people-search opt-out programs and Wikipedia are available as add-ons, quoted per case.</p>
          </div>
        </section>

        <section className={`py-20 lg:py-24 ${SECTION_X}`}>
          <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-2">
            <div>
              <Kicker n="03">How it works</Kicker>
              <h2 className={H2}>From scan to a cleaner page one</h2>
              <ol className="mt-8 space-y-6">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mkt-orange font-semibold text-white">{s.n}</span>
                    <div><h3 className="font-display text-lg font-semibold">{s.title}</h3><p className={LEAD}>{s.desc}</p></div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <Kicker n="04">Questions</Kicker>
              <h2 className={H2}>Straight answers</h2>
              <div className="mt-8 space-y-5">
                {FAQS.map((f) => (
                  <details key={f.q} className="rounded-xl border border-mkt-rule bg-mkt-card p-5" open>
                    <summary className="cursor-pointer font-display font-semibold">{f.q}</summary>
                    <p className="mt-2 text-[15px] leading-relaxed text-mkt-ink-soft">{f.a}</p>
                  </details>
                ))}
              </div>
              <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Need an intimate image or doxxing taken down urgently? Say so in the scan form or email support@constructhub.us — those go first.</span>
              </div>
            </div>
          </div>
        </section>
      </div>
      <PublicPageFooter />
    </div>
  );
}
