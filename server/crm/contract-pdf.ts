/**
 * The signed-contract PDF.
 *
 * Until the client signs there is NO PDF anywhere (the public pages carry a
 * print lockdown); the moment an estimate is approved, portal.ts calls
 * buildContractPdf and the result is stored as a crm_attachments row
 * (kind='contract', refId = estimate id), emailed to the client AND the
 * company admin, and surfaced in the client portal.
 *
 * Layout: company letterhead (text-based — the company name in brand orange
 * stands in for a logo; embedding remote logo images is deliberately skipped),
 * a 'Prepared for' client block, the estimate number/dates, every option with
 * its full description and price, the line items, the client-selected optional
 * discounts, the totals block (subtotal → discounts → tax → APPROVED total),
 * the org's terms (flowing over as many pages as needed), and the signature
 * block with the typed name, date and approval IP. Every page gets the
 * 'company · license · website' band and a 'Page X of Y' number.
 */
import PDFDocument from "pdfkit";

export const BRAND_ORANGE = "#F97316";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const day = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : null);

export type ContractPdfInput = {
  branding: {
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    licenseNumber?: string | null;
    licenseState?: string | null;
  };
  /** The org's own name — the signature is made out to it even when the
   *  letterhead is a division's. */
  orgName: string;
  customer: {
    displayName: string;
    email?: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  };
  estimate: {
    number?: string | null;
    title: string;
    createdAt?: Date | string | null;
    expiresAt?: Date | string | null;
    approvedAt?: Date | string | null;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    approvedTotalCents?: number | null;
    depositCents?: number | null;
    signatureName?: string | null;
    signatureIp?: string | null;
    termsText?: string | null;
    selectedDiscounts?: unknown;
  };
  items: {
    name: string;
    description?: string | null;
    quantityMilli: number;
    unit?: string | null;
    unitPriceCents: number;
    lineTotalCents: number;
  }[];
  options: {
    name: string;
    description?: string | null;
    recommended?: boolean | null;
    totalCents?: number | null;
  }[];
  /** org.termsAndConditions — flows over as many pages as it needs. */
  terms?: string | null;
};

/** The optional discounts the client ticked at signing (label + percent —
 *  the stored SelectionRecord carries no per-offer amount, and inventing one
 *  would put a number on the contract the server never computed). */
export function selectedDiscountDetails(selected: unknown): { label: string; percentBps: number | null }[] {
  if (!Array.isArray(selected)) return [];
  return selected
    .map((d: any) => (typeof d?.label === "string"
      ? { label: d.label as string, percentBps: typeof d?.percentBps === "number" ? d.percentBps as number : null }
      : null))
    .filter((d): d is { label: string; percentBps: number | null } => !!d);
}

/** `contract-E-2001.pdf` — filesystem- and email-safe. */
export function contractFileName(number?: string | null): string {
  const n = String(number ?? "").trim().replace(/[^\w.\-]+/g, "_").slice(0, 60);
  return n ? `contract-${n}.pdf` : "signed-contract.pdf";
}

/**
 * Who gets the admin copy of the signed contract: the org owner(s), falling
 * back to the org record's email. Empty when the org silenced the
 * 'contractSigned' notification pref — the CLIENT copy always sends.
 */
export function contractAdminRecipients(args: {
  prefEnabled: boolean;
  members: { email: string | null; role: string; status: string }[];
  orgEmail?: string | null;
}): string[] {
  if (!args.prefEnabled) return [];
  const owners = args.members
    .filter((m) => m.status === "active" && m.role === "owner" && m.email)
    .map((m) => m.email!);
  const all = owners.length ? owners : args.orgEmail ? [args.orgEmail] : [];
  return [...new Set(all)];
}

