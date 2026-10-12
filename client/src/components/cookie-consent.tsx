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

function sendPageview(path: string) {
  const landing = !landingSent;
  landingSent = true;
  const body = JSON.stringify({
    events: [{
      type: "pageview", path, referrer: analyticsPath(document.referrer) || null,
      ...(landing ? { landing: true, ...(landingUtm ? { utm: landingUtm } : {}) } : {}),
    }],
  });
  // sendBeacon survives navigation; fetch is the fallback.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics/events", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch { /* fall through */ }
  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body,
    keepalive: true,
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
