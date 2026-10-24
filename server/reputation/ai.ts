/**
 * The Reputation Desk's language work: labelling search results and drafting removal requests. Uses the same
 * providers as the media inbox (server/media-inbox/ai.ts mediaAiProviders: our own API first, then OpenAI,
 * then Anthropic); with none configured, or every one failing, results fall back to the keyword labels and a
 * request draft is refused with a clear message.
 */
import { mediaAiProviders, type MediaAiProvider } from "../media-inbox/ai";
import { SENTIMENTS, CONTROLS, type Control, type ItemKind, type RepSubjectKind, type Sentiment } from "@shared/reputation";

export const repAiDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init), env: () => process.env };

async function ask(p: MediaAiProvider, system: string, user: string, json: boolean): Promise<string> {
  const init: RequestInit = p.style === "anthropic"
    ? { method: "POST", headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }) }
    : { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: p.model, ...(json ? { response_format: { type: "json_object" } } : {}),
          ...(p.name === "OpenAI" ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }) };
  const res = await repAiDeps.fetch(p.url, { ...init, signal: AbortSignal.timeout(p.name.startsWith("TruthCoder") ? 120_000 : 60_000) });
  if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data: any = await res.json();
  return p.style === "anthropic"
    ? String((data?.content ?? []).map((c: any) => (c?.type === "text" ? c.text : "")).join(""))
    : String(data?.choices?.[0]?.message?.content ?? "");
}

async function firstAnswer(system: string, user: string, json: boolean): Promise<{ text: string; provider: string }> {
  const providers = mediaAiProviders(repAiDeps.env());
  if (!providers.length) throw new Error("No AI provider is configured.");
  const errors: string[] = [];
  for (const p of providers) {
    try {
      const text = await ask(p, system, user, json);
      if (text.trim()) return { text, provider: `${p.name} (${p.model})` };
    } catch (e: any) { errors.push(String(e?.message ?? e).slice(0, 160)); }
  }
  throw new Error(`Every AI provider failed — ${errors.join(" · ")}`);
}

export type ClassifyInput = { id: string; kind: ItemKind; title: string; snippet: string; domain: string | null; url: string | null };
export type ClassifyLabel = { sentiment: Sentiment; control: Control; reason: string | null };

const CLASSIFY_SYSTEM = `You label Google search results about a person or business for a reputation-management team.
For each item decide:
- sentiment: "negative" if it could hurt the subject's reputation (accusations, lawsuits, arrests, complaints, bad reviews, scandals, unflattering coverage, complaint/gossip/mugshot sites), "positive" if it clearly helps (praise, awards, the subject's own professional pages), otherwise "neutral".
- control: "owned" only if it is plainly the subject's own website or their own profile page; otherwise "third_party".
- reason: at most 12 words, factual, from the title/snippet only.
Autocomplete items are search predictions: negative if the prediction pairs the name with a negative term.
Answer ONLY with JSON: {"items":[{"id":"…","sentiment":"…","control":"…","reason":"…"}]}`;

export async function classifyResults(query: string, kind: RepSubjectKind, items: ClassifyInput[]): Promise<{ items: Map<string, ClassifyLabel>; provider: string }> {
  const out = new Map<string, ClassifyLabel>();
  if (!items.length) return { items: out, provider: "none" };
  const user = `Subject (${kind}): "${query}"\n\nItems:\n${items.map((i) => JSON.stringify({ id: i.id, kind: i.kind, title: i.title.slice(0, 200), snippet: i.snippet.slice(0, 300), domain: i.domain })).join("\n")}`;
  try {
    const { text, provider } = await firstAnswer(CLASSIFY_SYSTEM, user, true);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    for (const r of Array.isArray(parsed?.items) ? parsed.items : []) {
      const sentiment = SENTIMENTS.includes(r?.sentiment) ? r.sentiment as Sentiment : null;
      if (!sentiment || typeof r?.id !== "string") continue;
      out.set(r.id, { sentiment, control: CONTROLS.includes(r?.control) ? r.control as Control : "third_party", reason: typeof r?.reason === "string" ? r.reason.slice(0, 120) : null });
    }
    return { items: out, provider };
  } catch (e: any) {
    console.warn("[reputation] classifier fell back to keywords:", String(e?.message ?? e).slice(0, 200));
    return { items: out, provider: "keyword rules" };
  }
}

export type DraftInput = {
  playbook: { title: string; platform: string; whenItApplies?: string; evidence?: string[]; letterOutline?: string[]; statutes?: string[]; requestUrl?: string | null } | null;
  item: { url: string | null; title: string; snippet: string; kind: ItemKind };
  subject: string; clientName: string; kind: RepSubjectKind; operatorNotes?: string | null;
};

const DRAFT_SYSTEM = `You draft removal and de-indexing requests for a reputation-management team, for an operator to review before anything is sent.
Rules: be factual and courteous; never invent facts, dates, case numbers, statutes or evidence — where a fact is needed and not given, write a bracketed placeholder like [date the photo was taken]; cite only statutes or policies that were supplied; keep it under 400 words; plain text, no markdown.
Write the request from the subject (or their authorized agent where the platform allows agents) to the platform or publisher named.`;

export async function draftRequest(d: DraftInput): Promise<{ text: string; provider: string }> {
  const pb = d.playbook;
  const user = [
    `Subject: ${d.subject} (${d.kind}); client: ${d.clientName}.`,
    `Content: ${d.item.kind} — "${d.item.title}"${d.item.url ? ` at ${d.item.url}` : ""}.`,
    d.item.snippet ? `Snippet: ${d.item.snippet}` : "",
    pb ? `Request type: ${pb.title} (${pb.platform}).${pb.whenItApplies ? ` Applies when: ${pb.whenItApplies}` : ""}` : "Request type: a polite removal request to the publisher.",
    pb?.letterOutline?.length ? `Cover these points:\n- ${pb.letterOutline.join("\n- ")}` : "",
    pb?.evidence?.length ? `Evidence the platform asks for (refer to it as attached or to be supplied):\n- ${pb.evidence.join("\n- ")}` : "",
    pb?.statutes?.length ? `Law/policy you may cite: ${pb.statutes.join("; ")}` : "",
    pb?.requestUrl ? `It will be submitted through: ${pb.requestUrl}` : "",
    d.operatorNotes ? `Operator notes (facts you may use): ${d.operatorNotes}` : "",
  ].filter(Boolean).join("\n\n");
  return firstAnswer(DRAFT_SYSTEM, user, false);
}
