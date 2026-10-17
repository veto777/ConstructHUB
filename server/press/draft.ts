/**
 * The one draft code path (routes.ts POST /api/press/releases/:id/draft and autopilot.ts): the writer drafts, or
 * revises to notes, the dateline is filled, and the guideline check runs on the result. Nothing here changes a
 * release's status or touches a credit.
 */
import { z } from "zod";
import { PRESS_NEWS_TYPES, type PressReleaseText } from "@shared/press";
import { checkRelease } from "./guidelines";
import * as store from "./store";
import { datelineFor, draftRelease, reviseRelease } from "./writer";

const text = (max: number) => z.string().trim().max(max);
/** What the customer fills in (shared/press.ts PressReleaseInput). */
export const pressInputSchema = z.object({
  newsType: z.enum(PRESS_NEWS_TYPES.map((t) => t.key) as [string, ...string[]]),
  companyName: text(120).min(2, "Company name is required"),
  website: text(300).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Website must start with http:// or https://"),
  city: text(80).min(2, "City is required"),
  state: text(40).min(2, "State is required"),
  contactName: text(120).min(2, "Media contact name is required"),
  contactEmail: text(200).email("A valid media contact email is required"),
  contactPhone: text(40),
  details: text(6000).min(80, "Tell us what happened in at least a few sentences (80 characters or more)"),
  spokesperson: text(120),
  spokespersonTitle: text(120),
  quoteNotes: text(2000),
  about: text(3000),
  photos: z.array(z.object({ key: text(300), url: text(500), caption: text(200) })).max(6).default([]),
}).strict();

/** Swappable in tests (the writer calls an AI provider). */
export const draftDeps = { draftRelease, reviseRelease };

/** Writes (or, with notes and a text, revises) the release and stores the text and its guideline issues. */
export async function writeDraft(row: store.ReleaseRow, notes?: string): Promise<store.ReleaseRow> {
  const want = notes?.trim() ?? "";
  const t: PressReleaseText = want && row.text ? await draftDeps.reviseRelease(row.input, row.text, want, row.tier) : await draftDeps.draftRelease(row.input, row.tier);
  if (!t.dateline) t.dateline = datelineFor(row.input.city, row.input.state);
  const issues = checkRelease(t, row.input);
  // Guarded on an editable status: a draft approved (or auto-sent) while the writer was busy keeps what was approved.
  const upd = await store.updateEditable(row.id, { text: t, issues });
  if (!upd) throw new store.NotEditableError();
  return upd;
}
