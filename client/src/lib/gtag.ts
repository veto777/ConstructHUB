/**
 * Google Ads / GA4 events from the app. The tag itself is added to the page by
 * the server (server/google-tag.ts) when GOOGLE_TAG_IDS is set; without it every
 * call here is a no-op. A conversion fires once per browser session per kind,
 * so a refresh of /pricing?success=true cannot count twice.
 */
type ConversionKind = "signup" | "purchase" | "crm_purchase" | "call_assistant_purchase" | "alacarte_purchase";
type GtagConfig = { ids: string[]; conversions: Partial<Record<ConversionKind, string | null>> };

const gtag = (...args: unknown[]) => {
  const fn = (window as any).gtag;
  if (typeof fn === "function") fn(...args);
};
const config = (): GtagConfig | null => (typeof window === "undefined" ? null : (window as any).__CH_GTAG ?? null);

export function trackConversion(kind: ConversionKind, params: { value?: number; currency?: string } = {}) {
  const cfg = config();
  if (!cfg) return;
  try {
    const key = `ch_conv_${kind}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* storage blocked: still report */ }
  const sendTo = cfg.conversions?.[kind];
  if (sendTo) gtag("event", "conversion", { send_to: sendTo, ...(params.value ? { value: params.value, currency: params.currency ?? "USD" } : {}) });
  // GA4's own names, for a G- property on the same tag.
  gtag("event", kind === "signup" ? "sign_up" : "purchase", { ...(params.value ? { value: params.value, currency: params.currency ?? "USD" } : {}), item_category: kind });
}

export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (config()) gtag("event", name, params);
}
