/**
 * /call-assistant — the AI Call Assistant's marketing page, for signed-out
 * visitors (public header + footer) and signed-in users (inside the dashboard
 * frame; the main sidebar's "Call Assistant" entry lands here).
 *
 * Design B ("editorial warmth", see landing.tsx): Fraunces + Plus Jakarta Sans
 * on cream paper, navy grid panels, one orange. The shared pieces live in
 * components/call-assistant-marketing.tsx.
 *
 * Honest copy for a launching product: no call counts, customers or
 * testimonials. What it does comes from docs/call-assistant/SPEC.md; every
 * price from the price book via shared/plan-copy.ts; "Coming soon" shows for
 * as long as the add-on is `preview` in shared/plans.ts.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Building2, MapPinned, BadgeCheck, Tag, ScrollText, UserRound, ListOrdered, MessagesSquare,
  Siren, Send, Settings2, FlaskConical, CheckCircle2, ChevronDown, ShieldBan, Ban, FileBarChart, type LucideIcon,
} from "lucide-react";
import { GabeAvatar } from "@/components/mascot";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import {
  BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, CALL_ASSISTANT_PATH, CA_HIGHLIGHTS, ComingSoonTag, Kicker,
  PersonaCard, introPriceShort, personaNames,
} from "@/components/call-assistant-marketing";
import { PLANS } from "@shared/plans";
import {
  CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SPAM, CALL_ASSISTANT_SPAM_BLOCK_TITLE, SALES_REP_LABEL, callAssistantMinuteRule, callAssistantOverageRule, callAssistantPricing, callAssistantSpamAllowanceLine,
  callAssistantTierAdvice, callAssistantYearlyNote, formatUsd, joinNames,
} from "@shared/plan-copy";
import { VOICE_PERSONAS, VOICE_PERSONA_LIST } from "@shared/voice-personas";
import { ROUTE_META } from "@shared/route-meta";

const H2 = "font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5";
const LEAD = "text-[17px] text-mkt-ink-soft leading-relaxed";

/** The default greeting, as the Gabe voice says it (shared/voice-personas.ts), with the company left blank. */
const GREETING = VOICE_PERSONAS.gabe.sampleLine.replace("your company", "[Your Company]");

const STEPS: { title: string; body: string }[] = [
  {
    title: "Pick who answers",
    body: `Choose ${personaNames("female")}, or ${personaNames("male")}: women's and men's voices. Set the greeting your callers hear.`,
  },
  {
    title: "Get a local number",
    body: "Pick a state, and an area code or city if you like, then choose a local number. We buy it and connect it to your assistant.",
  },
  {
    title: "Forward your lines",
    body: "Forward your office line, cell or tracking numbers to it: when you don't answer, after hours, or always. Your numbers stay yours.",
  },
  {
    title: "Tune it and go live",
    body: "Teach it your services, service area and questions in the Agent Studio, try it in the Simulator, then publish.",
  },
];

/** What the Agent Studio controls (docs/call-assistant/SPEC.md §3, the profile). */
const STUDIO: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Building2, title: "Company & services", body: "What you do, the materials and brands you use, and the jobs you turn down, with who to refer them to." },
  { icon: MapPinned, title: "Service area", body: "The counties you cover, picked by state, and what to tell callers outside them." },
  { icon: BadgeCheck, title: "Credibility", body: "Years in business, licenses, insurance and bonding, warranties, awards and certifications." },
  { icon: Tag, title: "Offers", body: "Financing, current promotions, free estimates and your referral program." },
  { icon: ScrollText, title: "Policies", body: "Whether to talk price ranges or never, repairs or replacements only, a minimum job, and what counts as an emergency." },
  { icon: UserRound, title: "Voice & greeting", body: "The name, the voice, the greeting, the recording notice and how warm, brief or formal it sounds." },
  { icon: ListOrdered, title: "The questions it asks", body: "Every intake question in your order: required or optional, read back to confirm, checked as an address, phone or email." },
  { icon: MessagesSquare, title: "Answers to common questions", body: "Your exact answers to the questions callers ask most, word for word." },
  { icon: Siren, title: "Escalations", body: "Who gets a text or email for emergencies, existing customers, \"I want a person\", payments or complaints, with reminders until someone replies." },
  { icon: Send, title: "Lead delivery", body: "A CRM client and pipeline project for every real lead, with your tags, plus extra email and text recipients." },
  { icon: Settings2, title: "Advanced", body: "Extra instructions in your own words, call length, silence handling, spam sensitivity and the trade words it should recognize." },
  { icon: FlaskConical, title: "Simulator & versions", body: "Chat with your draft assistant by text before it takes a real call. Publish, pause, and restore any earlier version." },
];

