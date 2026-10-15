/**
 * Drafts the media inbox's replies and reads where each relationship stands. Owner rule (2026-10-14): "always use our
 * API first then OpenAI or Anthropic as a fallback". Each provider is tried in order until one gives a usable answer:
 *   1. TruthCoder, the platform's AI   AI_INTEGRATIONS_OPENAI_BASE_URL + _API_KEY, model AI_MODEL (server/ai-config.ts)
 *   2. TruthCoder 2.0                  TRUTHCODER_API_KEY, model TRUTHCODER_MODEL (default truthcoder:2.0), same server
 *                                      unless TRUTHCODER_BASE_URL
 *   3. OpenAI                          HUB_OPENAI_API_KEY, MEDIA_OPENAI_MODEL (default gpt-5.4-mini)
 *   4. Anthropic                       ANTHROPIC_API_KEY, MEDIA_ANTHROPIC_MODEL (default claude-haiku-5-5)
 * A provider without a key is skipped. The prompt asks for good manners; the money / meeting / contract rules are
 * enforced again in ./guard.ts whichever model answered.
 */
import { aiModel } from "../ai-config";
import { MEDIA_INBOX_LAWS, MEDIA_INBOX_PARAMETERS, MEDIA_PARTNER_KINDS, MEDIA_PARTNER_STATUSES, type MediaPartnerKind, type MediaPartnerStatus } from "@shared/media-inbox";

export const MEDIA_OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";
export const MEDIA_ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";
export type MediaAiProvider = { name: string; style: "openai" | "anthropic"; url: string; key: string; model: string };

const trimUrl = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

