/**
 * The press writer: drafts a release from the customer's facts to the wire's guidelines (./guidelines.ts), revises
 * it against editorial notes, and reads the wire's emails (approved / live / changes / report / question).
 * Providers as the media inbox uses them (server/media-inbox/ai.ts mediaAiProviders): our API first, then OpenAI,
 * then Anthropic — JSON answers only. Nothing here invents a fact: the prompts forbid it and checkRelease flags it.
 */
import { mediaAiProviders, type MediaAiProvider } from "../media-inbox/ai";
import { WRITING_RULES } from "./guidelines";
import { PRESS_NEWS_TYPES, type PressReleaseInput, type PressReleaseText, type PressReport, type PressTier } from "@shared/press";

export const writerDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };
export const pressAiConfigured = (env: NodeJS.ProcessEnv = process.env) => mediaAiProviders(env).length > 0;

async function ask(p: MediaAiProvider, system: string, user: string): Promise<string> {
  const init: RequestInit = p.style === "anthropic"
    ? { method: "POST", headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: p.model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }) }
    : { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: p.model, response_format: { type: "json_object" }, ...(p.name === "OpenAI" ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }), messages: [{ role: "system", content: system }, { role: "user", content: user }] }) };
  const res = await writerDeps.fetch(p.url, { ...init, signal: AbortSignal.timeout(p.name.startsWith("TruthCoder") ? 180_000 : 90_000) });
  if (!res.ok) throw new Error(`${p.name} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return p.style === "anthropic" ? String((data?.content ?? []).map((c: any) => (c?.type === "text" ? c.text : "")).join("")) : String(data?.choices?.[0]?.message?.content ?? "");
}

async function askJson<T>(system: string, user: string, parse: (j: any) => T, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const providers = mediaAiProviders(env);
  if (!providers.length) throw new Error("No AI key is configured for the press writer");
  const errors: string[] = [];
  for (const p of providers) {
    try {
      const raw = (await ask(p, system, user)).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      return parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
    } catch (e: any) { errors.push(`${p.name}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  throw new Error(`Every AI provider failed — ${errors.join(" · ")}`);
}