/** What a call record holds (SPEC §2 voice_calls) — field names, never sample data. */
const CALL_FIELDS = [
  "Outcome", "Caller's name", "Callback number", "Property address", "Service needed",
  "Best time to call", "Summary", "Full transcript", "Recording",
];

const AFTER_CALL: string[] = [
  "A real lead becomes a client in your CRM, plus a pipeline project if you want one, with \"Call Assistant\" as the lead source.",
  "Your team hears about it the way it hears about every new lead: in the app, by email or by text, as each person has set it up.",
  "Emergencies, existing customers and \"I want a person\" go by text or email to the teammate you choose, with reminders until someone replies.",
  "Spam calls forwarded to your assistant ping nobody. They show under Calls → Spam blocked, where you can block or unblock a number, and in a weekly spam report email.",
];

/**
 * The page's "In Depth" band: the long-form explanation every marketing page carries for ranking
 * (shared/feature-pages/WRITING-GUIDE.md → "The In Depth section"), in the feature pages'
 * InDepthSection layout. Every claim is in the code, not the copy: forwarding modes (STEPS above);
 * "what the call is about" first, the CRM caller line, never reading the digits:
 * server/voice/prompt-compiler.ts (SPAM SCREENING, prefill hints, callerLine); the default intake order and
 * the email read-back: shared/voice-profile.ts DEFAULT_INTAKE_QUESTIONS; the out-of-area line and
 * "take the lead anyway": voice-profile.ts outOfArea/outOfAreaLine; escalations by text or email:
 * server/voice/escalations.ts; spam notifies nobody, two strikes block, a blocked number is rejected
 * before it is answered: server/voice/spam.ts; the CRM client, the "Call Assistant" lead source and the
 * existing client matched by phone: server/voice/leads.ts (callAssistantLeadSourceId, findCustomerByPhone);
 * the hang-up safety net: voice/brain.py _should_force_submit/force_submit, server/voice/brain.ts.
 * No prices here (they come from the price book, above).
 */
const IN_DEPTH: string[] = [
  "The AI Call Assistant is an AI answering service for contractors, built into the ConstructHUB CRM. You forward " +
    "your existing lines to its local number, when you don't answer, after hours or always, and it picks up under " +
    "the name and voice you chose. Its job is the call you would otherwise miss: find out what the caller needs, " +
    "take down a real job the way you set it up, and get it to the right person.",
  "Every call starts the same way: the greeting, your recording notice if it's on, and a question about what the " +
    "call is for, before it collects anything. That first answer is what separates a homeowner with a leak from a " +
    "sales pitch. For a real job it follows your intake questions from the Agent Studio. Out of the box that is the " +
    "work needed, the property address and city, a first name, whether the number they're calling from is the best " +
    "one to reach them (it never reads the digits aloud), an email for the estimate, read back once, and the best " +
    "time to call back. When the number already belongs to a client in your CRM, it confirms the name and email on " +
    "file instead of asking again.",
  "Not every call is a lead, and the assistant sorts them. A caller outside your service area hears your " +
    "out-of-area line, unless you've told it to take the lead anyway. An emergency, an existing customer or a caller " +
    "who asks for a person goes to the teammate you chose, by text or email. A sales pitch or a robocall is marked " +
    "as spam and notifies nobody, and a number marked as spam twice with high confidence is blocked, so its next " +
    "call is rejected before it's answered.",
  "When the call ends, a real lead becomes a client in your CRM with Call Assistant as the lead source, or is " +
    "added to the client who already has that phone number, and the call log keeps the summary, transcript and " +
    "recording. If a caller hangs up before the details were submitted but had given a callback number and said " +
    "what they need, the assistant files the lead from the transcript, or alerts your office to call back, so a " +
    "dropped call isn't simply lost.",
];

