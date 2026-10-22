/**
 * /get-started — the paid-ad landing page for the ConstructHUB CRM (also served at the Google Ads door
 * /googleads-crm, server/ads-landing.ts). One job: start the CRM trial. No site menu, no footer links away.
 *
 * Built after what converts for the CRM competitors' ad pages (a branded-search page with an inline email
 * field, a demo/setup-call option, a product screenshot, plain pricing, a short FAQ, a sticky CTA).
 *
 * Every claim is true in the code:
 *   - trial length and prices come from shared/crm-plans.ts (CRM_TRIAL_DAYS, CRM_PLANS), never typed;
 *   - the trial starts at Stripe checkout with a card (server/crm/billing.ts: trial_period_days on a
 *     subscription Checkout), while creating the account itself needs no card (pages/auth.tsx);
 *   - features, import, payments and "no platform fee" are the CRM feature page's verified copy
 *     (shared/feature-pages/crm.ts and its `sources`);
 *   - "built by people who ran contracting companies" is the home page's own line (pages/landing.tsx).
 * No testimonials, ratings, review or customer counts: the slot below renders nothing until real ones are
 * added to client/src/lib/testimonials.ts.
 *
 * The hand-off: the email goes to /auth?mode=signup&email=…, and after sign-up the visitor lands on the CRM
 * plans (/pricing#crm), where choosing a plan opens checkout with the trial. The sign-up conversion (Google
 * Ads + Meta pixel) fires on /auth as for every sign-up (lib/gtag.ts).
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, CreditCard, FileSignature, Phone, Upload, Users, Wallet, CalendarDays, KanbanSquare } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import { trackEvent } from "@/lib/gtag";
import { TESTIMONIALS, type Testimonial } from "@/lib/testimonials";
import { CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS, CRM_EXTRA_SEAT_MONTHLY_CENTS } from "@shared/crm-plans";
import { formatUsd } from "@shared/plan-copy";
import { SUPPORT_PHONE_LOCAL, SUPPORT_PHONE_TEL } from "@shared/contact";

export const GET_STARTED_PATH = "/get-started";
/** After sign-up: the CRM's plans, where a plan starts checkout with the trial. */
const AFTER_SIGNUP = "/pricing#crm";

const STARTING = CRM_PLANS[CRM_PLAN_KEYS[0]];
const FROM_PRICE = `${formatUsd(STARTING.monthlyCents)}/mo`;
const TRIAL = `${CRM_TRIAL_DAYS}-day free trial`;
const TERMS_LINE = `${TRIAL} · plans from ${FROM_PRICE} · cancel any time`;

export function signupHref(email = ""): string {
  const e = email.trim();
  return `/auth?mode=signup${e ? `&email=${encodeURIComponent(e)}` : ""}&next=${encodeURIComponent(AFTER_SIGNUP)}`;
}

const BTN = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-paper";
const BTN_PRIMARY = `${BTN} bg-mkt-orange text-white hover:bg-mkt-orange-hover`;
const H2 = "font-display font-semibold text-[2rem] sm:text-[2.5rem] lg:text-[2.9rem] leading-[1.05] tracking-[-0.02em] text-mkt-ink";
const KICKER = "text-[12px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink";

const seatsLabel = (n: number) => (n < 0 ? "Unlimited seats" : `${n} seat${n === 1 ? "" : "s"}`);

const BENEFITS: { icon: typeof Wallet; title: string; body: string; img: string; alt: string }[] = [
  {
    icon: Wallet,
    title: "Get paid into your own account",
    body: "Invoice the job and take card or bank (ACH) payments through your own Stripe account, or record cash and checks. ConstructHUB adds no fee, and a receipt emails after every payment.",
    img: "/ad-landing/crm-invoices",
    alt: "CRM invoices list for a sample roofing company with paid, sent and overdue invoices and their totals.",
  },
  {
    icon: Users,
    title: "A portal your homeowners will use",
    body: "Every client gets a portal the moment you add them: their estimates, invoices and signed contracts, plus a place to send you notes and photos of the house.",
    img: "/feature-shots/crm-2",
    alt: "CRM client list with sample homeowners and HOAs, their contact details, city and bid status.",
  },
  {
    icon: KanbanSquare,
    title: "Every job from lead to paid",
    body: "Stages for sales, production and billing. Sending an estimate and the client's approval move the job for you; drag a card to move it yourself.",
    img: "/feature-shots/crmLeads-2",
    alt: "Sales stages of the CRM pipeline: sample estimating, proposal-sent and approved roofing projects with their values.",
  },
  {
    icon: CalendarDays,
    title: "Schedule and dispatch your crews",
    body: "The whole crew calendar in one view: inspections, installs and deliveries, with a week view for dispatching.",
    img: "/feature-shots/crmSchedule-1",
    alt: "CRM schedule month view with a sample crew calendar of inspections, tear-offs and deliveries.",
  },
];

