/**
 * The signed copy of a proposal: what the recipient chose, the totals, the payment schedule, the terms, the
 * signature (the drawn image when there is one, else the typed name) and the audit trail (time, IP, browser,
 * the consent text). Built on demand from the stored row — nothing is kept but the data it is made from.
 */
import PDFDocument from "pdfkit";
import { cardFeeCents, formatBps, formatMoney, type ProposalContent, type ProposalTotals } from "@shared/proposals";

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

export type SignedPdfInput = {
  id: number;
  content: ProposalContent;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientCompany: string | null;
  totals: ProposalTotals;
  signature: { name: string; title?: string; imageDataUrl?: string | null; signedAt: string; ip?: string | null; userAgent?: string | null; consent: string };
  payment?: { method: "ach" | "card" | null; status: string | null; paidAt: string | null };
};

const money = (c: number) => formatMoney(c, { cents: true });

export function buildSignedProposalPdf(p: SignedPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true, info: { Title: p.content.title || "Proposal" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const accent = p.content.brand.accent || "#F97316";
    const W = doc.page.width - 108;

    doc.rect(0, 0, doc.page.width, 6).fill(accent);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(p.content.brand.name.toUpperCase(), 54, 30);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("SIGNED PROPOSAL", 54, 32, { width: W, align: "right" });
    doc.moveDown(2);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(p.content.title || "Proposal", { width: W });
    if (p.content.subtitle) doc.moveDown(0.3).fillColor(MUTED).font("Helvetica").fontSize(11).text(p.content.subtitle, { width: W });
    doc.moveDown(1);

    const who = [p.recipientName, p.recipientCompany, p.recipientEmail].filter(Boolean).join(" · ");
    doc.fillColor(MUTED).fontSize(9).text("PREPARED FOR", { continued: false });
    doc.fillColor(INK).fontSize(11).text(who || "—");
    doc.moveDown(0.5);
    const by = [p.content.brand.contactName, p.content.brand.name, p.content.brand.contactEmail].filter(Boolean).join(" · ");
    doc.fillColor(MUTED).fontSize(9).text("PREPARED BY");
    doc.fillColor(INK).fontSize(11).text(by);
    doc.moveDown(1.2);

    const rule = () => { const y = doc.y; doc.moveTo(54, y).lineTo(54 + W, y).strokeColor(LINE).lineWidth(1).stroke(); doc.moveDown(0.4); };
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("SELECTED SERVICES");
    doc.moveDown(0.3); rule();
    for (const l of p.totals.lines) {
      const y = doc.y;
      const price = l.billing === "monthly" ? `${money(l.priceCents)}/mo × ${l.termMonths}` : money(l.priceCents);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(l.name, 54, y, { width: W - 170 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(l.groupName, 54, doc.y, { width: W - 170 });
      const yEnd = doc.y;
      doc.fillColor(INK).font("Helvetica").fontSize(10).text(price, 54 + W - 165, y, { width: 165, align: "right" });
      doc.y = Math.max(yEnd, doc.y) + 4; doc.x = 54;
      rule();
    }
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.fillColor(bold ? INK : MUTED).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(label, 54, y, { width: W - 170 });
      doc.fillColor(INK).text(value, 54 + W - 165, y, { width: 165, align: "right" });
      doc.x = 54; doc.moveDown(0.25);
    };
    doc.moveDown(0.3);
    if (p.totals.oneTimeCents) row("One-time services", money(p.totals.oneTimeCents));
    if (p.totals.monthlyCents) row("Monthly services", `${money(p.totals.monthlyCents)} / month`);
    row("Contract total (full term)", money(p.totals.contractTotalCents), true);
    doc.moveDown(0.3);
    row("Payment plan", p.totals.plan === "monthly" ? "First payment today, then monthly" : "Paid in full today");
    row("Due today (bank transfer / ACH)", money(p.totals.dueTodayCents), true);
    const bps = p.content.payment.cardFeeBps;
    if (p.content.payment.cardEnabled && bps > 0) {
      row(`Due today by card (incl. ${formatBps(bps)} card fee)`, money(p.totals.dueTodayCents + cardFeeCents(p.totals.dueTodayCents, bps)));
    }
    if (p.totals.recurringCents) row("Then each month", `${money(p.totals.recurringCents)}${p.content.payment.endAfterMonths ? ` for ${p.content.payment.endAfterMonths - 1} more month(s)` : ""}`);
    if (p.payment?.method) {
      row("Paid by", p.payment.method === "ach" ? "Bank transfer (ACH)" : "Card");
      if (p.payment.paidAt) row("Payment status", `${p.payment.status ?? "paid"} · ${new Date(p.payment.paidAt).toUTCString()}`);
    }

    if (p.content.terms.trim()) {
      doc.moveDown(1);
      doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("TERMS");
      doc.moveDown(0.3);
      doc.fillColor(INK).font("Helvetica").fontSize(9).text(p.content.terms.trim(), { width: W, lineGap: 2 });
    }

    doc.moveDown(1.2);
    if (doc.y > doc.page.height - 260) doc.addPage();
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("SIGNATURE");
    doc.moveDown(0.4);
    const img = p.signature.imageDataUrl && /^data:image\/png;base64,/.test(p.signature.imageDataUrl)
      ? Buffer.from(p.signature.imageDataUrl.split(",")[1], "base64") : null;
    if (img) {
      try { doc.image(img, 54, doc.y, { fit: [240, 80] }); doc.y += 84; } catch { /* unreadable image: the typed name stands */ }
    } else {
      doc.fillColor(INK).font("Times-Italic").fontSize(24).text(p.signature.name);
    }
    doc.moveTo(54, doc.y).lineTo(300, doc.y).strokeColor(INK).lineWidth(0.7).stroke();
    doc.moveDown(0.3);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(`${p.signature.name}${p.signature.title ? `, ${p.signature.title}` : ""}`);
    doc.fillColor(MUTED).fontSize(8.5)
      .text(`Signed electronically ${new Date(p.signature.signedAt).toUTCString()}${p.signature.ip ? ` from IP ${p.signature.ip}` : ""}`)
      .text(p.signature.userAgent ? `Browser: ${p.signature.userAgent.slice(0, 160)}` : "")
      .moveDown(0.3)
      .text(`Consent: “${p.signature.consent}”`, { width: W });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would start a new page: lift the margin for the footer line.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font("Helvetica").fontSize(8)
        .text(`${p.content.brand.name}${p.content.brand.website ? ` · ${p.content.brand.website}` : ""} · Proposal #${p.id} · Page ${i + 1} of ${range.count}`,
          54, doc.page.height - 40, { width: W, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
