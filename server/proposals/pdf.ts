/**
 * The signed copy of a proposal — the service agreement, laid out like the CRM's signed contract
 * (server/crm/contract-pdf.ts): letterhead, who it is for and from, every selected service with its full
 * description and scope and price, the totals and payment schedule, the terms flowing over as many pages as they
 * need, the signature (the drawn image when there is one, else the typed name) with the audit trail (time, IP,
 * browser, the consent text), and "Page X of Y" on every page. Built on demand from the stored row, which is
 * locked once signed — nothing is kept but the data it is made from.
 */
import PDFDocument from "pdfkit";
import { ALL_TERMS_ID, autoPayMonths, cardFeeCents, formatBps, formatMoney, type ProposalContent, type ProposalTotals } from "@shared/proposals";

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
  signature: {
    name: string; title?: string; imageDataUrl?: string | null; signedAt: string; ip?: string | null; userAgent?: string | null; consent: string;
    /** The client's initials and when each clause was initialed. */
    initials?: string; initialed?: { id: string; at: string }[];
  };
  payment?: { method: "ach" | "card" | null; status: string | null; paidAt: string | null };
  /** The preview's copy: marked on every page, nothing was signed. */
  preview?: boolean;
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
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("SERVICE AGREEMENT", 54, 32, { width: W, align: "right" });
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
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("SERVICES AND SCOPE OF WORK");
    doc.moveDown(0.3); rule();
    const items = new Map(p.content.groups.flatMap((g) => g.items.map((i) => [i.id, i] as const)));
    for (const l of p.totals.lines) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      const y = doc.y;
      const price = l.billing === "monthly" ? `${money(l.priceCents)}/mo × ${l.termMonths}` : money(l.priceCents);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(l.name, 54, y, { width: W - 170 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(l.groupName, 54, doc.y, { width: W - 170 });
      const yEnd = doc.y;
      doc.fillColor(INK).font("Helvetica").fontSize(10).text(price, 54 + W - 165, y, { width: 165, align: "right" });
      doc.y = Math.max(yEnd, doc.y) + 2; doc.x = 54;
      const item = items.get(l.itemId);
      if (item?.description.trim()) doc.fillColor(INK).font("Helvetica").fontSize(9).text(item.description.trim(), 54, doc.y, { width: W - 20, lineGap: 1 });
      for (const b of item?.bullets ?? []) doc.fillColor(INK).font("Helvetica").fontSize(9).text(`•  ${b}`, 64, doc.y, { width: W - 30, lineGap: 1 });
      doc.y += 4; doc.x = 54;
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
    row("Sales tax", "$0.00 — professional services");
    if (p.totals.discountCents) row(`Pay-in-full discount (${formatBps(p.totals.discountBps ?? 0)})`, `−${money(p.totals.discountCents)}`);
    row("Contract total (full term)", money(p.totals.contractTotalCents), true);
    doc.moveDown(0.3);
    row("Payment plan", p.totals.plan === "monthly" ? "First payment today, then monthly" : "Paid in full today");
    row("Due today (bank transfer / ACH)", money(p.totals.dueTodayCents), true);
    const bps = p.content.payment.cardFeeBps;
    if (p.content.payment.cardEnabled && bps > 0) {
      row(`Due today by card (incl. ${formatBps(bps)} card fee)`, money(p.totals.dueTodayCents + cardFeeCents(p.totals.dueTodayCents, bps)));
    }
    const autoMonths = autoPayMonths(p.content, p.totals);
    if (p.totals.recurringCents) row("Then each month (auto-pay)", `${money(p.totals.recurringCents)}${autoMonths ? ` for ${autoMonths - 1} more month(s)` : " until cancelled"}`);
    if (p.payment?.method) {
      row("Paid by", p.payment.method === "ach" ? "Bank transfer (ACH)" : "Card");
      if (p.payment.paidAt) row("Payment status", `${p.payment.status ?? "paid"} · ${new Date(p.payment.paidAt).toUTCString()}`);
    }

    if (p.content.clauses.length) {
      doc.moveDown(1);
      const when = new Map((p.signature.initialed ?? []).map((x) => [x.id, x.at]));
      const once = p.content.clauseInitials !== "each";
      const box = (x: number, y: number, at: string | undefined) => {
        doc.roundedRect(x, y, 78, 30, 3).dash(2, { space: 2 }).strokeColor(accent).lineWidth(0.8).stroke().undash();
        doc.fillColor(INK).font("Times-Italic").fontSize(14).text(at ? p.signature.initials ?? "" : "", x, y + 3, { width: 78, align: "center" });
        doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(at ? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "not initialed", x, y + 20, { width: 78, align: "center" });
      };
      if (doc.y > doc.page.height - 160) doc.addPage();
      const yHead = doc.y;
      doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text(once ? "PROGRAM TERMS — ACCEPTED WITH ONE INITIAL" : "PROGRAM TERMS — INITIALED BY THE CLIENT", 54, yHead, { width: W - 90 });
      if (once && p.content.clauses.some((c) => c.initials)) {
        doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("The client initialed once to accept all of the terms below.", 54, doc.y, { width: W - 90 });
        box(54 + W - 78, yHead, when.get(ALL_TERMS_ID));
        doc.y = Math.max(doc.y, yHead + 34);
      }
      doc.moveDown(0.3);
      for (const c of p.content.clauses) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        const y = doc.y;
        const textW = once ? W : W - 90;
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(c.heading, 54, y, { width: textW });
        if (c.body.trim()) doc.fillColor(INK).font("Helvetica").fontSize(9).text(c.body.trim(), 54, doc.y, { width: textW, lineGap: 1 });
        const yEnd = doc.y;
        if (c.initials && !once) box(54 + W - 78, y, when.get(c.id));
        doc.y = (once ? yEnd : Math.max(yEnd, y + 34)) + 6; doc.x = 54;
      }
    }

    if (p.content.terms.trim()) {
      doc.moveDown(1);
      doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("TERMS AND CONDITIONS");
      doc.moveDown(0.3);
      doc.fillColor(INK).font("Helvetica").fontSize(9).text(p.content.terms.trim(), { width: W, lineGap: 2 });
    }

    doc.moveDown(1.2);
    if (doc.y > doc.page.height - 260) doc.addPage();
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(10).text("ACCEPTED AND SIGNED");
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
      if (p.preview) {
        doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] }).fillColor("#dc2626").opacity(0.12).font("Helvetica-Bold").fontSize(80)
          .text("PREVIEW", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false }).restore();
        doc.opacity(1);
      }
      doc.fillColor(MUTED).font("Helvetica").fontSize(8)
        .text(`${p.preview ? "PREVIEW — not signed · " : ""}${p.content.brand.name}${p.content.brand.website ? ` · ${p.content.brand.website}` : ""} · Proposal #${p.id} · Page ${i + 1} of ${range.count}`,
          54, doc.page.height - 40, { width: W, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
