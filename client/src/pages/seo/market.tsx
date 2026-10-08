/**
 * Which country the Site Explorer and Keywords Explorer look at. One choice
 * for both, remembered on this device; United States until changed.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_MARKET, SEO_MARKETS, findMarket, marketKey, type SeoMarket } from "@shared/seo-markets";

const KEY = "seo.market";
const listeners = new Set<() => void>();
function stored(): string {
  try {
    const [code, lang] = (window.localStorage.getItem(KEY) ?? "").split(":");
    const m = findMarket(Number(code), lang);
    return marketKey(m ?? DEFAULT_MARKET);
  } catch { return marketKey(DEFAULT_MARKET); }
}
let current = stored();
function choose(m: SeoMarket) {
  current = marketKey(m);
  try { window.localStorage.setItem(KEY, current); } catch { /* private window: the choice lasts for this visit */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useMarket(): [SeoMarket, (m: SeoMarket) => void] {
  const key = useSyncExternalStore(subscribe, () => current);
  const [code, lang] = key.split(":");
  return [findMarket(Number(code), lang) ?? DEFAULT_MARKET, choose];
}

export function MarketPicker({ value, onChange, disabled }: { value: SeoMarket; onChange: (m: SeoMarket) => void; disabled?: boolean }) {
  return (
    <label className="shrink-0">
      <span className="sr-only">Country</span>
      <select className="g-input g-select !w-auto" value={marketKey(value)} disabled={disabled} data-testid="select-market"
        onChange={(e) => { const m = SEO_MARKETS.find((x) => marketKey(x) === e.target.value); if (m) onChange(m); }}>
        {SEO_MARKETS.map((m) => <option key={marketKey(m)} value={marketKey(m)}>{m.label}</option>)}
      </select>
    </label>
  );
}