function faqs(): { q: string; a: string }[] {
  const p = callAssistantPricing();
  const list = [
    {
      q: "Will callers know they're talking to an AI?",
      a: "It introduces itself by the name you choose, and if a caller asks whether it's a person, it says it is a virtual assistant. It never pretends to be human.",
    },
    {
      q: "Are calls recorded? What about consent?",
      a: "Every call is recorded and transcribed so you can review it in the call log. A short notice that calls may be recorded is on by default. Some states require everyone on a call to consent to recording; if you work in one, keep the notice on (the Studio warns you before you turn it off). This isn't legal advice, so check your state's rules.",
    },
    {
      q: "How does call forwarding work?",
      a: "Your number stays with your phone company. In your carrier's settings (or with a short dial code) you forward it to your Call Assistant number: only when you don't answer, after hours, or always. The Numbers tab shows how for common carriers, and a call-tracking number can point at it too.",
    },
    {
      q: "Can I keep my existing numbers?",
      a: `Yes. ${CALL_ASSISTANT_NUMBER_RULES.ownNumbers} Nothing is ported. Forward as many of your numbers as you like to the assistant. If you want a second local number of your own, for another location or a tracking line, extra numbers are ${p.extraNumber}/mo each.`,
    },
    {
      q: "Where can I get a number?",
      a: "Pick a US state, and an area code or city if you like, and choose from the local numbers available there. What's available depends on the area.",
    },
    {
      q: "Can I try it before it answers real calls?",
      a: "Yes. The Simulator lets you chat with your assistant by text using your draft settings. Publish when you're happy, and pause it any time.",
    },
    {
      q: "What if I cancel?",
      a: `You remove the add-on in Settings → Billing like any other add-on. ${CALL_ASSISTANT_NUMBER_RULES.cancel} Your own numbers were never moved: turn off forwarding with your carrier and calls ring through to you as before.`,
    },
    {
      q: "What if a payment fails?",
      a: `${CALL_ASSISTANT_NUMBER_RULES.payment} Callers hear a short message that the assistant is taking a break instead of reaching it.`,
    },
    {
      q: "Is there a yearly price?",
      a: `Yes: ${callAssistantYearlyNote()}.`,
    },
    {
      q: "What counts as a minute?",
      a: `${callAssistantMinuteRule()} ${callAssistantOverageRule()}`,
    },
    {
      q: "Do spam calls use my minutes?",
      a: `${callAssistantSpamAllowanceLine().replace(/^./, (c) => c.toUpperCase())}. After that, a spam call's minutes count like any call. Calls from a blocked number are rejected before they're answered and never cost a minute. ${CALL_ASSISTANT_SPAM.report}`,
    },
    {
      q: "Which tier do I need?",
      a: callAssistantTierAdvice(),
    },
    {
      q: "What won't the assistant do?",
      a: "It won't quote prices unless you allow price ranges, book appointments (booking isn't available yet), make outbound calls, give out your team's phone numbers or pretend to be a person. It speaks English today.",
    },
  ];
  if (p.comingSoon) {
    list.push({
      q: "When can I buy it?",
      a: "It's coming soon: listed on Pricing, not for sale yet, and we don't have a launch date to share. Create your account now and add it in Settings → Billing once it's live.",
    });
  }
  return list;
}

