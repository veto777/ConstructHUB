/**
 * Drafts the media inbox's replies and reads where each relationship stands. The platform's AI by default
 * (AI_INTEGRATIONS_OPENAI_BASE_URL + _API_KEY, model AI_MODEL — server/ai-config.ts); MEDIA_AI_PROVIDER=openai uses
 * OpenAI's own API with HUB_OPENAI_API_KEY and MEDIA_AI_MODEL (default gpt-5.4-mini). MEDIA_AI_MODEL overrides either.
 * The prompt asks for good manners; the money / meeting / contract rules are enforced again in ./guard.ts.
 */
import { aiModel } from "../ai-config";
import { MEDIA_PARTNER_KINDS, MEDIA_PARTNER_STATUSES, type MediaPartnerKind, type MediaPartnerStatus } from "@shared/media-inbox";

export const MEDIA_AI_DEFAULT_MODEL = "gpt-5.4-mini";
const useOpenAi = (env: NodeJS.ProcessEnv) => (env.MEDIA_AI_PROVIDER ?? "").trim().toLowerCase() === "openai";
/** Where the model is: [chat-completions URL, key, model]. */
export function mediaAiEndpoint(env: NodeJS.ProcessEnv = process.env): { url: string; key: string; model: string } {
  if (useOpenAi(env)) return { url: "https://api.openai.com/v1/chat/completions", key: env.HUB_OPENAI_API_KEY?.trim() ?? "", model: env.MEDIA_AI_MODEL?.trim() || MEDIA_AI_DEFAULT_MODEL };
  const base = (env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "").trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
  return { url: `${base}/chat/completions`, key: env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() ?? "", model: env.MEDIA_AI_MODEL?.trim() || aiModel(env.AI_MODEL) };
}
export const mediaAiConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(mediaAiEndpoint(env).key);

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

Rules:
1. Every person gets a warm, professional, short reply (under 180 words) in plain English. Sign off "Best regards," with nothing after it (the team signature is added).
2. Never agree to pay, buy, prepay, subscribe or sign anything. Never write an amount of money. If they ask for money, fees, a contract
   or payment details, thank them, say we pay only per listing or placement once one of our customers purchases it, and that the team
   will review their terms. Never repeat or restate any price or amount they quoted. Set needs_owner = true.
3. Never fix a meeting time or date. If they want a call, say the team will reply with times. Set needs_owner = true.
4. Ask for what moves the relationship forward at no cost: API or bulk-submission docs, how listings are created for many businesses,
   free listing or partner programs, editorial guidelines, whether service-area businesses without a street address are accepted.
5. If the email is spam, a scam, a phishing attempt or completely unrelated, reply politely in one or two sentences and set relevant = false.
6. Do not claim to be a specific person. Do not mention that you are an AI.

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

export async function decide(thread: ThreadMessage[], env: NodeJS.ProcessEnv = process.env): Promise<MediaDecision> {
  const { url, key, model } = mediaAiEndpoint(env);
  if (!key) throw new Error("No AI key configured for the media inbox");
  const res = await aiDeps.fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `The thread, oldest first. Answer the last email from THEM.\n\n${threadPrompt(thread)}` },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return parseDecision(String(data?.choices?.[0]?.message?.content ?? ""));
}
