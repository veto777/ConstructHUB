/**
 * An estimate line's Item field that searches the price book as you type (or on focus) and fills the line from the
 * picked item: name, unit, scope text, taxable and the unit price — a computed assembly is priced for one unit by the
 * server, like the full builder (pages/crm-estimate-new.tsx). Typing anything else keeps a free-text line.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type PickedPricebookItem = {
  id: string; name: string; unit: string | null; description: string; taxable: boolean; unitPriceCents: number;
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
    queryKey: ["/api/crm/pricebook/items", { q }],
    queryFn: async () => {
      const r = await fetch(`/api/crm/pricebook/items${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: open,
  });
  const items = (data ?? []).slice(0, 8);

  const pick = async (item: any) => {
    setBusy(item.id);
    try {
      let price: number | null = item.flatPriceCents ?? null;
      const qty = quantityFor?.({ name: item.name, unit: item.unit ?? null }) ?? null;
      if (price == null) {
        const q = qty && qty > 0 ? qty : 1;
        const r = await apiRequest("POST", `/api/crm/pricebook/items/${item.id}/preview`, { quantityMilli: Math.round(q * 1000) });
        const total = Number((await r.json()).totalPriceCents ?? 0);
        price = Math.round(total / q);
      }
      onPick({ id: item.id, name: item.name, unit: item.unit ?? null, description: item.description ?? "", taxable: item.taxable ?? true, unitPriceCents: price ?? 0 });
      setOpen(false);
    } catch (e) {
      toast({ title: "Could not price that item", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
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
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">From your price book</p>
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
              <span className="shrink-0 text-xs text-muted-foreground">
                {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : it.flatPriceCents != null ? `$${(it.flatPriceCents / 100).toLocaleString()}${it.unit ? ` / ${it.unit}` : ""}` : it.unit ? `per ${it.unit}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
