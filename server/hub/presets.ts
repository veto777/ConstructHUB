/**
 * Preset answers for the quick-question chips (guardrails §5 "Preset cache").
 *
 * Signed-out visitors can only tap presets, and a tap never calls the model:
 * it is served from hub_preset_answers (keyed by preset id + knowledge hash) or,
 * on a miss, from a template answer built here from the price book. Model
 * answers are generated in the background (single-flight per key, at most 3
 * attempts per preset per hour) and stored only when they pass the full
 * output filter AND the required-facts check. Cached answers are filtered
 * again every time they are served.
 */
import { AGENCY_SELF_SERVE_MAX_LOCATIONS, ANNUAL_MONTHS, PLANS, PLAN_KEYS } from "@shared/plans";
import {
  planPriceLine, agencyBandsLine, joinNames, planNamesWhere, AGENCY_ONLY_MODULES, CRM_SEATS_LINE,
  PROTECTED_SITE_PLANS, SALES_HREF, SALES_REP_LABEL, TRIAL_LABEL,
  CALL_ASSISTANT_PLANS, CALL_ASSISTANT_NUMBER_RULES, callAssistantAvailabilityLine, callAssistantIncludesLine, callAssistantIntroLine, callAssistantPricing,
  callAssistantTierNumbersLine, callAssistantTiersShortLine,
} from "@shared/plan-copy";
import { HUB_PRESETS, PRESET_IDS, type PresetId } from "@shared/hub-presets";
import { VOICE_PERSONA_LIST } from "@shared/voice-personas";

export interface PresetStore {
  get(presetId: PresetId, hash: string): Promise<string | null>;
  put(presetId: PresetId, hash: string, answer: string): Promise<void>;
}

/** "Janice, Gabe, Sofia, Maya, Marcus or Ethan". */
const PERSONA_NAMES = VOICE_PERSONA_LIST.map((p) => p.name).join(", ").replace(/, ([^,]+)$/, " or $1");

const planLines = () => PLAN_KEYS.map((k) => `- **${PLANS[k].name}**: ${planPriceLine(k)}. ${PLANS[k].tagline}`).join("\n");

