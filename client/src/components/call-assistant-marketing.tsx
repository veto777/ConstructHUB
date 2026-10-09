/**
 * The AI Call Assistant on the marketing site, in the landing page's
 * "editorial" language (design B: Fraunces + Plus Jakarta Sans on cream paper,
 * navy grid panels, one orange — the `mkt-editorial` scope in index.css).
 *
 * Shared by the landing page's Call Assistant section and the dedicated
 * /call-assistant page (pages/call-assistant-landing.tsx):
 *   - CallAssistantSection — the landing page section
 *   - PersonaCard / PersonaGrid — the six voices, with an optional sample
 *   - CA_HIGHLIGHTS — what the product does, in one list
 *   - Kicker + button recipes, matching landing.tsx
 *
 * Honest copy only: the product is launching, so there are no call counts,
 * customers or testimonials here. Every price comes from the price book
 * through shared/plan-copy.ts (callAssistantPricing), and "Coming soon" shows
 * for as long as the service is `preview` in shared/plans.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, MapPin, PhoneForwarded, SlidersHorizontal, Inbox, ShieldBan, Clock3, Play, Pause,
  type LucideIcon,
} from "lucide-react";
import { VOICE_PERSONAS, VOICE_PERSONA_LIST, type VoicePersona } from "@shared/voice-personas";
import { callAssistantPricing, callAssistantSpamAllowanceLine } from "@shared/plan-copy";
// The editorial primitives (buttons, panel hairlines, the section kicker) live
// in feature-landing/primitives.tsx, shared with every /features page.
import { BTN_LG, BTN_PRIMARY, Kicker, PANEL_RULE, PANEL_RULE_STRONG } from "@/components/feature-landing/primitives";
export { BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, Kicker } from "@/components/feature-landing/primitives";

export const CALL_ASSISTANT_PATH = "/call-assistant";

/** The headline facts, in one list (landing section and the dedicated page). */
export const CA_HIGHLIGHTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MapPin,
    title: "A local number in your state",
    body: "Pick a state, and an area code or city if you like, then choose from the local numbers available there. We buy it and connect it for you.",
  },
  {
    icon: PhoneForwarded,
    title: "Forward the lines you already have",
    body: "Keep every number you own. Forward your office line, cell or tracking numbers to the assistant when you don't answer, after hours, or always.",
  },
  {
    icon: SlidersHorizontal,
    title: "Agent Studio tunes every question and answer",
    body: "Decide what it asks and in what order, how it answers common questions, which jobs it turns down and who gets the urgent calls.",
  },
  {
    icon: Inbox,
    title: "Every call lands in your CRM",
    body: "Real leads become clients in your ConstructHUB CRM, and every call is logged with a summary, the full transcript and the recording.",
  },
  {
    icon: ShieldBan,
    title: "You never answer spam again",
    body: `Telemarketers and robocalls forwarded to your assistant are screened and never ping your phone. A number caught twice as near-certain spam is blocked before it's answered, and every one lands in your spam report. ${callAssistantSpamAllowanceLine().replace(/^./, (c) => c.toUpperCase())}.`,
  },
  {
    icon: Clock3,
    title: "Answers 24/7",
    body: "Nights, weekends and while you're up a ladder. Emergencies and \"I want a person\" are texted or emailed to the teammate you pick.",
  },
];

// ── Persona samples ─────────────────────────────────────────────────────────

/**
 * A persona's pre-rendered sample, or null. shared/voice-personas.ts sets
 * `sampleUrl` once the engine lane has rendered and published the file
 * (docs/call-assistant/SPEC.md §15); until then there is no button and no
 * request. Note for whoever sets it: everything under /voice/* is proxied to
 * the engine (server/voice/proxy.ts), so a file in client/public/voice/ is
 * never served at /voice/... unless the proxy lets that path through.
 */
export const sampleSrc = (persona: VoicePersona): string | null => persona.sampleUrl ?? null;

/**
 * One HEAD probe per sample, shared by every card: the play button shows only
 * when the file is really there and really audio (a missing file can come back
 * as a 404, the SPA's HTML or a JSON error, all with a non-audio type).
 */
const probes = new Map<string, Promise<boolean>>();
function probeAudio(src: string): Promise<boolean> {
  let probe = probes.get(src);
  if (!probe) {
    probe = fetch(src, { method: "HEAD", credentials: "omit" })
      .then((r) => r.ok && /^audio\//i.test(r.headers.get("content-type") ?? ""))
      .catch(() => false);
    probes.set(src, probe);
  }
  return probe;
}

function useSampleAvailable(src: string | null): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!src) return;
    let live = true;
    probeAudio(src).then((v) => { if (live) setOk(v); });
    return () => { live = false; };
  }, [src]);
  return ok;
}