const str = (v: unknown, max = 20_000) => String(v ?? "").trim().slice(0, max);
const parseText = (j: any): PressReleaseText => {
  const t = { headline: str(j.headline, 200), subheadline: str(j.subheadline, 300), dateline: str(j.dateline, 120), body: str(j.body), boilerplate: str(j.boilerplate, 2000), mediaContact: str(j.mediaContact, 1000) };
  if (!t.headline || !t.body) throw new Error("The draft has no headline or body");
  return t;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const datelineFor = (city: string, state: string, d = new Date()) => `${city.trim().toUpperCase()}, ${state.trim().toUpperCase()} / ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} /`;

function factsPrompt(input: PressReleaseInput, tier: PressTier): string {
  const newsType = PRESS_NEWS_TYPES.find((t) => t.key === input.newsType)?.label ?? input.newsType;
  return [
    `Distribution tier: ${tier === "premium" ? "Premium (national news sites, major newspapers, financial data providers)" : "Budget (Yahoo Finance, Yahoo News, Digital Journal, regional news and radio)"}.`,
    `Kind of news: ${newsType}`,
    `Company: ${input.companyName}`,
    `Website: ${input.website || "(none given)"}`,
    `Location: ${input.city}, ${input.state}`,
    `Dateline to use exactly: ${datelineFor(input.city, input.state)}`,
    `Spokesperson: ${input.spokesperson || "(none)"}${input.spokespersonTitle ? `, ${input.spokespersonTitle}` : ""}`,
    `What the spokesperson wants to say (shape this into their quote; keep its meaning, do not add claims): ${input.quoteNotes || "(none — write one quote in the spokesperson's voice about the news itself, with no numbers or claims not given above)"}`,
    `Media contact: ${input.contactName} · ${input.companyName} · ${input.contactEmail} · ${input.contactPhone || ""} · ${input.website || ""}`,
    `About the company (for the boilerplate; use only these facts): ${input.about || "(none given — write the boilerplate from the company name, location and the news only)"}`,
    input.photos.length ? `Photos supplied (${input.photos.length}): ${input.photos.map((p) => p.caption || "untitled").join("; ")}. Do not describe them in the text.` : "",
    "",
    "THE NEWS, in the customer's words (the only source of facts):",
    input.details,
  ].filter((l) => l !== undefined).join("\n");
}

/** A first draft from the customer's facts. */
export async function draftRelease(input: PressReleaseInput, tier: PressTier, env: NodeJS.ProcessEnv = process.env): Promise<PressReleaseText> {
  return askJson(WRITING_RULES, `Write the press release from these facts.\n\n${factsPrompt(input, tier)}`, parseText, env);
}

/** The same release, revised to the notes (the wire's editorial requests or our guideline check), nothing else changed. */
export async function reviseRelease(input: PressReleaseInput, text: PressReleaseText, notes: string, tier: PressTier, env: NodeJS.ProcessEnv = process.env): Promise<PressReleaseText> {
  const user = `Revise this press release to resolve every note below. Keep everything else as it is: the same facts, the same structure, the same quotes unless a note concerns them. Never add facts.\n\nNOTES:\n${notes}\n\nFACTS (the only source of truth):\n${factsPrompt(input, tier)}\n\nCURRENT RELEASE:\n${JSON.stringify(text, null, 2)}`;
  return askJson(WRITING_RULES, user, parseText, env);
}

export const WIRE_REPLY_KINDS = ["receipt", "approved", "live", "changes", "report", "question", "other"] as const;
export type WireReplyKind = (typeof WIRE_REPLY_KINDS)[number];
export type WireReading = {
  kind: WireReplyKind;
  /** The published release's URL, when the email gives one. */
  liveUrl: string | null;
  /** The editors' requested changes or questions, verbatim where possible. */
  notes: string | null;
  summary: string;
  report: Omit<PressReport, "attachments" | "receivedAt"> | null;
};

const READER_SYSTEM = `You read emails that a newswire's editorial and customer teams send about a press release we submitted for a customer. Classify the email and pull out the facts. Return JSON only:
{"kind": "receipt"|"approved"|"live"|"changes"|"report"|"question"|"other", "liveUrl": string|null, "notes": string|null, "summary": string,
 "report": null | {"summary": string, "outlets": number|null, "views": number|null, "clicks": number|null, "pickups": [{"outlet": string, "url": string|null}]}}
- receipt: an automatic "we received your submission" message.
- approved: the editors approved it but it is not yet published (no live link).
- live: the release has been distributed/published; liveUrl is the URL of the release on the wire or an outlet (copied exactly from the email; null if none given).
- changes: the editors ask for changes, documents, authorization forms or clarification before they will distribute it; notes = every requested change, in order, as plain sentences.
- report: a distribution, visibility or analytics report (counts of outlets/pickups, views, clicks, a list of sites that carried it); fill "report" from the numbers and names IN THE EMAIL OR ATTACHMENT TEXT ONLY, null for anything not given.
- question: a person asks us something that needs an answer (billing, account, scheduling).
- other: anything else (newsletters, sales, unrelated).
Never invent a URL, a number or a requested change that is not in the text.`;

/** Read one of the wire's emails about a release. `attachmentText` is any CSV/text attachment content. */
export async function readWireReply(m: { subject: string; body: string; fromEmail: string; attachmentText?: string }, env: NodeJS.ProcessEnv = process.env): Promise<WireReading> {
  const user = `From: ${m.fromEmail}\nSubject: ${m.subject}\n\n${m.body.slice(0, 12_000)}${m.attachmentText ? `\n\nATTACHMENT TEXT:\n${m.attachmentText.slice(0, 12_000)}` : ""}`;
  return askJson(READER_SYSTEM, user, (j: any): WireReading => {
    const kind = (WIRE_REPLY_KINDS as readonly string[]).includes(j.kind) ? (j.kind as WireReplyKind) : "other";
    const url = typeof j.liveUrl === "string" && /^https?:\/\//i.test(j.liveUrl.trim()) ? j.liveUrl.trim() : null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d[\d,]*$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : null);
    const report = j.report && typeof j.report === "object"
      ? { summary: str(j.report.summary, 2000), outlets: num(j.report.outlets), views: num(j.report.views), clicks: num(j.report.clicks), pickups: Array.isArray(j.report.pickups) ? j.report.pickups.slice(0, 200).map((p: any) => ({ outlet: str(p?.outlet, 200), url: typeof p?.url === "string" && /^https?:\/\//i.test(p.url) ? p.url.trim() : null })).filter((p: any) => p.outlet) : [] }
      : null;
    return { kind, liveUrl: url, notes: j.notes ? str(j.notes, 4000) : null, summary: str(j.summary, 500) || kind, report };
  }, env);
}

/** The release as plain text, the way it goes to the wire and shows in the preview. */
export function releaseAsText(t: PressReleaseText): string {
  return [t.headline, t.subheadline, "", `${t.dateline} ${t.body.trim()}`, "", t.boilerplate.trim(), "", "Media Contact:", t.mediaContact.trim()].join("\n").replace(/\n{3,}/g, "\n\n");
}
