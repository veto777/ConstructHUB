/**
 * An estimate line's Item field that searches the price book as you type (or on focus) and fills the line from the
 * picked item: name, unit, scope text, taxable and the unit price — a computed assembly is priced for one unit by the
 * server, like the full builder (pages/crm-estimate-new.tsx). Typing anything else keeps a free-text line.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

export type PickedPricebookItem = {
  id: string; name: string; unit: string | null; description: string; taxable: boolean; unitPriceCents: number;
};

export function PricebookItemInput({ value, onChange, onPick, placeholder, testId }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (item: PickedPricebookItem) => void;
  placeholder?: string;
  testId?: string;
}) {
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
  const { data, isLoading } = useQuery<any[]>({
    queryKey: [`/api/crm/pricebook/items${q ? `?q=${encodeURIComponent(q)}` : ""}`],
    enabled: open,
  });
  const items = (data ?? []).slice(0, 8);

  const pick = async (item: any) => {
    setBusy(item.id);
    try {
      let price: number | null = item.flatPriceCents ?? null;
      if (price == null) {
        const r = await apiRequest("POST", `/api/crm/pricebook/items/${item.id}/preview`, { quantityMilli: 1000 });
        price = (await r.json()).totalPriceCents ?? 0;
      }
      onPick({ id: item.id, name: item.name, unit: item.unit ?? null, description: item.description ?? "", taxable: item.taxable ?? true, unitPriceCents: price ?? 0 });
      setOpen(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative" ref={box}>
      <Input value={value} placeholder={placeholder} onFocus={() => setOpen(true)} data-testid={testId}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} autoComplete="off" />
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