/** The providers to try, in order (keyless ones left out). */
export function mediaAiProviders(env: NodeJS.ProcessEnv = process.env): MediaAiProvider[] {
  const tcBase = trimUrl(env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  const all: MediaAiProvider[] = [
    { name: "TruthCoder", style: "openai", url: `${tcBase}/chat/completions`, key: env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() && tcBase ? env.AI_INTEGRATIONS_OPENAI_API_KEY.trim() : "", model: aiModel(env.AI_MODEL) },
    { name: "TruthCoder 2.0", style: "openai", url: `${trimUrl(env.TRUTHCODER_BASE_URL) || tcBase}/chat/completions`, key: (trimUrl(env.TRUTHCODER_BASE_URL) || tcBase) ? env.TRUTHCODER_API_KEY?.trim() ?? "" : "", model: env.TRUTHCODER_MODEL?.trim() || "truthcoder:2.0" },
    { name: "OpenAI", style: "openai", url: "https://api.openai.com/v1/chat/completions", key: env.HUB_OPENAI_API_KEY?.trim() ?? "", model: env.MEDIA_OPENAI_MODEL?.trim() || MEDIA_OPENAI_DEFAULT_MODEL },
    { name: "Anthropic", style: "anthropic", url: "https://api.anthropic.com/v1/messages", key: env.ANTHROPIC_API_KEY?.trim() ?? "", model: env.MEDIA_ANTHROPIC_MODEL?.trim() || MEDIA_ANTHROPIC_DEFAULT_MODEL },
  ];
  return all.filter((p) => p.key);
}
export const mediaAiConfigured = (env: NodeJS.ProcessEnv = process.env) => mediaAiProviders(env).length > 0;

export const FACTS = `ConstructHUB (constructhub.us) is software for US contractors: roofers, HVAC, plumbers, electricians, remodelers.
It includes Google Business Profile tools, a CRM, permit data, SEO tools, and Directory Sync, which keeps a contractor's
business listing (name, address or service area, phone, hours, categories, description, photos) accurate across directories.
We are building direct relationships with directories, article and guest-post sites, news media and link publishers so our
contractors can be listed and featured. We expect to start with 50–200 contractor locations and grow from there.
How we pay partners: only per listing or per placement, and only after one of our customers has purchased it on our
platform. No upfront fees, platform minimums, setup fees or prepayment.`;

const SYSTEM = `You answer email for the ConstructHUB Media Team (media@constructhub.us). Its only purpose is building relationships
with directories, article sites, news media and link publishers (PBNs).

Facts you may use (never invent anything else — no customer counts, revenue, prices, names, dates or features):
${FACTS}

LAWS — follow every one, every time (the code checks your reply against them and replaces a reply that breaks one):
${MEDIA_INBOX_LAWS.map((l, i) => `${i + 1}. ${l.law}`).join("\n")}

PARAMETERS:
- Reply in under ${MEDIA_INBOX_PARAMETERS.maxReplyWords} words. Sign off "Best regards," with nothing after it (the team signature is added).
- needs_owner = true whenever the email involves money, fees, a meeting, a contract or terms, a legal question or access to data;
  then thank them, say the team will review and follow up, and put the decision in owner_question.
- relevant = false for spam, scams, phishing or anything unrelated to the purpose above.

Also judge the relationship from the whole thread:
- company: their company or site name; kind: one of ${MEDIA_PARTNER_KINDS.join(", ")};
- stage: "talking", "agreed" (they accepted a concrete arrangement — e.g. free API access, listing our customers, publishing our articles —
  even if steps remain), or "declined";
- agreement: one sentence on what was agreed (null if nothing); to_finalize: what is still needed to finalize (null if nothing);
- cost_terms: any money they mentioned, quoted exactly (null if none); owner_question: the decision the owner must make (null if none).

Return JSON only:
{"reply": string, "relevant": boolean, "needs_owner": boolean, "owner_question": string|null, "company": string|null,
 "kind": string, "stage": string, "summary": string, "agreement": string|null, "to_finalize": string|null, "cost_terms": string|null}`;

export type ThreadMessage = { direction: "in" | "out"; from: string; at: string; subject: string; body: string };
export type MediaDecision = {
  reply: string; relevant: boolean; needsOwner: boolean; ownerQuestion: string | null; company: string | null;
  kind: MediaPartnerKind; stage: MediaPartnerStatus; summary: string; agreement: string | null; toFinalize: string | null; costTerms: string | null;
};

const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Parse and clamp the model's JSON; throws on anything unusable (the worker retries, then holds). */
export function parseDecision(raw: string): MediaDecision {
  const j = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, ""));
  const reply = str(j.reply, 4000);
  if (!reply) throw new Error("The model returned no reply");
  const kind = (MEDIA_PARTNER_KINDS as readonly string[]).includes(j.kind) ? j.kind : "other";
  const stage = (["talking", "agreed", "declined"] as string[]).includes(j.stage) ? j.stage : "talking";
  return {
    reply, relevant: j.relevant !== false, needsOwner: j.needs_owner === true, ownerQuestion: str(j.owner_question, 500),
    company: str(j.company, 120), kind, stage: stage as (typeof MEDIA_PARTNER_STATUSES)[number], summary: str(j.summary, 600) ?? "",
    agreement: str(j.agreement, 600), toFinalize: str(j.to_finalize, 600), costTerms: str(j.cost_terms, 600),
  };
}

export function threadPrompt(thread: ThreadMessage[]): string {
  return thread
    .map((m) => `--- ${m.direction === "in" ? "THEM" : "US"} · ${m.from} · ${m.at}\nSubject: ${m.subject}\n\n${m.body.slice(0, 6000)}`)
    .join("\n\n");
}

export const aiDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

