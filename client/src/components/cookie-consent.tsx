/**
 * First-party pageview tracker. No banner (owner, 2026-10-12: the cookie pop-up kept coming back — "Lets disable
 * this crap they are in the terms"): the privacy policy (§1.3) covers it. A visitor without the ch_consent cookie
 * gets it set to granted once, silently (server-side Set-Cookie with a ch_vid visitor id), and pageviews flow; a
 * visitor who declined under the old banner stays declined. The server still refuses events without the granted
 * cookie.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { analyticsPath } from "@shared/analytics-path";
import { utmFromSearch } from "@shared/campaign-attribution";
import { inNativeApp } from "@/lib/app-shell";
import { isClientPortal, isPortal } from "@/lib/site";

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// How this page load arrived: the three campaign tags (utm_source / utm_medium /
// utm_campaign) read off the address bar once, before any in-app navigation
// drops them. Nothing else in the query string is read. Held in memory only —
// it is sent with the first page view, and only once analytics is accepted.
const landingUtm = typeof window === "undefined" ? null : utmFromSearch(window.location.search);
let landingSent = false;

// After a 429 the tracker stays quiet until the server's Retry-After passes (the rest of its 15-minute
// window), instead of firing a refused request — and a red console line — on every page. Kept in
// sessionStorage too, so a full reload inside the window stays quiet as well.
const PAUSE_KEY = "ch_analytics_paused_until";
let pausedUntil = 0;
try { pausedUntil = Number(sessionStorage.getItem(PAUSE_KEY)) || 0; } catch { /* storage blocked */ }

function analyticsPauseMs(retryAfter: string | null): number {
  const secs = Number(retryAfter);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs, 15 * 60) * 1000 : 15 * 60 * 1000;
}

function sendPageview(path: string) {
  if (Date.now() < pausedUntil) return;
  const landing = !landingSent;
  landingSent = true;
  const body = JSON.stringify({
    events: [{
      type: "pageview", path, referrer: analyticsPath(document.referrer) || null,
      ...(landing ? { landing: true, ...(landingUtm ? { utm: landingUtm } : {}) } : {}),
    }],
  });
  // keepalive lets the request outlive a navigation (what sendBeacon was for) while still
  // letting us read a 429 and back off.
  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body,
    keepalive: true,
  }).then((r) => {
    if (r.status !== 429) return;
    pausedUntil = Date.now() + analyticsPauseMs(r.headers.get("retry-after"));
    try { sessionStorage.setItem(PAUSE_KEY, String(pausedUntil)); } catch { /* storage blocked */ }
  }).catch(() => {});
}

// The CRM, the client portal and the links customers get (documents, invoices, reviews, forms, contracts) record
// nothing: their privacy notice (pages/crm-legal.tsx §7) says so. Only the main site and app are measured.
const CUSTOMER_LINKS = ["/e/", "/i/", "/co/", "/lead-form/", "/portal/", "/review/", "/contract/sign/", "/site-scan/report/"];
const untracked = (path: string) => inNativeApp() || isPortal() || isClientPortal() || CUSTOMER_LINKS.some((p) => path.startsWith(p));

export function CookieConsent() {
  const [location] = useLocation();
  const [consent, setConsent] = useState<string | null>(() => readCookie("ch_consent"));

  // First visit: record the site's own analytics cookie once, with no pop-up.
  useEffect(() => {
    if (consent || untracked(location)) return;
    fetch("/api/analytics/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ granted: true }),
    }).then((r) => { if (r.ok) setConsent("granted"); }).catch(() => {});
  }, [consent, location]);

  // Track every route change once consent is granted. Bearer-token document
  // paths (/e/<token>, /i/<token>, …) are normalized so the tokens never land
  // in the analytics tables or the /admin Top-pages list.
  useEffect(() => {
    // Inside the iPhone apps nothing is tracked (App Store 5.1.2(i); docs/app/APP-STORE-PLAN.md).
    if (consent !== "granted" || untracked(location)) return;
    sendPageview(analyticsPath(location));
  }, [location, consent]);

  return null;
}