/** Only one sample plays at a time: starting one pauses the others. */
const PLAY_EVENT = "ch-call-assistant-sample";

function SampleButton({ persona, onNavy }: { persona: VoicePersona; onNavy: boolean }) {
  const src = sampleSrc(persona);
  const available = useSampleAvailable(src);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== persona.id && audio.current) audio.current.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => {
      window.removeEventListener(PLAY_EVENT, onOther);
      audio.current?.pause();
    };
  }, [persona.id]);

  if (!available || !src) return null;

  const toggle = () => {
    if (!audio.current) {
      const a = new Audio(src);
      a.addEventListener("play", () => setPlaying(true));
      a.addEventListener("pause", () => setPlaying(false));
      a.addEventListener("ended", () => setPlaying(false));
      a.addEventListener("error", () => setPlaying(false));
      audio.current = a;
    }
    if (audio.current.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: persona.id }));
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => setPlaying(false));
    } else {
      audio.current.pause();
    }
  };

  const tone = onNavy
    ? `${PANEL_RULE_STRONG} text-mkt-panel-ink hover:bg-mkt-panel-ink hover:text-mkt-panel`
    : "border-mkt-ink text-mkt-ink hover:bg-mkt-ink hover:text-mkt-paper";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange ${tone}`}
      aria-label={`${playing ? "Stop" : "Play"} ${persona.name}'s voice sample`}
      aria-pressed={playing}
      data-testid={`button-persona-sample-${persona.id}`}
    >
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {playing ? "Stop" : "Hear"} {persona.name}
    </button>
  );
}

const voiceLabel = (persona: VoicePersona) => (persona.gender === "female" ? "Woman's voice" : "Man's voice");

/** One persona: a monogram, the name, woman's/man's voice, the blurb and (when the file exists) a sample. */
export function PersonaCard({ persona, onNavy = false }: { persona: VoicePersona; onNavy?: boolean }) {
  return (
    <div
      className={onNavy
        ? `p-5 border-t ${PANEL_RULE}`
        : "bg-mkt-card border border-mkt-rule rounded-2xl p-6 hover:border-mkt-ink transition-colors"}
      data-testid={`card-persona-${persona.id}`}
    >
      {/* On the panel's narrow phone columns the monogram sits above the name, so "Woman's voice" stays on one line. */}
      <div className={onNavy ? "flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-3.5" : "flex items-center gap-3.5"}>
        <span
          className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center font-display italic text-[1.35rem] leading-none ${onNavy ? `border ${PANEL_RULE_STRONG}` : "border border-mkt-rule bg-mkt-paper"}`}
          aria-hidden
        >
          {persona.name[0]}
        </span>
        <div className="min-w-0">
          <p className={`font-display font-semibold text-[1.25rem] leading-tight ${onNavy ? "" : "text-mkt-ink"}`}>{persona.name}</p>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${onNavy ? "opacity-70" : "text-mkt-muted"}`}>{voiceLabel(persona)}</p>
        </div>
      </div>
      <p className={`mt-3 text-[14px] leading-relaxed ${onNavy ? "opacity-80" : "text-mkt-ink-soft"}`}>{persona.blurb}</p>
      <SampleButton persona={persona} onNavy={onNavy} />
    </div>
  );
}