/** The page's meta description in the browser (the server writes the same into the HTML; App.tsx sets the title). */
function useMetaDescription(description: string) {
  useEffect(() => {
    const tag = document.querySelector('meta[name="description"]');
    const previous = tag?.getAttribute("content");
    tag?.setAttribute("content", description);
    return () => { if (tag && previous != null) tag.setAttribute("content", previous); };
  }, [description]);
}

export default function CallAssistantLandingPage() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [salesOpen, setSalesOpen] = useState(false);
  const price = callAssistantPricing();
  const tierCountWord = price.tierCountWord;
  const TierCountWord = tierCountWord.replace(/^./, (c) => c.toUpperCase());
  /** "Crew and Fleet" — the tiers with the lower overage rate. */
  const lowerOverageTiers = joinNames(price.tiers.filter((t) => t.lowerOverage).map((t) => t.name));
  useMetaDescription(ROUTE_META[CALL_ASSISTANT_PATH].description);

  // Signed out: create an account. Signed in: the CRM, where the Call Assistant lives.
  const primaryCta = (where: string) => user
    ? <Link href="/crm-app" data-testid={`link-ca-open-crm-${where}`} className={`${BTN_PRIMARY} ${BTN_LG}`}>Open your CRM <ArrowRight className="h-4 w-4" /></Link>
    : <Link href={`/auth?mode=signup&next=${encodeURIComponent(CALL_ASSISTANT_PATH)}`} data-testid={`link-ca-signup-${where}`} className={`${BTN_PRIMARY} ${BTN_LG}`}>Create Your Account <ArrowRight className="h-4 w-4" /></Link>;
  const salesCta = (className: string, testId: string) => (
    <button type="button" onClick={() => setSalesOpen(true)} className={`${className} ${BTN_LG}`} data-testid={testId}>
      {SALES_REP_LABEL}
    </button>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next={CALL_ASSISTANT_PATH} />
      <div className="mkt-editorial flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-call-assistant">

        {/* Hero */}
        <section className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" aria-hidden />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
            <div className="lg:col-span-7 pt-10 sm:pt-14 lg:pt-20 pb-10 lg:pb-20">
              <div className="flex flex-wrap items-center gap-3">
                <Kicker n="New">AI Call Assistant</Kicker>
                <ComingSoonTag />
              </div>
              <h1 className="font-display mt-5 font-semibold text-[2.45rem] leading-[1.04] sm:text-[3.3rem] lg:text-[3.85rem] tracking-[-0.02em] text-mkt-ink" data-testid="text-ca-title">
                An AI Receptionist That Picks Up <span className="mkt-marker">Every&nbsp;Call</span>
              </h1>
              <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft max-w-[37rem] leading-relaxed" data-testid="text-ca-intro">
                Pick Janice, Gabe or one of four other voices, get a local number in your state and forward the lines you
                already have. Your assistant answers 24/7, asks your questions your way, screens the spam and files every
                real caller in your ConstructHUB CRM with a transcript and recording.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                {primaryCta("hero")}
                {salesCta(BTN_OUTLINE, "button-ca-sales-hero")}
              </div>
              <p className="mt-5 text-[15px] text-mkt-ink-soft" data-testid="text-ca-hero-price">
                Regular prices from <strong className="font-semibold text-mkt-ink">{price.from}/mo</strong> ({price.fromTier}).
                {" "}Solo: <strong className="font-semibold text-mkt-ink">{price.intro}/mo</strong> for your first {price.introMonths} months, then {price.regular}/mo — or {price.annual}/yr.
                {" "}{lowerOverageTiers} for busier phones, at a lower rate per extra minute.
                {" "}<a href="#pricing" className="font-semibold text-mkt-orange-ink underline decoration-2 decoration-mkt-orange-soft underline-offset-4 hover:decoration-mkt-orange">Compare the {tierCountWord} tiers</a>
              </p>
            </div>

            {/* The greeting, said by the headset gator, on the navy grid panel. */}
            <div className="pb-12 lg:pb-0 lg:col-span-5" aria-hidden>
              <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
                <div className="absolute inset-0 mkt-grid-paper-panel" />
                <div className="relative flex lg:flex-col items-center gap-4 lg:gap-6 p-5 sm:p-6 lg:px-8 lg:pt-10 lg:pb-0">
                  <p className="order-2 lg:order-1 flex-1 mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1">{GREETING}</p>
                  <GabeAvatar size={300} className="order-1 lg:order-2 shrink-0 !w-[96px] !h-[96px] sm:!w-[120px] sm:!h-[120px] lg:!w-[300px] lg:!h-[300px] lg:-mb-2" />
                </div>
              </div>
            </div>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </section>

        {/* Spam: the owner's lead promise (2026-10-02). Only what the code does: CALL_ASSISTANT_SPAM in shared/plan-copy.ts. */}
        <section id="spam" className="py-16 lg:py-20 px-4 sm:px-6 lg:px-8 scroll-mt-16" data-testid="section-ca-spam">
          <div className="max-w-7xl mx-auto relative overflow-hidden rounded-[28px] bg-mkt-panel text-mkt-panel-ink">
            <div className="mkt-hazard h-2.5" aria-hidden />
            <div className="absolute inset-0 top-2.5 mkt-grid-paper-panel [mask-image:linear-gradient(to_bottom,black_0%,transparent_95%)]" aria-hidden />
            <div className="relative grid lg:grid-cols-12 gap-8 lg:gap-12 p-7 sm:p-10 lg:p-14">
              <div className="lg:col-span-5">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
                  <ShieldBan className="h-4 w-4" aria-hidden /> Spam filter, built in
                </p>
                <h2 className="font-display font-semibold text-[1.85rem] sm:text-[2.6rem] lg:text-[3rem] leading-[1.05] tracking-[-0.02em] mt-4" data-testid="text-ca-spam-headline">
                  {CALL_ASSISTANT_SPAM.headline}
                </h2>
                <p className="mt-5 text-[16px] leading-relaxed opacity-85">{CALL_ASSISTANT_SPAM.lead}</p>
                <p className="mt-3 text-[14px] leading-relaxed opacity-75" data-testid="text-ca-spam-forwarding">{CALL_ASSISTANT_SPAM.forwarding}</p>
                <p className="mt-6 inline-flex flex-wrap items-baseline gap-x-2 rounded-xl border border-[color:color-mix(in_srgb,var(--mkt-panel-ink)_42%,transparent)] px-4 py-3" data-testid="text-ca-spam-free">
                  <span className="font-display font-semibold text-[1.9rem] leading-none">{price.freeSpamCalls}</span>{" "}
                  <span className="text-[14px] opacity-90">free spam calls every month, on every tier: they never count toward your minutes</span>
                </p>
              </div>
              <ol className="lg:col-span-7 grid gap-px bg-[color:color-mix(in_srgb,var(--mkt-panel-ink)_16%,transparent)] rounded-2xl overflow-hidden self-start">
                {([
                  { icon: ShieldBan, title: "Screened on every call", body: CALL_ASSISTANT_SPAM.screen },
                  { icon: Ban, title: CALL_ASSISTANT_SPAM_BLOCK_TITLE, body: CALL_ASSISTANT_SPAM.block },
                  { icon: FileBarChart, title: "Every one in your spam report", body: CALL_ASSISTANT_SPAM.report },
                ] as const).map((step, i) => (
                  <li key={step.title} className="bg-mkt-panel p-6 sm:p-7 flex gap-4" data-testid={`item-ca-spam-${i + 1}`}>
                    <span className="h-10 w-10 shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--mkt-panel-ink)_42%,transparent)] flex items-center justify-center">
                      <step.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display font-semibold text-[1.25rem] leading-tight">{step.title}</h3>
                      <p className="mt-1.5 text-[14.5px] leading-relaxed opacity-80">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-b border-mkt-rule scroll-mt-16" data-testid="section-ca-how">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl">
              <Kicker n="01">How It Works</Kicker>
              <h2 className={H2}>Live in Four <em className="text-mkt-orange-ink">Steps</em></h2>
            </div>
            <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
              {STEPS.map((step, i) => (
                <li key={step.title} className="bg-mkt-paper p-7 lg:p-8" data-testid={`step-ca-${i + 1}`}>
                  <span className="font-display italic text-[2.6rem] leading-none text-mkt-orange-ink">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-5 font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{step.title}</h3>
                  <p className="mt-2.5 text-[15px] text-mkt-ink-soft leading-relaxed">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The voices */}
        <section id="voices" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 scroll-mt-16" data-testid="section-ca-voices">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12">
              <div className="lg:col-span-7">
                <Kicker n="02">The Voices</Kicker>
                <h2 className={H2}>Women and Men Voices. <em className="text-mkt-orange-ink">You Pick Who Answers.</em></h2>
              </div>
              <p className={`lg:col-span-5 ${LEAD} lg:pb-1`}>
                Each one greets callers with your company's name, follows your script and tells callers it's a virtual
                assistant if they ask. Switch voices any time in the Agent Studio.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {VOICE_PERSONA_LIST.map((persona) => <PersonaCard key={persona.id} persona={persona} />)}
            </div>
          </div>
        </section>

        {/* What it does — the same six facts the landing page shows. */}
        <section className="pb-20 lg:pb-28 px-4 sm:px-6 lg:px-8" data-testid="section-ca-highlights">
          <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
            {CA_HIGHLIGHTS.map((item) => (
              <div key={item.title} className="group bg-mkt-paper p-7 transition-colors hover:bg-mkt-card">
                <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink mb-5 group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
                <h3 className="font-display font-semibold text-[1.2rem] leading-tight text-mkt-ink mb-2">{item.title}</h3>
                <p className="text-[14.5px] text-mkt-ink-soft leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Agent Studio */}
        <section id="agent-studio" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-y border-mkt-rule scroll-mt-16" data-testid="section-ca-studio">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12">
              <div className="lg:col-span-7">
                <Kicker n="03">Agent Studio</Kicker>
                <h2 className={H2}>Fine-Tune <em className="text-mkt-orange-ink">Every Question and Answer</em></h2>
              </div>
              <p className={`lg:col-span-5 ${LEAD} lg:pb-1`}>
                The advanced area where you decide exactly how your assistant runs a call: what it asks and in what order,
                how it answers, what it turns down and when it hands off to a person. No code.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
              {STUDIO.map((area, i) => (
                <div key={area.title} className="group bg-mkt-paper p-6 lg:p-7 transition-colors hover:bg-mkt-card" data-testid={`card-ca-studio-${i}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                      <area.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </div>
                    <span className="font-display italic text-mkt-muted text-lg leading-none">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <h3 className="font-display font-semibold text-[1.2rem] leading-tight text-mkt-ink mb-2">{area.title}</h3>
                  <p className="text-[14.5px] text-mkt-ink-soft leading-relaxed">{area.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Calls and the CRM */}
        <section id="calls" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 scroll-mt-16" data-testid="section-ca-calls">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-6">
              <Kicker n="04">Calls &amp; CRM</Kicker>
              <h2 className={H2}>Every Call Lands in <em className="text-mkt-orange-ink">Your CRM</em></h2>
              <p className={`mt-5 ${LEAD}`}>
                Read the lead before you call back. Every call is in the call log with what was said and what happened next.
              </p>
              <ul className="mt-8 border-t border-mkt-rule">
                {AFTER_CALL.map((line) => (
                  <li key={line} className="flex gap-3 py-4 border-b border-dotted border-mkt-rule text-[15px] text-mkt-ink leading-relaxed">
                    <CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-6 relative overflow-hidden rounded-2xl bg-mkt-panel text-mkt-panel-ink" data-testid="panel-ca-call-record">
              <div className="mkt-hazard h-2.5" aria-hidden />
              <div className="absolute inset-0 top-2.5 mkt-grid-paper-panel [mask-image:linear-gradient(to_bottom,black_0%,transparent_90%)]" aria-hidden />
              <div className="relative p-7 lg:p-9">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">The call log</p>
                <h3 className="mt-2 font-display font-semibold text-[1.7rem] leading-tight">What every call record holds</h3>
                <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                  {CALL_FIELDS.map((field, i) => (
                    <div key={field} className="flex items-baseline gap-3 py-3 border-b border-[color:color-mix(in_srgb,var(--mkt-panel-ink)_16%,transparent)]">
                      <dt className="font-display italic text-[15px] opacity-60 w-6 shrink-0">{String(i + 1).padStart(2, "0")}</dt>
                      <dd className="text-[15px] font-medium">{field}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-6 text-[14px] leading-relaxed opacity-80">
                  Play the recording right in the CRM. Recordings stay private to your workspace.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-y border-mkt-rule scroll-mt-16" data-testid="section-ca-pricing">
          <div className="max-w-6xl mx-auto">
            <div className="text-center">
              <Kicker n="05" className="justify-center">Pricing</Kicker>
              <h2 className={H2}>{TierCountWord} Tiers. <em className="text-mkt-orange-ink">Pick Your Call Volume.</em></h2>
            </div>
            <p className="mt-5 text-center text-[16px] text-mkt-ink-soft max-w-2xl mx-auto" data-testid="text-call-assistant-price">
              {TierCountWord} tiers, one per account, regular prices from {price.from}/mo. Solo starts at {introPriceShort()}.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5" data-testid="card-ca-pricing">
              {price.tiers.map((t) => (
                <div
                  key={t.tier}
                  className={`relative bg-mkt-card border rounded-2xl p-6 xl:p-7 flex flex-col ${t.intro ? "border-mkt-ink" : "border-mkt-rule"}`}
                  data-testid={`card-ca-tier-${t.tier}`}
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="font-display font-semibold text-[1.5rem] text-mkt-ink">{t.name}</h3>
                    <ComingSoonTag />
                  </div>
                  <div className="mt-4 font-display font-semibold text-[2.6rem] leading-none text-mkt-ink" data-testid={`text-ca-tier-price-${t.tier}`}>
                    {t.intro ?? t.monthly}<span className="font-sans text-base font-medium text-mkt-muted ml-1">/mo</span>
                  </div>
                  <p className="mt-2 text-[14px] text-mkt-ink-soft min-h-[2.6em]" data-testid={`text-ca-tier-terms-${t.tier}`}>
                    {t.intro ? `for your first ${t.introMonths} months, then ${t.monthly}/mo — or ${t.annual}/yr` : `or ${t.annual}/yr`}
                  </p>
                  <ul className="mt-5 pt-5 border-t border-mkt-rule space-y-2.5 text-[15px] text-mkt-ink">
                    <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> {t.minutes} call minutes a month</li>
                    <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> {t.numbersLabel} in the state you choose</li>
                    <li className="flex gap-3 text-mkt-ink-soft"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Fits {t.estimatedCalls} (estimate)</li>
                    <li className="flex gap-3" data-testid={`text-ca-tier-overage-${t.tier}`}>
                      <CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" />
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {t.overageShort}/min over
                        {t.lowerOverage && (
                          <span className="inline-flex items-center rounded-full bg-mkt-orange px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white" data-testid={`badge-ca-tier-lower-overage-${t.tier}`}>
                            Lower overage
                          </span>
                        )}
                      </span>
                    </li>
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-5 bg-mkt-card border border-mkt-rule rounded-2xl p-7 grid md:grid-cols-12 gap-6" data-testid="card-ca-every-tier">
              <div className="md:col-span-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">On every tier</p>
                <ul className="mt-4 space-y-3 text-[15px] text-mkt-ink">
                  <li className="flex gap-3"><ShieldBan className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> <span><strong className="font-semibold">The first {price.freeSpamCalls} spam calls each month free</strong>: they never count toward your minutes</span></li>
                  <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Above your included minutes: {price.overageLine}</li>
                  <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Extra local numbers {price.extraNumber}/mo each</li>
                </ul>
              </div>
              <div className="md:col-span-7">
                <ul className="space-y-3 text-[15px] text-mkt-ink">
                  <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Every voice, the Agent Studio, the Simulator and the call log</li>
                  <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Forward as many of your existing numbers as you like</li>
                  <li className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> Move between tiers any time; the difference is prorated</li>
                </ul>
                <p className="mt-6 pt-5 border-t border-mkt-rule text-[14px] text-mkt-ink-soft leading-relaxed" data-testid="text-ca-plans">
                  An add-on for the{" "}
                  {price.planKeys.map((key, i) => (
                    <span key={key}>
                      {i > 0 && (i === price.planKeys.length - 1 ? " and " : ", ")}
                      <strong className="font-semibold text-mkt-ink">{PLANS[key].name}</strong> ({formatUsd(PLANS[key].monthlyCents)}/mo)
                    </span>
                  ))}{" "}
                  plans, not a plan of its own.{" "}
                  <Link href="/pricing#add-ons" className="font-semibold text-mkt-orange-ink underline decoration-2 decoration-mkt-orange-soft underline-offset-4 hover:decoration-mkt-orange" data-testid="link-ca-pricing">
                    Compare plans and add-ons
                  </Link>
                </p>
              </div>
            </div>
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              {primaryCta("pricing")}
              {salesCta(BTN_OUTLINE, "button-ca-sales-pricing")}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 scroll-mt-16" data-testid="section-ca-faq">
          <div className="max-w-3xl mx-auto">
            <Kicker n="06">Questions</Kicker>
            <h2 className={H2}>Before You <em className="text-mkt-orange-ink">Switch It On</em></h2>
            <div className="mt-10 border-t border-mkt-rule">
              {faqs().map((item, i) => (
                <details key={item.q} className="group border-b border-mkt-rule" data-testid={`faq-ca-${i}`}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display font-semibold text-[1.15rem] sm:text-[1.25rem] leading-snug text-mkt-ink [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange rounded-sm">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-mkt-orange-ink transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pb-6 -mt-1 text-[15.5px] text-mkt-ink-soft leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* In depth: the long-form explanation (IN_DEPTH), as on every feature page */}
        <section id="in-depth" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-t border-mkt-rule scroll-mt-16" data-testid="section-ca-in-depth">
          <div className="max-w-3xl mx-auto">
            <Kicker n="07">In Depth</Kicker>
            <h2 className={H2}>An AI Answering Service for <em className="text-mkt-orange-ink">Contractors</em></h2>
            <div className="mt-8 space-y-5 text-[16.5px] text-mkt-ink-soft leading-[1.75] [&>p]:max-w-[35rem]" data-testid="text-ca-in-depth">
              {IN_DEPTH.map((para) => <p key={para}>{para}</p>)}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative bg-mkt-navy text-mkt-navy-ink py-20 lg:py-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-70 dark:opacity-40" aria-hidden />
          <div className="relative max-w-3xl mx-auto text-center">
            <GabeAvatar size={96} className="mx-auto mb-7 rounded-full" />
            <h2 className="font-display font-semibold text-[2.3rem] sm:text-[2.9rem] lg:text-[3.3rem] leading-[1.05] tracking-[-0.02em]">
              Let Every Call Be Answered
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-mkt-navy-muted max-w-xl mx-auto">
              Regular prices from {price.from}/mo with {price.fromTier}. Solo from {introPriceShort()}; {lowerOverageTiers} for busier phones. Spam screened on every call. An add-on for the {price.plans} plans, with every call in your CRM.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              {primaryCta("cta")}
              {salesCta(BTN_OUTLINE_ON_NAVY, "button-ca-sales-cta")}
            </div>
          </div>
        </section>
      </div>
      <PublicPageFooter />
      <TalkToSalesDialog open={salesOpen} onOpenChange={setSalesOpen} topic="AI Call Assistant" />
    </div>
  );
}
