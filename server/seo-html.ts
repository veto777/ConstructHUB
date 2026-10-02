/**
 * The page's <head> written into the HTML the server sends — the SPA shell
 * (server/static.ts) and the prerendered pages (script/prerender.ts) alike —
 * so a crawler that runs no JavaScript still gets the page's own title, meta
 * description, canonical URL, Open Graph / Twitter tags and JSON-LD
 * (shared/route-meta.ts, shared/seo.ts). Pure string work, no side effects:
 * the build imports it too.
 */
import { pageMetaFor } from "@shared/route-meta";
import { DEFAULT_OG_IMAGE, SITE_ORIGIN, seoHeadFor, serializeJsonLd, type JsonLd } from "@shared/seo";

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Replace one <meta> tag's content (matched by name= or property=), or add it before </head>. */
function setMeta(html: string, attr: "name" | "property", key: string, value: string): string {
  const re = new RegExp(`(<meta ${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content=")[^"]*(")`, "i");
  // Function replacers: a "$" in the copy is text, never a replacement pattern.
  if (re.test(html)) return html.replace(re, (_, open, close) => `${open}${escapeAttr(value)}${close}`);
  return html.replace(/<\/head>/i, () => `    <meta ${attr}="${key}" content="${escapeAttr(value)}" />\n  </head>`);
}

/**
 * The page's own <title>, meta description and Open Graph / Twitter
 * title + description (shared/route-meta.ts: a marketing page's, or a public
 * app page's). Paths without an entry keep
 * index.html's defaults.
 */
export function withRouteMeta(html: string, path: string): string {
  const meta = pageMetaFor(path);
  if (!meta) return html;
  let out = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeAttr(meta.title)}</title>`);
  out = setMeta(out, "name", "description", meta.description);
  out = setMeta(out, "property", "og:title", meta.title);
  out = setMeta(out, "property", "og:description", meta.description);
  out = setMeta(out, "name", "twitter:title", meta.title);
  out = setMeta(out, "name", "twitter:description", meta.description);
  return out;
}

/**
 * withRouteMeta, plus the canonical link (every path: `origin` + the path),
 * og:url and og:image, and — on a marketing page — the JSON-LD script.
 * `extra` adds JSON-LD nodes the build read off the rendered page.
 */
export function withSeoHead(html: string, path: string, opts: { origin?: string; extra?: readonly JsonLd[] } = {}): string {
  const origin = opts.origin ?? SITE_ORIGIN;
  const canonical = `${origin}${path}`;
  let out = withRouteMeta(html, path);
  const head = seoHeadFor(path, opts.extra);
  out = setMeta(out, "property", "og:url", canonical);
  out = setMeta(out, "property", "og:image", head?.image ?? DEFAULT_OG_IMAGE);
  out = setMeta(out, "name", "twitter:image", head?.image ?? DEFAULT_OG_IMAGE);
  const tags = [`<link rel="canonical" href="${escapeAttr(canonical)}" />`];
  if (head && head.jsonLd.length) {
    tags.push(`<script type="application/ld+json" data-seo="jsonld" data-path="${escapeAttr(path)}">${serializeJsonLd(head.jsonLd)}</script>`);
  }
  return out.replace(/<\/title>/i, () => `</title>\n    ${tags.join("\n    ")}`);
}
