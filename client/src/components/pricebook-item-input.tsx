/**
 * An estimate line's Item field that searches the price book as you type (or on focus) and fills the line from the
 * picked item: name, unit, scope text, taxable and the unit price — a computed assembly is priced for one unit by the
 * server, like the full builder (pages/crm-estimate-new.tsx). Typing anything else keeps a free-text line.
 *
 * Price-book memory (shared/pricebook-usage.ts): the list comes most-used first (sort=usage; while typing, text
 * relevance first), and an item the org has billed before prefills the LAST price and scope it was billed with —
 * "$16.50 last used · $25 list" in the list. The list price itself is never changed here.
 * Used by the New-estimate popup (crm-client.tsx) and the full-page editor (crm-estimate-detail.tsx).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { lastUsedLabel, prefillPrice } from "@shared/pricebook-usage";
import { categoryFromText, type ScopeCategory } from "@shared/scope-category";

export type PickedPricebookItem = {
  id: string; name: string; unit: string | null; description: string; taxable: boolean; unitPriceCents: number;
  /** The item's list price for one unit (null when it is computed per job). */
  listPriceCents: number | null;
  /** Which price-book field holds that list price ("Update price book" writes it). */
  listField: "flatPriceCents" | "rateCentsPerSqft" | null;
  /** True when the price/scope came from the last time this item was billed. */
  fromLastUse: boolean;
  /** Scope category from the item's price-book category, else its name. */
  scopeCategory: ScopeCategory;
};

const listPriceOf = (item: any): { cents: number | null; field: PickedPricebookItem["listField"] } => {
  if (item.pricingMode === "per_sqft" && item.rateCentsPerSqft != null) return { cents: item.rateCentsPerSqft, field: "rateCentsPerSqft" };
  if (item.flatPriceCents != null) return { cents: item.flatPriceCents, field: "flatPriceCents" };
  return { cents: null, field: null };
};

export function PricebookItemInput({ value, onChange, onPick, quantityFor, placeholder, testId }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (item: PickedPricebookItem) => void;
  /** The quantity the line will carry (from the HOVER takeoff), so a computed item is priced for it — a minimum
   *  charge or a quantity break lands on the line's total, never on the per-unit price. */
  quantityFor?: (item: { name: string; unit: string | null }) => number | null;
  placeholder?: string;
  testId?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setQ(value.trim()), 200); return () => clearTimeout(t); }, [value]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  // Keyed under the price book's own list key, so a price-book save refreshes these results too.
  const { data, isLoading, isError } = useQuery<any[]>({
    queryKey: ["/api/crm/pricebook/items", { q, sort: "usage" }],
    queryFn: async () => {
      const qs = new URLSearchParams({ sort: "usage" });
      if (q) qs.set("q", q);
      const r = await fetch(`/api/crm/pricebook/items?${qs}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: open,
  });
  const items = (data ?? []).slice(0, 8);

  const pick = async (item: any) => {
    setBusy(item.id);
    try {
      const list = listPriceOf(item);
      let listPrice: number | null = item.flatPriceCents ?? null;
      const qty = quantityFor?.({ name: item.name, unit: item.unit ?? null }) ?? null;
      if (listPrice == null && item.pricingMode !== "per_sqft") {
        const q = qty && qty > 0 ? qty : 1;
        const r = await apiRequest("POST", `/api/crm/pricebook/items/${item.id}/preview`, { quantityMilli: Math.round(q * 1000) });
        const total = Number((await r.json()).totalPriceCents ?? 0);
        listPrice = Math.round(total / q);
      } else if (listPrice == null) {
        listPrice = list.cents;
      }
      const usage = { useCount: item.useCount, lastPriceCents: item.lastPriceCents };
      const price = prefillPrice(listPrice, usage) ?? 0;
      const fromLastUse = (item.useCount ?? 0) > 0 && item.lastPriceCents != null;
      const catFromBook = item.categoryName ? categoryFromText(item.categoryName) : "other";
      onPick({
        id: item.id, name: item.name,
        unit: (fromLastUse && item.lastUnit) || (item.unit ?? null),
        description: (fromLastUse && item.lastDescription) || (item.description ?? ""),
        taxable: item.taxable ?? true, unitPriceCents: price,
        listPriceCents: list.cents ?? listPrice, listField: list.field, fromLastUse,
        scopeCategory: catFromBook !== "other" ? catFromBook : categoryFromText(item.name),
      });
      setOpen(false);
    } catch (e) {
      toast({ title: "Could not price that item", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const priceText = (it: any) => {
    const list = listPriceOf(it);
    const last = lastUsedLabel(list.cents, { useCount: it.useCount, lastPriceCents: it.lastPriceCents }, it.pricingMode === "per_sqft" ? "sf" : it.unit);
    if (last) return last;
    if (list.cents != null) return `$${(list.cents / 100).toLocaleString()}${it.pricingMode === "per_sqft" ? " / sf" : it.unit ? ` / ${it.unit}` : ""}`;
    return it.unit ? `per ${it.unit}` : "";
  };

  return (
    <div className="relative" ref={box}>
      <Input value={value} placeholder={placeholder} onFocus={() => setOpen(true)} data-testid={testId}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} autoComplete="off" />
      {open && isError && !isLoading && (
        <div className="absolute z-50 mt-1 w-full min-w-[18rem] rounded-md border bg-popover p-2 text-xs text-destructive shadow-lg" data-testid={testId ? `${testId}-error` : undefined}>
          The price book did not answer. <button type="button" className="font-medium underline" onClick={() => setQ((v) => v + "")}>Try again</button>
        </div>
      )}
      {open && (isLoading || items.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-72 w-full min-w-[18rem] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg" data-testid={testId ? `${testId}-options` : undefined}>
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">From your price book · most used first</p>
          {isLoading ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : items.map((it) => (
            <button key={it.id} type="button" onClick={() => pick(it)} disabled={!!busy}
              className="flex w-full items-start justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-muted"
              data-testid={`option-pricebook-${it.id}`}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{it.name}</span>
                {it.description && <span className="block truncate text-xs text-muted-foreground">{it.description}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground text-right" data-testid={`text-pricebook-price-${it.id}`}>
                {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : priceText(it)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
