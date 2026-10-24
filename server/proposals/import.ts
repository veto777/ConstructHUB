/**
 * A proposal from the admin's own PDF (POST /api/admin/proposals/import): the PDF's text is read (unpdf), an AI
 * provider (the media inbox's chain, server/reputation/ai.ts firstAnswer) lays it out as this app's proposal —
 * the written pages as sections, every priced service as a pickable package — and the contract terms are the
 * PDF's own terms followed by the standard service agreement (shared/proposals.ts standardTerms). The admin
 * reviews everything in the editor before sending; nothing is sent from here.
 */
import { firstAnswer } from "../reputation/ai";
import { proposalContentSchema, standardTerms, type ProposalContent } from "@shared/proposals";
import { isSameTerms } from "@shared/terms-dedupe";

const MAX_TEXT = 60_000;

export class ImportError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(doc, { mergePages: false });
  const pages = (text as string[]).map((t, i) => `--- page ${i + 1} ---\n${t.replace(/[ \t]+\n/g, "\n").trim()}`);
  return { text: pages.join("\n\n").slice(0, MAX_TEXT), pages: totalPages };
}

const SYSTEM = `You turn a sales proposal (text extracted from a PDF) into structured data for an online proposal the client reads, picks options from, signs and pays.
Rules:
- Keep the proposal's own words. Reproduce headings and text nearly verbatim; only drop page headers/footers, page numbers and repeated boilerplate.
- sections: every written page that is not a price list or a package's scope page, in the PDF's order (overview, findings, workstreams, what was already delivered, timeline, next steps, appendix/research…). Do not skip pages. eyebrow = the small label above a heading if any (e.g. "01 / Executive overview"). body is plain text: blank line between paragraphs, "- " at the start of each bullet. Tables become bullets ("Weeks 1–2: …").
- groups: every priced thing the client can buy. Alternatives of the same thing (tiers: Standard/National/Premium, Starter/Pro/Premium/Platinum bundles, Local/Expanded/Regional) are ONE group with select "one". Independent services and add-ons that can be combined are a group with select "many". A package's scope page (everything it includes) goes in that package's bullets — one short line each, keep them all. A capability described as included in a package (e.g. "included with Platinum") is bullets of that package, never its own item.
- Every item has a price stated in the PDF. Never create an item without one; never invent or compute a price.
- price and billing: a price "per month" is billing "monthly" with price = the monthly amount and termMonths = the minimum months (e.g. "$2,500 per month | $15,000 over 6 months" → price 2500, monthly, termMonths 6; "six-month minimum" → 6; none stated → 1). Otherwise billing "one_time" with the stated total (a 14-release program sold for $8,550 → 8550); per-unit or per-month breakdowns of a one-time total go in the description.
- recommended: true only for items the PDF explicitly recommends (e.g. its "recommended configuration"); never for items called optional. In a select "one" group at most one item is recommended.
- clauses: the PDF's numbered contract / program / commercial terms the client agrees to (e.g. "1. Initial commitment and monthly continuation" with its paragraph), each one verbatim as {heading, body}. The client initials each. Leave empty if the PDF has no such terms section.
- proposalTerms: other short terms the PDF states outside that section (what is not guaranteed, disclosures), one per entry, verbatim. Do not add your own.
- A "select your services" page with checkboxes tells you which groups are pick-one and which are check-any; follow it.
- brand: the company making the proposal (name, contact person, email, phone, website) as printed. recipient: who it is prepared for.
Answer ONLY with JSON:
{"brand":{"name":"","contactName":"","contactEmail":"","phone":"","website":""},"title":"","subtitle":"","intro":"","recipient":{"name":"","company":"","email":""},
 "sections":[{"eyebrow":"","heading":"","body":""}],
 "groups":[{"name":"","description":"","select":"one","required":false,"items":[{"name":"","description":"","bullets":[""],"price":0,"billing":"one_time","termMonths":1,"recommended":false}]}],
 "clauses":[{"heading":"","body":""}],"proposalTerms":[""]}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "x";

/** The AI's answer → valid proposal content (ids made unique, limits applied, prices in cents). */
export function toContent(raw: any, fallbackBrand: string): { content: ProposalContent; recipient: { name: string; company: string; email: string } } {
  const used = new Set<string>();
  const uid = (base: string) => { let id = slug(base), n = 2; while (used.has(id)) id = `${slug(base).slice(0, 26)}-${n++}`; used.add(id); return id; };
  const brandName = str(raw?.brand?.name, 120) || fallbackBrand;
  const groups = (Array.isArray(raw?.groups) ? raw.groups : []).slice(0, 20).map((g: any) => ({
    id: uid(`g-${str(g?.name, 40) || "options"}`),
    name: str(g?.name, 200) || "Options",
    description: str(g?.description, 2000),
    select: g?.select === "one" ? "one" : "many",
    required: g?.required === true,
    items: (Array.isArray(g?.items) ? g.items : []).slice(0, 40).filter((i: any) => str(i?.name, 200) && Number(i?.price) > 0).map((i: any) => {
      const price = Number(i?.price);
      const monthly = i?.billing === "monthly";
      return {
        id: uid(str(i?.name, 40)),
        name: str(i?.name, 200),
        description: str(i?.description, 2000),
        bullets: (Array.isArray(i?.bullets) ? i.bullets : []).map((b: unknown) => str(b, 300)).filter(Boolean).slice(0, 40),
        priceCents: Number.isFinite(price) && price >= 0 ? Math.min(100_000_000, Math.round(price * 100)) : 0,
        billing: monthly ? "monthly" : "one_time",
        termMonths: monthly ? Math.max(1, Math.min(60, Math.round(Number(i?.termMonths) || 1))) : 1,
        defaultSelected: false,
        included: false,
        badge: i?.recommended === true ? "Recommended" : "",
      };
    }),
  })).filter((g: any) => g.items.length).map((g: any) => {
    // A pick-one group shows at most one "Recommended" badge.
    if (g.select !== "one") return g;
    let seen = false;
    return { ...g, items: g.items.map((i: any) => { const keep = !!i.badge && !seen; if (i.badge) seen = true; return { ...i, badge: keep ? i.badge : "" }; }) };
  });
  const ownTerms = (Array.isArray(raw?.proposalTerms) ? raw.proposalTerms : []).map((t: unknown) => str(t, 2000)).filter(Boolean);
  const own = ownTerms.length ? `TERMS FROM THIS PROPOSAL\n\n${ownTerms.map((t: string) => `- ${t}`).join("\n")}` : "";
  const standard = standardTerms(brandName);
  const clauses = (Array.isArray(raw?.clauses) ? raw.clauses : []).slice(0, 40)
    .map((c: any, i: number) => ({ id: `c${i + 1}`, heading: str(c?.heading, 300), body: str(c?.body, 5000), initials: true }))
    .filter((c: any) => c.heading || c.body);
  // The PDF's own numbered terms are the contract (initialed one by one); without them the standard agreement is.
  // The CRM's rule (shared/terms-dedupe.ts): the same terms are never shown twice.
  const terms = clauses.length ? own : own && !isSameTerms(own, standard) ? `${own}\n\n${standard}` : standard;
  const content = proposalContentSchema.parse({
    brand: {
      name: brandName, contactName: str(raw?.brand?.contactName, 120), contactEmail: str(raw?.brand?.contactEmail, 200),
      phone: str(raw?.brand?.phone, 60), website: str(raw?.brand?.website, 200),
    },
    title: str(raw?.title, 300), subtitle: str(raw?.subtitle, 1000), intro: str(raw?.intro, 5000),
    sections: (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 40).map((s: any, i: number) => ({
      id: `s${i + 1}`, eyebrow: str(s?.eyebrow, 120), heading: str(s?.heading, 300), body: str(s?.body, 20_000),
    })).filter((s: any) => s.heading || s.body),
    groups,
    clauses,
    terms: terms.slice(0, 30_000),
    payment: { plan: "monthly" },
  });
  return { content, recipient: { name: str(raw?.recipient?.name, 200), company: str(raw?.recipient?.company, 200), email: str(raw?.recipient?.email, 200) } };
}

export async function proposalFromPdf(buf: Buffer, fallbackBrand: string) {
  let extracted: { text: string; pages: number };
  try { extracted = await pdfText(buf); } catch (e: any) { throw new ImportError(`Couldn't read that PDF: ${String(e?.message ?? e).slice(0, 160)}`); }
  if (extracted.text.replace(/--- page \d+ ---/g, "").trim().length < 200) {
    throw new ImportError("That PDF has almost no readable text (it may be scanned images). Export it from the original document and try again.");
  }
  let answer: { text: string; provider: string };
  try {
    answer = await firstAnswer(SYSTEM, `Proposal text (${extracted.pages} pages):\n\n${extracted.text}`, true, { maxTokens: 16_000, timeoutMs: 240_000 });
  } catch (e: any) { throw new ImportError(`The AI couldn't lay out the proposal: ${String(e?.message ?? e).slice(0, 200)}`, 502); }
  let raw: any;
  try { raw = JSON.parse(answer.text.slice(answer.text.indexOf("{"), answer.text.lastIndexOf("}") + 1)); }
  catch { throw new ImportError("The AI's answer wasn't readable. Please try again.", 502); }
  const out = toContent(raw, fallbackBrand);
  return { ...out, pages: extracted.pages, provider: answer.provider };
}
