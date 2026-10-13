/**
 * Google Ads / GA4 events from the app, and the same conversions to the Meta pixel.
 * The tags themselves are added to the page by the server (server/google-tag.ts
 * when GOOGLE_TAG_IDS is set; server/meta-pixel.ts when META_PIXEL_ID is set);
 * without them every call here is a no-op. A conversion fires once per browser
 * session per kind, so a refresh of /pricing?success=true cannot count twice.
 */
type ConversionKind = "signup" | "purchase" | "crm_purchase" | "call_assistant_purchase" | "alacarte_purchase";
type GtagConfig = { ids: string[]; conversions: Partial<Record<ConversionKind, string | null>> };

const gtag = (...args: unknown[]) => {
  const fn = (window as any).gtag;
  if (typeof fn === "function") fn(...args);
};
const config = (): GtagConfig | null => (typeof window === "undefined" ? null : (window as any).__CH_GTAG ?? null);
const fbq = (...args: unknown[]) => {
  const fn = (window as any).fbq;
  if (typeof fn === "function") fn(...args);
};
const metaPixel = (): string | null => (typeof window === "undefined" ? null : (window as any).__CH_META_PIXEL ?? null);

/** `meta.eventId`: the server's id for the same event (a sign-up), so Meta counts the browser's and the server's copy once. */
export function trackConversion(kind: ConversionKind, params: { value?: number; currency?: string } = {}, meta: { eventId?: string } = {}) {
  const cfg = config(), pixel = metaPixel();
  if (!cfg && !pixel) return;
  try {
    const key = `ch_conv_${kind}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* storage blocked: still report */ }
  if (pixel) {
    const money = params.value ? { value: params.value, currency: params.currency ?? "USD" } : {};
    fbq("track", kind === "signup" ? "CompleteRegistration" : "Purchase", money, meta.eventId ? { eventID: meta.eventId } : undefined);
  }
  if (!cfg) return;
  const sendTo = cfg.conversions?.[kind];
  if (sendTo) gtag("event", "conversion", { send_to: sendTo, ...(params.value ? { value: params.value, currency: params.currency ?? "USD" } : {}) });
  // GA4's own names, for a G- property on the same tag.
  gtag("event", kind === "signup" ? "sign_up" : "purchase", { ...(params.value ? { value: params.value, currency: params.currency ?? "USD" } : {}), item_category: kind });
}

export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (config()) gtag("event", name, params);
}
