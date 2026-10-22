/** Prorate cents, not thousandths of a unit: a small quantity can still
 * represent an expensive line, so rounding its quantity can lose dollars. */
export type InvoiceSourceLine = {
  kind: string; name: string; description: string | null; unit: string | null;
  unitPriceCents: number; quantityMilli: number; taxable: boolean;
};

export function progressInvoiceItems(
  items: InvoiceSourceLine[], percentBps: number, optionalDiscountCents: number,
): InvoiceSourceLine[] {
  const rows = items.map((i) => percentBps === 10000 ? { ...i } : {
    ...i,
    description: [i.description,
      `${percentBps / 100}% progress billing of ${i.quantityMilli / 1000} ${i.unit || "units"} at $${(i.unitPriceCents / 100).toFixed(2)}.`,
    ].filter(Boolean).join("\n"),
    unit: null,
    quantityMilli: 1000,
    unitPriceCents: Math.round(Math.round(i.unitPriceCents * i.quantityMilli / 1000) * percentBps / 10000),
  });
  const discount = Math.round(optionalDiscountCents * percentBps / 10000);
  if (discount > 0) rows.push({
    kind: "discount", name: "Accepted estimate discounts", description: null,
    unit: null, quantityMilli: 1000, unitPriceCents: discount, taxable: true,
  });
  return rows;
}

/** An invoice's total from its lines: subtotal − discounts + tax on the taxable part after discounts (recalcInvoice's math). */
export function invoiceLinesTotalCents(lines: InvoiceSourceLine[], taxRateBps: number): number {
  let subtotal = 0, taxable = 0, discount = 0;
  for (const i of lines) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { discount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const tax = Math.round((Math.max(0, taxable - discount) * (taxRateBps || 0)) / 10000);
  return Math.max(0, subtotal - discount + tax);
}

/**
 * A payment request bills what the client pays, tax included: nudge the
 * largest billed line (progress lines are quantity 1) until the invoice total
 * lands on `targetCents`. Tax rounding can make a cent unreachable on a taxed
 * line; it then stops at the closest total, never more than a cent away.
 */
export function squareDrawToTotal(lines: InvoiceSourceLine[], taxRateBps: number, targetCents: number): void {
  const biggest = lines.filter((l) => l.kind !== "discount").sort((a, b) => b.unitPriceCents - a.unitPriceCents)[0];
  if (!biggest || biggest.quantityMilli !== 1000) return;
  let best = { price: biggest.unitPriceCents, off: Math.abs(targetCents - invoiceLinesTotalCents(lines, taxRateBps)) };
  for (let k = 0; k < 8 && best.off > 0; k++) {
    const diff = targetCents - invoiceLinesTotalCents(lines, taxRateBps);
    if (diff === 0) return;
    const step = biggest.taxable ? Math.round((diff * 10000) / (10000 + (taxRateBps || 0))) : diff;
    biggest.unitPriceCents = Math.max(0, biggest.unitPriceCents + (step === 0 ? Math.sign(diff) : step));
    const off = Math.abs(targetCents - invoiceLinesTotalCents(lines, taxRateBps));
    if (off < best.off) best = { price: biggest.unitPriceCents, off };
  }
  biggest.unitPriceCents = best.price;
}
