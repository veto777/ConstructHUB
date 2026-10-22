import { useEffect } from "react";
import { TRACK_MAX_EVENTS_PER_POST, TRACK_NAME_RE, type TrackEventIn } from "@shared/engagement-events";

const PING_INTERVAL_MS = 15_000;
/** A section counts as "on screen" when this much of it (or of the viewport) is visible. */
const SECTION_VISIBLE_RATIO = 0.35;

/** "phone" / "tablet" / "desktop" — what the contractor reads next to the visit. */
function deviceKind(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return "tablet";
  if (/Mobi|iPhone|Android/.test(ua)) return "phone";
  return "desktop";
}

/**
 * Engagement tracker for the public estimate/invoice pages — answers the
 * owner's "did they spend 1 minute or 40, did they come back, and what did
 * they actually read and click?".
 *
 * On mount it opens an engagement session (the server ties it to the
 * estimate/invoice via the same unguessable token that authorises the page),
 * then heartbeats every 15s while the tab is visible. No cookies, nothing
 * stored client-side; the server accumulates duration and caps long gaps, so
 * a tab left open in the background does not count as reading time.
 *
 * Behaviour rides the same session (shared/engagement-events.ts):
 *   - a click on (or inside) `[data-track="name"]` is one event, with the
 *     element's `data-track-detail` as its detail; tel:/mailto: links are
 *     contact taps without any tagging;
 *   - `[data-track-section="name"]` elements accumulate seconds on screen
 *     while the tab is visible (watched as they mount — the page renders
 *     sections conditionally);
 *   - the first pointer-down inside `[data-track-interact="name"]` (the 3D
 *     viewer) is one event per session;
 *   - max scroll depth.
 * Events queue up and go with each heartbeat, and by sendBeacon as the page
 * goes away.
 *
 * `active` gates the start until the document has actually loaded — there is
 * nothing to track on an error page — and is false for a contractor preview.
 * `page` names which page this is ("estimate", "terms", "invoice").
 */