export async function buildContractPdf(
  input: ContractPdfInput,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const { branding: b, customer: c, estimate: e } = input;
  const approvedTotal = e.approvedTotalCents ?? e.totalCents;

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 56, bottom: 72, left: 56, right: 56 },
    bufferPages: true, // footers + page numbers are stamped after the content
    compress: opts.compress !== false,
    info: {
      Title: `Signed contract ${e.number ?? ""} — ${b.name}`.trim(),
      Author: b.name,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const rightEdge = doc.page.width - doc.page.margins.right;

  const addressLines = (who: typeof b | typeof c) =>
    [
      [who.addressLine1, who.addressLine2].filter(Boolean).join(", "),
      [who.city, [who.state, who.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    ].filter(Boolean) as string[];

  // ── Letterhead ────────────────────────────────────────────────────────────
  const headerTop = doc.y;
  // Left: the company. The name in brand orange is the text-logo fallback.
  doc.font("Helvetica-Bold").fontSize(20).fillColor(BRAND_ORANGE).text(b.name, left, headerTop, { width: pageWidth * 0.55 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const l of addressLines(b)) doc.text(l, { width: pageWidth * 0.55 });
  const contact = [b.phone, b.email, b.website].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, { width: pageWidth * 0.55 });
  if (b.licenseNumber) {
    doc.text(`License ${b.licenseNumber}${b.licenseState ? ` (${b.licenseState})` : ""}`, { width: pageWidth * 0.55 });
  }

  // Right: the wordmark + document facts.
  const metaX = left + pageWidth * 0.58;
  const metaW = pageWidth * 0.42;
  let my = headerTop;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text("ESTIMATE", metaX, my, { width: metaW, align: "right" });
  my = doc.y + 2;
  const metaLine = (label: string, value: string, bold = false) => {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(label, metaX, my, { width: metaW, align: "right" });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK)
      .text(value, metaX, doc.y, { width: metaW, align: "right" });
    my = doc.y + 4;
  };
  if (e.number) metaLine("Number", e.number, true);
  if (day(e.createdAt)) metaLine("Created", day(e.createdAt)!);
  if (day(e.expiresAt)) metaLine("Valid until", day(e.expiresAt)!);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK)
    .text(money(approvedTotal), metaX, my + 2, { width: metaW, align: "right" });

  doc.y = Math.max(doc.y, my) + 14;
  doc.moveTo(left, doc.y).lineTo(rightEdge, doc.y).lineWidth(1).strokeColor(LINE).stroke();
  doc.moveDown(1.2);

  // ── Prepared for ──────────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("PREPARED FOR", { characterSpacing: 1 });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(c.displayName);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const l of addressLines(c)) doc.text(l);
  if (c.email) doc.text(c.email);
  if (c.phone) doc.text(c.phone);
  doc.moveDown(1.2);

  // ── Title + intro ─────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(e.title);

  // ── Options (good/better/best) — full descriptions, prices when shown ─────
  if (input.options.length) {
    doc.moveDown(0.8);
    for (const o of input.options) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK)
        .text(`${o.name}${o.recommended ? "  (recommended)" : ""}`, { continued: false });
      if (o.description) {
        doc.font("Helvetica").fontSize(9.5).fillColor("#374151").text(o.description);
      }
      if (o.totalCents != null) {
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(money(o.totalCents));
      }
      doc.moveDown(0.5);
    }
  }

  // ── Line items ────────────────────────────────────────────────────────────
  doc.moveDown(0.6);
  const colQty = rightEdge - 220;
  const colPrice = rightEdge - 140;
  const colTotal = rightEdge - 70;
  const rowHeaderY = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  doc.text("ITEM", left, rowHeaderY, { width: colQty - left - 12 });
  doc.text("QTY", colQty, rowHeaderY, { width: 60, align: "right" });
  doc.text("PRICE", colPrice, rowHeaderY, { width: 60, align: "right" });
  doc.text("TOTAL", colTotal, rowHeaderY, { width: 70, align: "right" });
  doc.moveTo(left, doc.y + 2).lineTo(rightEdge, doc.y + 2).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.y += 8;

  for (const i of input.items) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(i.name, left, y, { width: colQty - left - 12 });
    if (i.description) {
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(i.description, left, doc.y, { width: colQty - left - 12 });
    }
    const nameBottom = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(INK);
    doc.text(`${qty(i.quantityMilli)}${i.unit ? ` ${i.unit}` : ""}`, colQty, y, { width: 60, align: "right" });
    doc.text(money(i.unitPriceCents), colPrice, y, { width: 60, align: "right" });
    doc.font("Helvetica-Bold").text(money(i.lineTotalCents), colTotal, y, { width: 70, align: "right" });
    doc.y = Math.max(nameBottom, doc.y) + 6;
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  doc.moveDown(0.4);
  const totalsX = rightEdge - 220;
  const totalRow = (label: string, value: string, opts2: { bold?: boolean; big?: boolean; negative?: boolean } = {}) => {
    const y = doc.y;
    doc.font(opts2.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts2.big ? 12 : 9.5)
      .fillColor(opts2.bold ? INK : MUTED).text(label, totalsX, y, { width: 140 });
    // ASCII '-' only — the PDF core fonts are WinAnsi; U+2212 renders as '('.
    doc.font(opts2.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts2.big ? 12 : 9.5).fillColor(INK)
      .text(`${opts2.negative ? "-" : ""}${value}`, totalsX + 140, y, { width: 80, align: "right" });
    doc.moveDown(0.35);
  };
  totalRow("Subtotal", money(e.subtotalCents));
  if (e.discountCents > 0) totalRow("Discount", money(e.discountCents), { negative: true });
  const selected = selectedDiscountDetails(e.selectedDiscounts);
  for (const d of selected) {
    totalRow(`Optional discount — ${d.label}${d.percentBps != null ? ` (-${(d.percentBps / 100).toLocaleString("en-US")}%)` : ""}`, "");
  }
  if (e.taxCents > 0) totalRow("Tax", money(e.taxCents));
  doc.moveTo(totalsX, doc.y).lineTo(rightEdge, doc.y).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.moveDown(0.3);
  totalRow("Approved total", money(approvedTotal), { bold: true, big: true });
  if (e.depositCents) totalRow("Deposit due", money(e.depositCents));

  // ── Terms: the estimate's own terms first, then the org's standing ones ───
  const termsBlocks: [string, string][] = [];
  if (e.termsText?.trim()) termsBlocks.push(["Estimate terms", e.termsText.trim()]);
  if (input.terms?.trim()) termsBlocks.push(["Terms and conditions", input.terms.trim()]);
  for (const [heading, body] of termsBlocks) {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(heading);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(8.5).fillColor("#374151").text(body, { lineGap: 1.5 });
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  doc.moveDown(1.6);
  const signedOn = day(e.approvedAt) ?? day(new Date())!;
  doc.moveTo(left, doc.y).lineTo(rightEdge, doc.y).lineWidth(1).strokeColor(LINE).stroke();
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(11).fillColor(INK)
    .text(`Signed by `, { continued: true })
    .font("Helvetica-BoldOblique").fontSize(13)
    .text(e.signatureName ?? "", { continued: true })
    .font("Helvetica").fontSize(11)
    .text(` on ${signedOn} · ${input.orgName}`);
  if (e.signatureIp) {
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Approval IP: ${e.signatureIp}`);
  }

  // ── Footer band + page numbers on EVERY page ──────────────────────────────
  const footerBits = [
    b.name,
    b.licenseNumber ? `License ${b.licenseNumber}${b.licenseState ? ` (${b.licenseState})` : ""}` : null,
    b.website,
  ].filter(Boolean).join("  ·  ");
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(range.start + p);
    const y = doc.page.height - 48;
    doc.moveTo(left, y - 8).lineTo(rightEdge, y - 8).lineWidth(0.75).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(footerBits, left, y, { width: pageWidth - 90, align: "left", lineBreak: false });
    doc.text(`Page ${p + 1} of ${range.count}`, rightEdge - 90, y, { width: 90, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