/** Template answers: deterministic, from the price book and the knowledge pack's own wording. */
export function templateAnswer(presetId: PresetId): string {
  switch (presetId) {
    case "pricing":
      return `There is no free plan. A first-time subscriber starts with a ${TRIAL_LABEL}, and yearly billing costs ${ANNUAL_MONTHS} times the monthly price.\n${planLines()}\nAdd-ons raise single limits. Compare everything on [Pricing](/pricing).`;
    case "which-plan":
      return `It depends on how many profiles, websites and people you have:\n${planLines()}\nSee them side by side on [Pricing](/pricing#comparison).`;
    case "trial":
      return `There is no free plan. Creating an account is free and needs no card. A first-time subscriber starts with a ${TRIAL_LABEL} (one trial per customer): you enter your card at Stripe's secure checkout, and it is charged when the trial ends. See [Pricing](/pricing).`;
    case "features":
      return "ConstructHUB is one platform for construction contractors and the agencies that market them. One account and one plan cover:\n- **Growth tools**: permit offices and permit search, property records, Google Business Profile tools, Site Scan, Social Media and ad-traffic protection.\n- **The ConstructHub CRM**: clients, estimates with e-signature, invoices, online payments into your own Stripe account, pipeline, schedule and team roles.\n- **A client portal** for every client you add to the CRM.\n- **Education**: free guides and the paid Master Class.\n- **Services**: done-for-you work, quoted by a sales rep.\nSee [Pricing](/pricing) for what each plan includes.";
    case "get-started":
      return `1. Create your account with your name, email and a password, or sign up with Google.\n2. Open the verification email and click the link.\n3. On [Pricing](/pricing), pick a plan and monthly or yearly billing, then enter your card at Stripe's secure checkout. A first-time subscriber starts with a ${TRIAL_LABEL}.\n4. Connect your Google Business Profile under **Locations**, turn on **Profile Guard**, and open the **ConstructHub CRM** to set up your company, price book and team.\n[Create an account](/auth) to begin.`;
    case "crm":
      return `The **ConstructHub CRM** is included with every plan. It covers clients, estimates with e-signature, invoices, online payments straight into your own Stripe account, a price book, a pipeline, projects, a schedule, team roles and client messaging. Every client you add gets a private portal to read estimates, sign, pay and message you. CRM seats per plan: ${CRM_SEATS_LINE}. The Extra seat add-on adds more. See [ConstructHub CRM](/crm-app).`;
    case "agency":
      return `The **Agency** plan is ${planPriceLine("agency")} and includes ${PLANS.agency.limits.locations} client locations.\nAbove that: ${agencyBandsLine()}.\nOnly Agency includes the ${joinNames(AGENCY_ONLY_MODULES)}, plus team roles with ${PLANS.agency.limits.crmSeats} seats shared with the CRM team. See [Pricing](/pricing#agency).`;
    case "done-for-you":
      return `Yes. For contractors who'd rather have the work done for them, there is business formation and contractor license help, a Google Business Profile and contractor website, SEO and ad campaigns, monthly SEO packages, and the Complete Business Build. Every one of these is quoted by a sales rep, so there is no price here. Open [${SALES_REP_LABEL}](${SALES_HREF}), fill in your name, email and what you need, and a rep replies by email.`;
    case "permits":
      return "The [Database Directory](/databases) lists county and city permit offices in all 50 states and DC. An official portal link is shown only when one is on record and has been checked; otherwise you get a **Find permit portal** search instead of a guessed link. **Search Permits** searches permit records live on the government portals that support it, by address, keyword, name, company name, license number or permit number. **Property Records** finds the official county appraiser or assessor office. The Directory and Property Records are free to browse; permit searches come with every plan.";
    case "google-profile":
      return "Link your listing under **Locations** to sync its reviews, photos, services and Google performance numbers. **Profile Guard** watches the listing for changes to the fields you choose and alerts you, or puts your approved values back in Lockdown mode. **Google Reviews** sends review requests and lets you reply to reviews, with AI reply drafts on every plan. **Posts & Photos** schedules updates and photos to the listing, and the **GMB Ranking Grid** shows where you rank in Google Maps for a keyword. Nobody can block edits at Google, and no ranking is guaranteed.";
    case "reviews":
      return `**Review Requests** emails your clients a request from your company with a button to leave a Google review, with optional follow-up reminders and tracking of opens and clicks. Ask every client, not only happy ones, and never offer anything in return for a review. **Google Profile Reviews** shows your synced Google reviews so you can publish replies to Google. **AI review replies** draft replies for you to approve on every plan; publishing them automatically is included with ${planNamesWhere((p) => p.limits.autoPublishAiReplies)}.`;
    case "click-fraud":
      return `**Click Guard** puts a small tracking script on the pages your ads send people to, flags unusual traffic such as bot-like browsers and repeated visits from one IP, and adds repeat offenders to **Blocked IPs**. A script you paste into your own Google Ads account then adds those IPs as exclusions on your active campaigns. It is included with ${PROTECTED_SITE_PLANS}, along with **IP Tracker** and **VPN Shield**. These signals don't prove fraud, and no savings are guaranteed.`;
    case "site-scan":
      return "The **free 60-second website scan** needs no account: enter a website and email to see scores and up to five findings, then verify your email to unlock the quick-scan report of up to 11 pages. The full **Site Scan**, included with every plan, checks technical and content issues, Google PageSpeed performance, how your site matches your Google Business Profile and AI search readiness, then lists what to fix in priority order. [Try the free scan](/free-site-scan).";
    case "master-class":
      return `The **Master Class** is a step-by-step course on starting and growing a construction business, with 50 state-by-state guides and checklists. Its four modules are Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, and SEO & Directory Domination. The overview is free to read, and any Master Class purchase also unlocks the full Google Ads Guide. It is not included in any plan; modules are quoted by a sales rep: [${SALES_REP_LABEL}](${SALES_HREF}).`;
    case "call-assistant":
      return `The **AI Call Assistant** is an AI receptionist for your business line. It answers every call on a local number, day or night, in a woman's or man's voice you pick (${PERSONA_NAMES}). It asks the questions you set in the **Agent Studio**, files each real lead in the ConstructHub CRM with a summary, transcript and recording, texts or emails the teammate you choose for emergencies, and screens out spam: forward your line 'always' and you never answer a spam call again.\n${callAssistantPricing().tierCountWord.replace(/^./, (c) => c.toUpperCase())} tiers: ${callAssistantTiersShortLine()}. Solo's launch price: ${callAssistantIntroLine()}. Then ${callAssistantIncludesLine()}. It is an add-on to the ${CALL_ASSISTANT_PLANS} plans. ${callAssistantAvailabilityLine()} See [AI Call Assistant](/call-assistant).`;
    case "call-number":
      return `1. The **AI Call Assistant** is an add-on to the ${CALL_ASSISTANT_PLANS} plans. ${callAssistantAvailabilityLine()}\n2. In the CRM, open **Call Assistant** → **Numbers**, pick a state (and an area code or city if you like) and choose a local number. ConstructHUB buys it for you. ${callAssistantTierNumbersLine()}; extra numbers are ${callAssistantPricing().extraNumber}/month each.\n3. Keep your existing numbers: forward them to the new number from your phone carrier, only when you don't answer, after hours or always. Nothing is ported, and the Numbers tab shows how for common carriers.\n4. ${CALL_ASSISTANT_NUMBER_RULES.cancel} ${CALL_ASSISTANT_NUMBER_RULES.payment}\nSee [AI Call Assistant](/call-assistant).`;
  }
}