export function useEngagementTracker(
  docType: "estimate" | "invoice",
  token: string | undefined,
  active: boolean,
  page: string = docType,
): void {
  useEffect(() => {
    if (!token || !active) return;

    let sessionId: string | null = null;
    let cancelled = false;
    const t0 = Date.now();
    const queue: TrackEventIn[] = [];
    const now = () => Date.now() - t0;
    const push = (e: Omit<TrackEventIn, "t">) => {
      if (!TRACK_NAME_RE.test(e.name)) return;
      if (queue.length >= 400) return; // a runaway page never floods the server
      queue.push({ ...e, t: now() });
    };

    // ── Section dwell ──────────────────────────────────────────────────────
    const secsBySection = new Map<string, number>();   // running total, ms
    const sentSecs = new Map<string, number>();        // last total sent, whole secs
    const visibleSince = new Map<Element, number>();   // element → ms it came on screen
    const sectionOf = (el: Element) => el.getAttribute("data-track-section") || "";
    const bank = (el: Element, until: number) => {
      const since = visibleSince.get(el);
      if (since == null) return;
      const name = sectionOf(el);
      if (name) secsBySection.set(name, (secsBySection.get(name) ?? 0) + Math.max(0, until - since));
      visibleSince.set(el, until);
    };
    const io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        const t = Date.now();
        for (const en of entries) {
          const vh = window.innerHeight || 1;
          // A tall section never reaches 35% of ITSELF on a phone — count it once it fills 35% of the screen.
          const on = en.isIntersecting
            && (en.intersectionRatio >= SECTION_VISIBLE_RATIO || en.intersectionRect.height >= vh * SECTION_VISIBLE_RATIO);
          if (on && !visibleSince.has(en.target)) {
            if (document.visibilityState === "visible") visibleSince.set(en.target, t);
          } else if (!on && visibleSince.has(en.target)) {
            bank(en.target, t);
            visibleSince.delete(en.target);
          }
        }
      }, { threshold: [0, 0.1, 0.2, SECTION_VISIBLE_RATIO, 0.5, 0.75, 1] })
      : null;
    const watched = new WeakSet<Element>();
    const watchAll = () => {
      if (!io) return;
      document.querySelectorAll("[data-track-section]").forEach((el) => {
        if (watched.has(el)) return;
        watched.add(el);
        io.observe(el);
      });
    };
    watchAll();
    const mo = typeof MutationObserver === "function" ? new MutationObserver(() => watchAll()) : null;
    mo?.observe(document.body, { childList: true, subtree: true });

    const queueSectionTotals = () => {
      const t = Date.now();
      if (document.visibilityState === "visible") Array.from(visibleSince.keys()).forEach((el) => bank(el, t));
      for (const [name, ms] of Array.from(secsBySection.entries())) {
        const secs = Math.floor(ms / 1000);
        if (secs > 0 && secs !== sentSecs.get(name)) {
          sentSecs.set(name, secs);
          push({ name: "section_time", section: name.slice(0, 40), secs });
        }
      }
    };

    // ── Scroll depth ───────────────────────────────────────────────────────
    let maxPct = 0, sentPct = 0;
    const onScroll = () => {
      const doc = document.documentElement;
      const total = Math.max(1, doc.scrollHeight - window.innerHeight);
      const pct = Math.min(100, Math.round(((window.scrollY || doc.scrollTop) / total) * 100));
      if (pct > maxPct) maxPct = pct;
    };
    const queueScroll = () => {
      if (maxPct > sentPct) { sentPct = maxPct; push({ name: "scroll_depth", pct: maxPct }); }
    };

    // ── Clicks ─────────────────────────────────────────────────────────────
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const tagged = target.closest("[data-track]");
      if (tagged) {
        push({ name: tagged.getAttribute("data-track") || "", detail: (tagged.getAttribute("data-track-detail") || "").slice(0, 160) || null });
        return;
      }
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      const href = link?.getAttribute("href") || "";
      if (href.startsWith("tel:")) push({ name: "contact_call", detail: href.slice(4) });
      else if (href.startsWith("sms:")) push({ name: "contact_text", detail: href.slice(4) });
      else if (href.startsWith("mailto:")) push({ name: "contact_email", detail: href.slice(7).split("?")[0] });
      else if (/[?&]terms=1/.test(href)) push({ name: "terms_open" });
    };
    const interacted = new Set<string>();
    const onPointer = (ev: PointerEvent) => {
      const el = (ev.target as Element | null)?.closest?.("[data-track-interact]");
      const name = el?.getAttribute("data-track-interact");
      if (name && !interacted.has(name)) { interacted.add(name); push({ name }); }
    };

    // ── Transport ──────────────────────────────────────────────────────────
    const send = (url: string, payload: unknown, beacon: boolean) => {
      const body = JSON.stringify(payload);
      if (beacon && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    };
    const flushEvents = (beacon: boolean) => {
      if (!sessionId) return;
      queueSectionTotals();
      queueScroll();
      while (queue.length) {
        const batch = queue.splice(0, TRACK_MAX_EVENTS_PER_POST);
        send("/api/public/engagement/events", { sessionId, token, events: batch }, beacon);
      }
    };
    const ping = (beacon = false) => {
      if (!sessionId) return;
      send("/api/public/engagement/ping", { sessionId }, beacon);
      flushEvents(beacon);
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
        if (cancelled) return;
        sessionId = j.sessionId ?? null;
        if (sessionId) {
          queue.unshift({ name: "page_view", page, device: deviceKind(), t: 0 });
          flushEvents(false);
        }
      } catch {
        // Tracking must never break the document page.
      }
    })();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, PING_INTERVAL_MS);

    // Coming back to the tab counts immediately instead of waiting out the
    // rest of the interval; going away banks the on-screen time so a hidden
    // tab never reads as reading time.
    const onVisible = () => {
      const t = Date.now();
      if (document.visibilityState === "visible") {
        Array.from(visibleSince.keys()).forEach((el) => visibleSince.set(el, t));
        ping();
      } else {
        Array.from(visibleSince.keys()).forEach((el) => bank(el, t));
        ping(true);
      }
    };
    // Final beat as the page goes away — fetch would be cancelled here.
    const onHide = () => ping(true);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll);
      mo?.disconnect();
      ping(true);
      io?.disconnect();
    };
  }, [docType, token, active, page]);
}
