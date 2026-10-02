/**
 * Keeps the <head> right as the visitor moves between pages in the app: the
 * canonical link and og:url follow the path, and on a marketing page the
 * description, Open Graph / Twitter text and JSON-LD follow it too — the same
 * values the server writes into the HTML for a fresh load (server/seo-html.ts,
 * shared/seo.ts). The tab title stays with App.tsx and the pages.
 */
import { useEffect } from "react";
import { SITE_ORIGIN, canonicalPath, seoHeadFor, serializeJsonLd } from "@shared/seo";

function setMeta(attr: "name" | "property", key: string, value: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", value);
}

export function applySeoHead(location: string) {
  const path = canonicalPath(location);
  const canonical = `${SITE_ORIGIN}${path}`;
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = canonical;
  setMeta("property", "og:url", canonical);

  const head = seoHeadFor(path);
  const current = document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"][data-seo="jsonld"]');
  if (!head) {
    current?.remove();
    return;
  }
  setMeta("name", "description", head.description);
  setMeta("property", "og:title", head.title);
  setMeta("property", "og:description", head.description);
  setMeta("name", "twitter:title", head.title);
  setMeta("name", "twitter:description", head.description);
  // The build may have added nodes read off the rendered page (the /call-assistant FAQ):
  // keep the script it wrote for the page it was written for.
  if (current?.dataset.path === path) return;
  const script = current ?? document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.seo = "jsonld";
  script.dataset.path = path;
  script.textContent = serializeJsonLd(head.jsonLd);
  if (!current) document.head.appendChild(script);
}

/** Apply the head for each path the app shows (skipped on the CRM and client portal hosts, which are noindex). */
export function useSeoHead(location: string, enabled: boolean) {
  useEffect(() => {
    if (enabled) applySeoHead(location);
  }, [location, enabled]);
}
