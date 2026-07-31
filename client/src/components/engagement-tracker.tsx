import { useEffect } from "react";

const PING_INTERVAL_MS = 15_000;

/**
 * Engagement tracker for the public estimate/invoice pages — answers the
 * owner's "did they spend 1 minute or 40, and did they come back?".
 *
 * On mount it opens an engagement session (the server ties it to the
 * estimate/invoice via the same unguessable token that authorises the page),
 * then heartbeats every 15s while the tab is visible. No cookies, nothing
 * stored client-side; the server accumulates duration and caps long gaps, so
 * a tab left open in the background does not count as reading time.
 *
 * `active` gates the start until the document has actually loaded — there is
 * nothing to track on an error page.
 */
export function useEngagementTracker(
  docType: "estimate" | "invoice",
  token: string | undefined,
  active: boolean,
): void {
  useEffect(() => {
    if (!token || !active) return;

    let sessionId: string | null = null;
    let cancelled = false;

    const ping = (beacon = false) => {
      if (!sessionId) return;
      const body = JSON.stringify({ sessionId });
      if (beacon && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(
          "/api/public/engagement/ping",
          new Blob([body], { type: "application/json" }),
        );
        return;
      }
      fetch("/api/public/engagement/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    };

    (async () => {
      try {
        const r = await fetch("/api/public/engagement/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docType, token }),
        });
        if (!r.ok) return;
        const j = await r.json().catch(() => ({}));
        if (!cancelled) sessionId = j.sessionId ?? null;
      } catch {
        // Tracking must never break the document page.
      }
    })();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, PING_INTERVAL_MS);

    // Coming back to the tab counts immediately instead of waiting out the
    // rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    // Final beat as the page goes away — fetch would be cancelled here.
    const onHide = () => ping(true);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
      ping(true);
    };
  }, [docType, token, active]);
}
