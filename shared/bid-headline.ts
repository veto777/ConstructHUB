/**
 * The per-org BID HEADLINE — a banner every estimate opens with, above the
 * scopes and the line items (e.g. a warranty claim the contractor wants on
 * every bid). Stored in crm_orgs.custom_fields.bidHeadline as
 * { title, subline }; set in Settings → Estimate & invoice defaults.
 *
 * An org without one shows nothing new: every reader goes through
 * bidHeadlineFromCustomFields, which returns null for a missing, blank or
 * malformed value.
 *
 * Like the warranty text and terms, the headline is copied onto each NEW
 * estimate (doc-defaults.ts → crm_estimates.bid_headline) and only that copy
 * prints. An estimate created before the org set or changed its headline
 * keeps what it had (usually none): an old bid never gains a claim its own
 * warranty text doesn't back.
 *
 * The subline is where a conditional claim discloses its limits ("limited
 * lifetime … see warranty terms"), right under the claim, at a readable size.
 */

export const BID_HEADLINE_TITLE_MAX = 160;
export const BID_HEADLINE_SUBLINE_MAX = 400;

export type BidHeadline = { title: string; subline: string | null };

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** A stored or submitted headline as the documents print it — null when there is no title. */
export function normalizeBidHeadline(v: unknown): BidHeadline | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const title = clean(o.title, BID_HEADLINE_TITLE_MAX);
  if (!title) return null;
  return { title, subline: clean(o.subline, BID_HEADLINE_SUBLINE_MAX) };
}

/** The org's headline, from crm_orgs.custom_fields. */
export function bidHeadlineFromCustomFields(customFields: unknown): BidHeadline | null {
  if (!customFields || typeof customFields !== "object") return null;
  return normalizeBidHeadline((customFields as Record<string, unknown>).bidHeadline);
}

/** The anchor the warranty section carries on the client's estimate page. */
export const WARRANTY_ANCHOR = "warranty";

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The headline as inline-styled email HTML (mail clients drop <style>).
 * `warrantyHref` links the "full warranty" line to the estimate's warranty
 * section; omitted when the estimate has no warranty text.
 */
export function bidHeadlineEmailHtml(
  h: BidHeadline,
  opts: { accentHex: string; warrantyHref?: string | null },
): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(opts.accentHex) ? opts.accentHex : "#F97316";
  return `
        <div style="border:2px solid ${accent};border-radius:10px;padding:16px 18px;margin:0 0 22px;text-align:center">
          <p style="font-size:20px;font-weight:800;line-height:1.25;margin:0;color:#111827">${escHtml(h.title)}</p>
          ${h.subline ? `<p style="font-size:14px;line-height:1.45;margin:8px 0 0;color:#374151">${escHtml(h.subline)}</p>` : ""}
          ${opts.warrantyHref ? `<p style="font-size:13px;margin:8px 0 0"><a href="${escHtml(opts.warrantyHref)}" style="color:#2563eb">Read the full warranty</a></p>` : ""}
        </div>`;
}