const PROOF: { icon: typeof Wallet; text: string }[] = [
  { icon: FileSignature, text: "Estimates clients sign online, with a signed contract PDF" },
  { icon: CreditCard, text: "No platform fee on your payments" },
  { icon: Upload, text: "Bring your clients over from a CSV file" },
  { icon: Check, text: "Built by people who ran contracting companies" },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need a credit card?",
    a: `Not to create your account. To start the ${TRIAL}, you choose a CRM plan and enter a card at checkout; it isn't charged until the trial ends.`,
  },
  {
    q: "Can I cancel?",
    a: "Yes, any time. Cancel before your trial ends and you aren't charged.",
  },
  {
    q: "Can I import my clients?",
    a: "Yes. Export clients, estimates or invoices from your old system as a CSV or tab-delimited file, match the columns and import. Clients are matched by email or phone so you don't get duplicates, and you can request an assisted import instead.",
  },
  {
    q: "Does ConstructHUB take a cut of my payments?",
    a: "No. Payments go to your own Stripe account and ConstructHUB adds no platform fee. Stripe's own processing fees still apply.",
  },
  {
    q: "What does it cost after the trial?",
    a: `${CRM_PLAN_KEYS.map((k) => `${CRM_PLANS[k].name} ${formatUsd(CRM_PLANS[k].monthlyCents)}/mo`).join(", ")}. Extra seats are ${formatUsd(CRM_EXTRA_SEAT_MONTHLY_CENTS)}/mo each. The CRM is its own subscription, separate from the ConstructHUB platform plans.`,
  },
];

/** A product screenshot: webp at 800 and 1600 px wide (the app at 1440 px), lazy unless it is the hero. */
function Shot({ base, alt, width, height, eager = false, className = "" }: { base: string; alt: string; width: number; height: number; eager?: boolean; className?: string }) {
  // The feature-page shots ship one 1600 px file; the ad page's own shots also have an 800 px one.
  const small = base.startsWith("/ad-landing/");
  return (
    <img
      src={`${base}.webp`}
      srcSet={small ? `${base}-800.webp 800w, ${base}.webp 1600w` : undefined}
      sizes={small ? "(min-width: 1024px) 720px, 100vw" : undefined}
      width={width}
      height={height}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      {...(eager ? { fetchpriority: "high" } : {})}
      className={`block w-full h-auto ${className}`}
    />
  );
}

/** The browser-window frame around a screenshot, captioned "Sample data" as the feature pages are. */
function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure className="rounded-xl border border-mkt-rule bg-mkt-card shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-mkt-rule bg-mkt-paper-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-mkt-rule" /><span className="h-2.5 w-2.5 rounded-full bg-mkt-rule" /><span className="h-2.5 w-2.5 rounded-full bg-mkt-rule" />
        <span className="ml-3 truncate text-[11px] text-mkt-muted">{label}</span>
      </div>
      {children}
      <figcaption className="px-3 py-1.5 text-[11px] text-mkt-muted border-t border-mkt-rule">Sample data</figcaption>
    </figure>
  );
}

