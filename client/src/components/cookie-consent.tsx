/**
 * Cookie consent banner + first-party pageview tracker.
 *
 * Until the visitor answers, nothing is tracked and no analytics cookie is
 * set. "Accept" sets ch_consent=granted + a ch_vid visitor id (server-side
 * Set-Cookie) and pageviews start flowing; "Decline" sets ch_consent=denied
 * and the tracker stays off — the server refuses events without the granted
 * cookie either way.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";
import { analyticsPath } from "@shared/analytics-path";
import { isClientPortal, isPortal } from "@/lib/site";

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function sendPageview(path: string) {
  const body = JSON.stringify({
    events: [{ type: "pageview", path, referrer: analyticsPath(document.referrer) || null }],
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

export function CookieConsent() {
  const [location] = useLocation();
  const [consent, setConsent] = useState<string | null>(() => readCookie("ch_consent"));
  const [saving, setSaving] = useState(false);

  // Track every route change once consent is granted. Bearer-token document
  // paths (/e/<token>, /i/<token>, …) are normalized so the tokens never land
  // in the analytics tables or the /admin Top-pages list.
  useEffect(() => {
    if (consent !== "granted") return;
    const path = analyticsPath(location);
    sendPageview(path);
  }, [location, consent]);

  if (consent) return null;

  const answer = async (granted: boolean) => {
    setSaving(true);
    try {
      await fetch("/api/analytics/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ granted }),
      });
    } catch { /* the cookie simply stays unset; banner returns next load */ }
    setConsent(granted ? "granted" : "denied");
    setSaving(false);
  };

  // Each product face links its own policy: the CRM and client portal hosts
  // serve /crm-privacy; the marketing site's policy is /privacy.
  const privacyHref = isPortal() || isClientPortal() ? "/crm-privacy" : "/privacy";

  // In normal document flow: consent must never cover an action or a footer.
  return (
    <div
      className="relative p-3 sm:p-4 flex justify-center border-b bg-background"
      data-testid="cookie-consent-banner"
    >
      <div className="pointer-events-auto w-full max-w-2xl sm:max-w-lg rounded-xl border bg-card text-card-foreground shadow-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <Cookie className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            We use cookies to understand how ConstructHUB is used — pages visited, general
            location, and device info — so we can improve the product. See our{" "}
            <a href={privacyHref} className="underline hover:text-foreground" data-testid="link-cookies-privacy">Privacy Policy</a>.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" disabled={saving}
            onClick={() => answer(false)} data-testid="button-cookies-decline">
            Decline
          </Button>
          <Button size="sm" disabled={saving}
            onClick={() => answer(true)} data-testid="button-cookies-accept">
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