async function ask(p: MediaAiProvider, user: string, system: string = SYSTEM): Promise<string> {
  const init: RequestInit = p.style === "anthropic"
    ? {
      method: "POST",
      headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: p.model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }),
    }
    : {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: p.model,
        response_format: { type: "json_object" },
        // TruthCoder reads max_tokens; OpenAI's GPT-5 models want max_completion_tokens.
        ...(p.name === "OpenAI" ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    };
  const res = await aiDeps.fetch(p.url, { ...init, signal: AbortSignal.timeout(p.name.startsWith("TruthCoder") ? 180_000 : 90_000) });
  if (!res.ok) throw new Error(`${p.name} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return p.style === "anthropic"
    ? String((data?.content ?? []).map((c: any) => (c?.type === "text" ? c.text : "")).join(""))
    : String(data?.choices?.[0]?.message?.content ?? "");
}

/** Our API first, then OpenAI, then Anthropic: the first usable answer wins (records which one in `provider`). */
export async function decide(thread: ThreadMessage[], env: NodeJS.ProcessEnv = process.env): Promise<MediaDecision & { provider: string }> {
  const providers = mediaAiProviders(env);
  if (!providers.length) throw new Error("No AI key configured for the media inbox");
  const user = `The thread, oldest first. Answer the last email from THEM.\n\n${threadPrompt(thread)}`;
  const errors: string[] = [];
  for (const p of providers) {
    try { return { ...parseDecision(await ask(p, user)), provider: `${p.name} (${p.model})` }; }
    catch (e: any) { errors.push(`${p.name}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  throw new Error(`Every AI provider failed — ${errors.join(" · ")}`);
}

const NEXT_STEP_SYSTEM = `You read automatic replies (auto-responders) that companies sent to the ConstructHUB Media Team after we asked
about a listings, content or news partnership. We are a software company: we want a free partnership, a partner or agency
program, API or bulk-upload access, or a way to submit editorial content. We are not buying advertising.
Nobody answers an auto-reply, but it often says what to do next: fill in a form, use another address, join a partner
program, wait a number of days. When it lists several routes, pick the ONE that fits our purpose (partners, agencies, API,
editorial or press submissions) — never advertising sales, billing, subscriber support, deliveries, careers or listing edits
for a single business.
Return JSON only: {"next_step": string|null, "link": string|null, "contact": string|null, "contact_role": string|null, "summary": string}
- next_step: the concrete thing we should do, in one plain sentence (null if the reply only says "we got your message").
- link: the URL of that route, copied exactly from the email (null if none).
- contact: another email address for that route (null if none). contact_role: one of partnerships, editorial, advertising,
  billing, support, other — what that address is for.
- summary: one short sentence on what the auto-reply says. Never invent a link or address that is not in the email.`;

export const CONTACT_ROLES = ["partnerships", "editorial", "advertising", "billing", "support", "other"] as const;
export type NextStep = { nextStep: string | null; link: string | null; contact: string | null; contactRole: (typeof CONTACT_ROLES)[number] | null; summary: string; provider: string };

/** Ask each provider in turn for JSON (our API first); the first one `parse` accepts wins. */
async function askJson<T>(user: string, system: string, parse: (j: any) => T, env: NodeJS.ProcessEnv): Promise<T & { provider: string }> {
  const providers = mediaAiProviders(env);
  if (!providers.length) throw new Error("No AI key configured for the media inbox");
  const errors: string[] = [];
  for (const p of providers) {
    try { return { ...parse(JSON.parse((await ask(p, user, system)).replace(/^```(json)?\s*|\s*```$/g, ""))), provider: `${p.name} (${p.model})` }; }
    catch (e: any) { errors.push(`${p.name}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  throw new Error(`Every AI provider failed — ${errors.join(" · ")}`);
}

/** Read an auto-reply for its next step (no reply is ever sent to an auto-reply). */
export async function extractNextStep(thread: ThreadMessage[], env: NodeJS.ProcessEnv = process.env): Promise<NextStep> {
  const body = thread.at(-1)?.body ?? "";
  const user = `The thread, oldest first. Read the last email (the automatic reply).\n\n${threadPrompt(thread)}`;
  return askJson(user, NEXT_STEP_SYSTEM, (j) => {
    // Only keep a link or address that is really in the email.
    const link = typeof j.link === "string" && j.link.trim() && body.includes(j.link.trim()) ? j.link.trim().slice(0, 500) : null;
    const contact = typeof j.contact === "string" && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(j.contact.trim()) && body.toLowerCase().includes(j.contact.trim().toLowerCase()) ? j.contact.trim().toLowerCase() : null;
    return {
      nextStep: typeof j.next_step === "string" && j.next_step.trim() ? j.next_step.trim().slice(0, 500) : null,
      link, contact, contactRole: contact && (CONTACT_ROLES as readonly string[]).includes(j.contact_role) ? j.contact_role : contact ? "other" : null,
      summary: typeof j.summary === "string" ? j.summary.trim().slice(0, 400) : "",
    };
  }, env);
}

export const PARTNER_CLASSES = ["listing_directory", "trade_association", "chamber", "news", "publisher", "government", "business", "other"] as const;
export type PartnerClass = (typeof PARTNER_CLASSES)[number];
const CLASSIFY_SYSTEM = `You sort websites for a company that builds relationships with places where US contractors get listed or featured.
For each site, from its domain and page titles, answer with one class:
- listing_directory: an online business directory or listings site that lists many unrelated local businesses (Yelp-like, a city or regional business directory, a home-services directory). NOT a members-only directory of an organisation.
- trade_association: a construction or home-trade association, builders' exchange or union (home builders association, NARI, AGC, ABC, NECA, PHCC, ACCA, roofing / remodelers / masonry / painting associations).
- chamber: a chamber of commerce, business alliance or downtown/economic development organisation with a member directory.
- news: a newspaper, magazine or local news site.
- publisher: a blog or content site that takes articles.
- government: a city, county, state or federal body, or a licence lookup.
- business: a single company (a contractor, a manufacturer, a dealer locator, a utility).
- other: anything else (political parties, schools, alumni, bar or medical or realtor associations, hobby clubs, unclear pages).
Also give "name": the organisation's own name as its titles write it (e.g. "Rochester Area Chamber of Commerce"), or null when
the titles do not name it. Never invent a name.
Answer only JSON: {"sites":[{"domain":"...","class":"...","name":"..."}]} with every domain you were given.`;

/** A name the AI read is kept only when each of its words is on the site's titles or domain (nothing made up). */
export function nameIsOnPage(name: string, site: { domain: string; title: string | null; homeTitle: string | null }): boolean {
  const hay = `${site.title ?? ""} ${site.homeTitle ?? ""} ${site.domain}`.toLowerCase().replace(/&amp;/g, "&");
  const words = name.toLowerCase().split(/[^a-z0-9&]+/).filter((w) => w.length >= 3 && !["the", "and", "inc"].includes(w));
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/** Sort vetted directories by what they are (our API first). Domains the answer leaves out stay unclassified. */
export async function classifySites(sites: { domain: string; title: string | null; homeTitle: string | null }[], env: NodeJS.ProcessEnv = process.env): Promise<{ classes: Map<string, PartnerClass>; names: Map<string, string>; provider: string }> {
  const user = sites.map((s) => `${s.domain} | ${(s.title ?? "").slice(0, 120)} | ${(s.homeTitle ?? "").slice(0, 120)}`).join("\n");
  const byDomain = new Map(sites.map((s) => [s.domain, s]));
  return askJson(user, CLASSIFY_SYSTEM, (j) => {
    const classes = new Map<string, PartnerClass>();
    const names = new Map<string, string>();
    for (const x of Array.isArray(j?.sites) ? j.sites : []) {
      const site = typeof x?.domain === "string" ? byDomain.get(x.domain) : undefined;
      if (!site || !(PARTNER_CLASSES as readonly string[]).includes(x.class)) continue;
      classes.set(site.domain, x.class);
      if (typeof x.name === "string" && x.name.trim().length >= 3 && x.name.length <= 100 && nameIsOnPage(x.name.trim(), site)) names.set(site.domain, x.name.trim());
    }
    if (!classes.size) throw new Error("No usable classes in the answer");
    return { classes, names };
  }, env);
}

/** Who we are on a web form (the same details as the email signature, server/email-signature.ts). */
export const FORM_IDENTITY = {
  company: "ConstructHUB", website: "https://constructhub.us", email: "media@constructhub.us", phone: "(832) 399-0560",
  name: "Leah Peterson", firstName: "Leah", lastName: "Peterson", title: "Partnerships, Construct HUB Media Team", country: "United States",
};

const FORM_SYSTEM = `You fill in a partner's web form for the ConstructHUB Media Team. The company's auto-reply sent us to this page.

Facts you may use (never invent anything else):
${FACTS}
Our details: ${Object.entries(FORM_IDENTITY).map(([k, v]) => `${k}: ${v}`).join("; ")}.

Rules:
- Fill only fields you can answer truthfully from the facts. A number we don't have (sales volume, revenue, customer count,
  budget) is answered "Not disclosed — early-stage, launched in 2026". Never make up a number.
- Pick only free options: partnership, listings, API, editorial, agency programs. Never pick a paid option (buy credits,
  promo codes, advertising, sponsored posts, premium plans) and never agree to pay. Leave marketing opt-ins unticked; tick
  a privacy or data-retention consent the form requires.
- The main message / description / comments field gets OUR MESSAGE (below) exactly as written — never your own words.
  Any other free-text answer is short and factual; never claim a location, launch, event, customer, offer or material that
  is not in the facts.
- The company itself sent us to this page, so its partnership / intake / contact / press form IS the right place even if
  its options don't match our idea exactly: submit = true, picking the closest free option.
- submit = false only when the form is not for a partnership/listing/editorial request (a newsletter, a job application, a
  search box, a single business's listing edit) or asks for payment, a password or an account.
- pricing: copy any price the page states for partner, API or listing plans, exactly as written (null if none).
- api: one sentence on any API or bulk access the page describes (null if none).

Return JSON only: {"submit": boolean, "fill": {"<field key>": string | string[] | boolean}, "pricing": string|null, "api": string|null, "why": string}
Use the field keys exactly as given. string[] is for checkbox groups (the option texts to tick).`;

export type FormField = { key: string; label: string; type: string; required: boolean; options?: string[] };
export type FormPlan = { submit: boolean; fill: Record<string, string | string[] | boolean>; pricing: string | null; api: string | null; why: string; provider: string };

/** Plan a form: what to put in each field, whether to send it, and any price or API the page describes. */
export async function planForm(page: { url: string; title: string; text: string; fields: FormField[] }, message: string, env: NodeJS.ProcessEnv = process.env): Promise<FormPlan> {
  const keys = new Set(page.fields.map((f) => f.key));
  const user = `Page: ${page.title} (${page.url})\n\nPage text:\n${page.text.slice(0, 8000)}\n\nForm fields:\n${page.fields.length ? JSON.stringify(page.fields) : "(no form on this page)"}\n\nOUR MESSAGE:\n${message}`;
  return askJson(user, FORM_SYSTEM, (j) => {
    const fill: FormPlan["fill"] = {};
    for (const [k, v] of Object.entries(j.fill ?? {})) {
      if (!keys.has(k)) continue;
      if (typeof v === "string" || typeof v === "boolean") fill[k] = typeof v === "string" ? v.slice(0, 3000) : v;
      else if (Array.isArray(v)) fill[k] = v.filter((x): x is string => typeof x === "string");
    }
    // A price is kept only when every amount in it is on the page.
    const pricing = typeof j.pricing === "string" && j.pricing.trim() && (j.pricing.match(/\$\s?[\d.,]+/g) ?? []).every((a: string) => page.text.includes(a.replace(/\s/g, ""))) ? j.pricing.trim().slice(0, 500) : null;
    // A long answer that is not our message is the model writing its own pitch: not sent.
    const ownWords = Object.values(fill).some((v) => typeof v === "string" && v.split(/\s+/).length > 40 && !message.includes(v.trim().slice(0, 60)));
    return { submit: j.submit === true && page.fields.length > 0 && !ownWords, fill, pricing, api: typeof j.api === "string" && j.api.trim() ? j.api.trim().slice(0, 500) : null, why: typeof j.why === "string" ? j.why.slice(0, 400) : "" };
  }, env);
}