/** "Janice, Sofia and Maya" — the women's (or men's) names, in list order. */
export function personaNames(gender: VoicePersona["gender"]): string {
  const names = VOICE_PERSONA_LIST.filter((p) => p.gender === gender).map((p) => p.name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Coming soon" while the service is `preview` in the price book; nothing once it's for sale. */
export function ComingSoonTag({ onNavy = false, className = "" }: { onNavy?: boolean; className?: string }) {
  if (!callAssistantPricing().comingSoon) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${onNavy ? PANEL_RULE_STRONG : "border-mkt-orange text-mkt-orange-ink"} ${className}`}
      data-testid="badge-call-assistant-coming-soon"
    >
      Coming soon
    </span>
  );
}

/**
 * The landing page's Call Assistant section: the voices on a navy grid panel,
 * the highlights in a hairline grid, the price and a way in to
 * /call-assistant.
 */
export function CallAssistantSection() {
  const price = callAssistantPricing();
  return (
    <section id="call-assistant" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 border-t border-mkt-rule scroll-mt-16" data-testid="section-call-assistant">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12 lg:mb-14">
          <div className="lg:col-span-7">
            <Kicker n="New">AI Call Assistant</Kicker>
            <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5">
              Every Call Answered. <em className="text-mkt-orange-ink">Every Lead in Your CRM.</em>
            </h2>
          </div>
          <p className="lg:col-span-5 text-[17px] text-mkt-ink-soft leading-relaxed lg:pb-1">
            A missed call is a job that goes to the next contractor on the list. Pick who answers, get a local number
            in your state and forward the lines you already have. The assistant asks your questions your way, files
            every real caller in your CRM and screens out the spam, so you never answer a robocall again.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-5 lg:gap-6">
          {/* The voices, on the navy grid panel. */}
          <div className="lg:col-span-5 relative overflow-hidden rounded-2xl bg-mkt-panel text-mkt-panel-ink flex flex-col" data-testid="panel-call-assistant-voices">
            <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:linear-gradient(to_bottom,black_0%,transparent_85%)]" aria-hidden />
            <div className="relative flex-1 flex flex-col">
              <div className="px-5 pt-6 pb-5 sm:px-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">Pick who answers</p>
                <p className="mt-2 font-display font-semibold text-[1.6rem] leading-tight">Women and men voices</p>
                <p className="mt-2 text-[14px] leading-relaxed opacity-80">
                  {personaNames("female")}, or {personaNames("male")}. Each says your company's name the way you set it.
                </p>
              </div>
              {/* Rows share any spare height when the highlights beside the panel run taller. */}
              <div className="grid grid-cols-2 lg:auto-rows-fr flex-1">
                {VOICE_PERSONA_LIST.map((persona, i) => (
                  <div key={persona.id} className={i % 2 === 1 ? `border-l ${PANEL_RULE}` : ""}>
                    <PersonaCard persona={persona} onNavy />
                  </div>
                ))}
              </div>
              {/* What a caller hears first: the default greeting (shared/voice-personas.ts), company left blank. */}
              <div className={`px-5 py-5 sm:px-6 border-t ${PANEL_RULE}`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">What callers hear</p>
                <p className="mt-2 font-display italic text-[1.05rem] leading-snug" data-testid="text-call-assistant-greeting">
                  &ldquo;{VOICE_PERSONAS.janice.sampleLine.replace("your company", "[Your Company]")}&rdquo;
                </p>
              </div>
            </div>
          </div>

          {/* What it does, in the services grid's hairline style. */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
            {CA_HIGHLIGHTS.map((item, i) => (
              <div key={item.title} className="group bg-mkt-paper p-6 lg:p-7 transition-colors hover:bg-mkt-card" data-testid={`card-call-assistant-highlight-${i}`}>
                <div className="flex items-start justify-between mb-5">
                  <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                    <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <span className="font-display italic text-mkt-muted text-lg leading-none">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-semibold text-[1.2rem] leading-tight text-mkt-ink mb-2">{item.title}</h3>
                <p className="text-[14.5px] text-mkt-ink-soft leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* The price and the way in. */}
        <div className="mt-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 rounded-2xl border border-mkt-rule bg-mkt-paper-2 p-6 lg:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display font-semibold text-[1.5rem] sm:text-[1.75rem] leading-tight text-mkt-ink" data-testid="text-call-assistant-landing-price">
                <span className="font-sans text-[15px] font-medium text-mkt-ink-soft">From </span>{price.from}<span className="font-sans text-sm font-medium text-mkt-muted">/mo</span>{" "}
                <span className="block sm:inline font-sans text-[15px] font-medium text-mkt-ink-soft">({price.fromTier}) — or yearly with {price.annualFreeMonths === 1 ? "one month" : `${price.annualFreeMonths} months`} free</span>
              </p>
              <ComingSoonTag />
            </div>
            <p className="mt-1.5 text-[14px] text-mkt-ink-soft" data-testid="text-call-assistant-landing-tiers">
              {price.tiers.map((t, i) => (
                <span key={t.tier}>{i > 0 ? (i === price.tiers.length - 1 ? " and " : ", ") : `${price.tierCountWord.replace(/^./, (c) => c.toUpperCase())} tiers: `}<strong className="font-semibold text-mkt-ink">{t.name}</strong> ({t.monthly}/mo, {t.numbersLabel})</span>
              ))}
              . Above the included minutes, {price.overageLine}. The first {price.freeSpamCalls} spam calls each month are free on every tier. A separate service with its own subscription: no ConstructHUB plan needed.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <Link href={CALL_ASSISTANT_PATH} data-testid="link-call-assistant-learn-more" className={`${BTN_PRIMARY} ${BTN_LG}`}>
              See How It Works <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
