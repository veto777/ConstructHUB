/**
 * Is this page running inside one of the ConstructHUB iPhone apps? (docs/app/APP-STORE-PLAN.md)
 *
 * The native shells add a token to their user agent: `ConstructHUBApp/<version>` (the platform, constructhub.us) or
 * `ConstructHUBCRM/<version>` (the CRM, portal.constructhub.us). Inside an app the web pages follow the App Store
 * rules the owner chose on 2026-10-04: no cookie banner or analytics, and nothing is sold (no prices, plans, upgrade
 * prompts, cart or checkout — guideline 3.1.3(f)).
 *
 * Local testing: `?app=1` turns app mode on for the tab (kept in sessionStorage), `?app=0` turns it off.
 */
const APP_UA = /\bConstructHUB(App|CRM)\/\d[\w.]*/;
const KEY = "ch_app_mode";

let cached: boolean | null = null;

export function inNativeApp(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return false;
  let on = APP_UA.test(navigator.userAgent || "");
  if (!on) {
    try {
      const q = new URLSearchParams(window.location.search).get("app");
      if (q === "1") sessionStorage.setItem(KEY, "1");
      if (q === "0") sessionStorage.removeItem(KEY);
      on = sessionStorage.getItem(KEY) === "1";
    } catch { /* storage blocked: the user agent decides alone */ }
  }
  cached = on;
  if (on) document.documentElement.classList.add("in-app");
  return on;
}

/** Which app: the growth platform or the CRM (null in a browser). */
export function nativeAppKind(): "platform" | "crm" | null {
  if (!inNativeApp() || typeof navigator === "undefined") return null;
  const m = APP_UA.exec(navigator.userAgent || "");
  return m?.[1] === "CRM" ? "crm" : "platform";
}
