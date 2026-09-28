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