const COMING_SOON = /\bcoming soon\b|\bnot (yet )?for sale\b/i;

/** A model answer is cached only if it states these facts exactly (on top of passing the output filter). */
export function requiredFactsOk(presetId: PresetId, answer: string): boolean {
  switch (presetId) {
    case "pricing":
    case "which-plan":
      return PLAN_KEYS.every((k) => answer.includes(PLANS[k].name) && answer.includes(planPriceLine(k)));
    case "trial":
      return answer.includes(TRIAL_LABEL) && /\bno free plan\b/i.test(answer);
    case "done-for-you":
      return answer.includes(SALES_REP_LABEL) && answer.includes(SALES_HREF);
    case "agency":
      return /\bAgency\b/.test(answer) && new RegExp(`\\b${PLANS.agency.limits.locations}\\b`).test(answer) && new RegExp(`\\b${AGENCY_SELF_SERVE_MAX_LOCATIONS}\\b`).test(answer) && /sales rep/i.test(answer);
    case "call-assistant": {
      // The launch price as the pack words it, and "coming soon" while the price book says so.
      const p = callAssistantPricing();
      return answer.includes(`${p.intro}/month`) && answer.includes(p.regular) && answer.includes(p.annual) && (!p.comingSoon || COMING_SOON.test(answer));
    }
    case "call-number":
      return /\bstate\b/i.test(answer) && /\bforward/i.test(answer) && (!callAssistantPricing().comingSoon || COMING_SOON.test(answer));
    case "click-fraud":
      // The pack's honest limits, and the step people miss: the exclusions come from a script the user pastes into Google Ads.
      return /\b(don'?t|do not|doesn'?t|does not|can'?t|cannot) prove fraud\b|\bno savings (are|is) guaranteed\b/i.test(answer)
        && /\bscript\b/i.test(answer) && /\b(paste|add|install)\w*\b[^.]{0,80}\bGoogle Ads\b|\bGoogle Ads\b[^.]{0,80}\b(paste|add|install)\w*\b/i.test(answer);
    default:
      return true;
  }
}

export const presetList = () => PRESET_IDS.map((id) => ({ id, label: HUB_PRESETS[id].label }));