function EmailStart({ id, onNavy = false, autoFocus = false }: { id: string; onNavy?: boolean; autoFocus?: boolean }) {
  const [email, setEmail] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    trackEvent("begin_sign_up", { item_category: "crm", source: id, page: window.location.pathname });
    window.location.assign(signupHref(email));
  };
  return (
    <form onSubmit={submit} className="w-full max-w-xl" data-testid={`form-start-${id}`}>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <label htmlFor={`email-${id}`} className="sr-only">Work email</label>
        <input
          id={`email-${id}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus={autoFocus}
          placeholder="Your work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`h-12 flex-1 min-w-0 rounded-lg border-2 px-4 text-base outline-none focus:border-mkt-orange ${onNavy ? "border-transparent bg-white text-slate-900 placeholder:text-slate-500" : "border-mkt-rule bg-mkt-card text-mkt-ink placeholder:text-mkt-muted"}`}
          data-testid={`input-email-${id}`}
        />
        <button type="submit" className={`${BTN_PRIMARY} h-12 px-6 text-base`} data-testid={`button-start-${id}`}>
          Start free trial <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <p className={`mt-2.5 text-[13.5px] ${onNavy ? "text-mkt-navy-muted" : "text-mkt-ink-soft"}`} data-testid={`text-trial-terms-${id}`}>{TERMS_LINE}</p>
    </form>
  );
}

/** Real customer quotes only (client/src/lib/testimonials.ts). Renders nothing while that list is empty. */
export function TestimonialSlot({ items = TESTIMONIALS }: { items?: readonly Testimonial[] }) {
  if (!items.length) return null;
  return (
    <section className="py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-y border-mkt-rule" data-testid="section-testimonials">
      <div className="max-w-6xl mx-auto grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <figure key={`${t.name}-${t.role}`} className="rounded-xl border border-mkt-rule bg-mkt-card p-6">
            <blockquote className="text-[16px] leading-relaxed text-mkt-ink">“{t.quote}”</blockquote>
            <figcaption className="mt-4 text-[14px] text-mkt-ink-soft"><span className="font-semibold text-mkt-ink">{t.name}</span> · {t.role}{t.place ? ` · ${t.place}` : ""}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const PhoneLink = ({ className = "", testId }: { className?: string; testId: string }) => (
  <a href={`tel:${SUPPORT_PHONE_TEL}`} className={`inline-flex items-center gap-1.5 whitespace-nowrap hover:underline underline-offset-4 ${className}`} data-testid={testId}>
    <Phone className="h-3.5 w-3.5" aria-hidden /> {SUPPORT_PHONE_LOCAL}
  </a>
);

export default function GetStartedPage() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [salesOpen, setSalesOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  // The sticky CTAs appear once the hero's own form has scrolled away.
  const heroForm = useRef<HTMLDivElement>(null);
  const [pastHero, setPastHero] = useState(false);
  useEffect(() => {
    const el = heroForm.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Signed in already: the trial starts from the CRM plans, no sign-up needed.
  const startHref = user ? AFTER_SIGNUP : signupHref();
  const openSales = (where: string) => {
    trackEvent("open_setup_call", { item_category: "crm", source: where, page: window.location.pathname });
    setSalesOpen(true);
  };

  return (
    <div className="mkt-editorial min-h-screen bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-get-started">
      {/* Slim header: the logo, the phone line, sign in — and, once the hero form is out of view, the trial button. */}
      <header className="app-status-pad sticky top-0 z-40 bg-mkt-navy border-b-[3px] border-mkt-orange" data-testid="header-get-started">
        <div className="max-w-6xl mx-auto h-14 px-4 sm:px-6 lg:px-8 flex items-center gap-4">
          <a href="/" aria-label="ConstructHUB home" data-testid="link-logo-home"><CHLogo height={32} /></a>
          <div className="ml-auto flex items-center gap-4 sm:gap-5 text-[14px] text-mkt-navy-ink">
            <PhoneLink className="hidden sm:inline-flex font-medium" testId="link-phone-header" />
            <a href={`tel:${SUPPORT_PHONE_TEL}`} aria-label={`Call ${SUPPORT_PHONE_LOCAL}`} className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-mkt-navy-rule" data-testid="link-phone-header-mobile"><Phone className="h-4 w-4" aria-hidden /></a>
            <a href="/auth" className="font-medium hover:underline underline-offset-4" data-testid="link-sign-in">Sign in</a>
            <a
              href={startHref}
              className={`${BTN_PRIMARY} hidden sm:inline-flex h-9 px-4 text-[14px] transition-opacity ${pastHero ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              aria-hidden={!pastHero}
              tabIndex={pastHero ? 0 : -1}
              data-testid="link-header-start"
            >
              Start free trial
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]" aria-hidden />
        <div className="relative max-w-[76rem] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-12 lg:pt-16 pb-12 lg:pb-20 grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-5">
            <p className={KICKER}>ConstructHUB CRM for contractors</p>
            <h1 className="font-display font-semibold mt-3 text-[2.3rem] leading-[1.02] sm:text-[3.2rem] lg:text-[3.6rem] tracking-[-0.02em]" data-testid="text-hero-headline">
              Win more jobs. <span className="mkt-marker">Get paid faster.</span>
            </h1>
            <p className="mt-3 sm:mt-5 text-[16px] sm:text-lg leading-snug sm:leading-relaxed text-mkt-ink-soft max-w-[34rem]">
              Estimates homeowners sign online, invoices they pay by card or ACH, and a client portal for every job — built for roofers, remodelers and every trade.
            </p>
            <div ref={heroForm} className="mt-5 sm:mt-7">
              {user ? (
                <a href={AFTER_SIGNUP} className={`${BTN_PRIMARY} h-12 px-6 text-base`} data-testid="link-start-signed-in">Choose your CRM plan <ArrowRight className="h-4 w-4" /></a>
              ) : (
                <EmailStart id="hero" />
              )}
            </div>
            <button type="button" onClick={() => openSales("hero")} className="mt-3 text-[15px] font-semibold text-mkt-orange-ink underline decoration-2 decoration-mkt-orange-soft underline-offset-4 hover:decoration-mkt-orange" data-testid="button-setup-call-hero">
              Or book a free setup call
            </button>
          </div>
          <div className="lg:col-span-7">
            <Frame label="portal.constructhub.us/crm/estimates">
              <Shot base="/ad-landing/crm-estimates" alt="ConstructHUB CRM estimates list for a sample roofing company: draft, sent, viewed and approved estimates with clients, job titles and totals." width={1600} height={911} eager />
            </Frame>
          </div>
        </div>
        <div className="mkt-ruler" aria-hidden />
      </section>

      {/* Proof: facts about the product, nothing about customers we don't have yet. */}
      <section className="bg-mkt-paper-2 border-b border-mkt-rule" data-testid="section-proof">
        <ul className="max-w-[76rem] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
          {PROOF.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-[14.5px] text-mkt-ink-soft"><Icon className="h-4 w-4 mt-0.5 shrink-0 text-mkt-orange" aria-hidden /> {text}</li>
          ))}
        </ul>
      </section>

      <TestimonialSlot />

      {/* Benefits */}
      <section className="py-16 lg:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className={KICKER}>What you get</p>
          <h2 className={`${H2} mt-3 max-w-3xl`}>From the first estimate to the final payment, in one place</h2>
          <div className="mt-12 lg:mt-16 space-y-14 lg:space-y-20">
            {BENEFITS.map((b, i) => (
              <div key={b.title} className="grid lg:grid-cols-12 gap-6 lg:gap-12 items-center">
                <div className={`lg:col-span-5 ${i % 2 ? "lg:order-2" : ""}`}>
                  <div className="h-11 w-11 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-orange"><b.icon className="h-5 w-5" strokeWidth={1.75} /></div>
                  <h3 className="mt-4 font-display font-semibold text-[1.6rem] sm:text-[1.9rem] leading-tight">{b.title}</h3>
                  <p className="mt-3 text-[16px] leading-relaxed text-mkt-ink-soft">{b.body}</p>
                </div>
                <div className={`lg:col-span-7 ${i % 2 ? "lg:order-1" : ""}`}>
                  <Frame label="ConstructHUB CRM"><Shot base={b.img} alt={b.alt} width={1600} height={b.img.startsWith("/ad-landing/") ? 911 : 1000} /></Frame>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-mkt-navy text-mkt-navy-ink py-16 lg:py-20 px-4 sm:px-6 lg:px-8" data-testid="section-how">
        <div className="max-w-6xl mx-auto">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-mkt-orange">How it works</p>
          <h2 className="font-display font-semibold mt-3 text-[2rem] sm:text-[2.5rem] leading-[1.05] tracking-[-0.02em]">Three steps to your first estimate</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              { t: "Start free", b: `Create your account, pick a CRM plan and start your ${TRIAL}.` },
              { t: "Add your first client", b: "Type them in or import your list from a CSV file. Each client gets their own portal." },
              { t: "Send your first estimate", b: "Price it from your price book and email it. The client approves by typing their name." },
            ].map((s, i) => (
              <li key={s.t} className="rounded-xl border border-mkt-navy-rule p-6">
                <span className="font-display text-[2.4rem] leading-none text-mkt-orange">{i + 1}</span>
                <h3 className="mt-3 font-display font-semibold text-[1.4rem]">{s.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-mkt-navy-muted">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Price */}
      <section className="py-16 lg:py-24 px-4 sm:px-6 lg:px-8" data-testid="section-price">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          <div className="lg:col-span-5">
            <p className={KICKER}>Pricing</p>
            <h2 className={`${H2} mt-3`}>Plans from {FROM_PRICE}</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-mkt-ink-soft">
              Every plan starts with a {TRIAL}. Unlimited clients and jobs, estimates, invoices, online payments, the client portal and scheduling are on every plan. Cancel any time.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-2 gap-3 sm:gap-4">
            {CRM_PLAN_KEYS.map((k) => {
              const p = CRM_PLANS[k];
              return (
                <div key={k} className="rounded-xl border border-mkt-rule bg-mkt-card p-4 sm:p-5" data-testid={`card-plan-${k}`}>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-mkt-muted">{p.name.replace(/^CRM /, "")}</p>
                  <p className="mt-1 font-display font-semibold text-[2rem] leading-none">{formatUsd(p.monthlyCents)}<span className="text-[15px] font-sans font-medium text-mkt-muted">/mo</span></p>
                  <p className="mt-2 text-[14px] text-mkt-ink-soft">{seatsLabel(p.limits.seats)}</p>
                  <p className="mt-1 text-[13px] text-mkt-muted leading-snug hidden sm:block">{p.tagline}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-16 lg:pb-24 px-4 sm:px-6 lg:px-8" data-testid="section-faq">
        <div className="max-w-3xl mx-auto">
          <h2 className={H2}>Questions</h2>
          <div className="mt-8 divide-y divide-mkt-rule border-y border-mkt-rule">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q}>
                  <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open} className="w-full flex items-center justify-between gap-4 py-4 text-left text-[17px] font-semibold" data-testid={`button-faq-${i}`}>
                    {f.q}
                    <ChevronDown className={`h-5 w-5 shrink-0 text-mkt-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {open && <p className="pb-5 -mt-1 text-[15.5px] leading-relaxed text-mkt-ink-soft">{f.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative bg-mkt-navy text-mkt-navy-ink py-16 lg:py-20 px-4 sm:px-6 lg:px-8 overflow-hidden" data-testid="section-final-cta">
        <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-60" aria-hidden />
        <div className="relative max-w-3xl mx-auto text-center flex flex-col items-center">
          <h2 className="font-display font-semibold text-[2.2rem] sm:text-[2.9rem] leading-[1.05] tracking-[-0.02em]">Send your next estimate from ConstructHUB</h2>
          <div className="mt-8 w-full flex justify-center text-left">
            {user ? (
              <a href={AFTER_SIGNUP} className={`${BTN_PRIMARY} h-12 px-6 text-base`}>Choose your CRM plan <ArrowRight className="h-4 w-4" /></a>
            ) : (
              <EmailStart id="final" onNavy />
            )}
          </div>
          <p className="mt-6 text-[15px] text-mkt-navy-muted">
            Questions? Call <PhoneLink className="text-mkt-navy-ink font-semibold" testId="link-phone-final" /> or{" "}
            <button type="button" onClick={() => openSales("final")} className="font-semibold text-mkt-navy-ink underline underline-offset-4" data-testid="button-setup-call-final">book a free setup call</button>.
          </p>
        </div>
      </section>

      <footer className="bg-mkt-navy border-t border-mkt-navy-rule pt-5 pb-24 sm:pb-5 px-4 text-center text-[12.5px] text-mkt-navy-muted">
        © {new Date().getFullYear()} ConstructHUB · <a href="/terms" className="hover:text-mkt-navy-ink">Terms</a> · <a href="/privacy" className="hover:text-mkt-navy-ink">Privacy</a>
      </footer>

      {/* Phones: a bottom bar once the hero form is out of view. */}
      <div className={`sm:hidden fixed inset-x-0 bottom-0 z-40 bg-mkt-navy border-t-[3px] border-mkt-orange px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] transition-transform ${pastHero ? "translate-y-0" : "translate-y-full"}`} data-testid="bar-mobile-start">
        <a href={startHref} className={`${BTN_PRIMARY} w-full h-12 text-base`} tabIndex={pastHero ? 0 : -1} data-testid="link-mobile-start">Start free trial <ArrowRight className="h-4 w-4" /></a>
      </div>

      <TalkToSalesDialog
        open={salesOpen}
        onOpenChange={setSalesOpen}
        topic={`CRM free setup call (ad page ${typeof window === "undefined" ? GET_STARTED_PATH : window.location.pathname})`}
        onSent={() => trackEvent("generate_lead", { item_category: "crm_setup_call", page: window.location.pathname })}
      />
    </div>
  );
}
