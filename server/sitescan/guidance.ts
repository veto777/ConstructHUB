import { createHash } from "node:crypto";
import type { CrawlState, Finding, Page } from "./audit";
import { businessSchema } from "./business-schema";
export type Platform =
  | "WordPress/Elementor"
  | "WordPress"
  | "Wix"
  | "Squarespace"
  | "GoDaddy"
  | "Webflow"
  | "Shopify"
  | "Duda"
  | "Custom/unknown";
export function detectPlatform(html: string): Platform {
  const patterns: [Platform, RegExp][] = [
    ["WordPress/Elementor", /elementor(?:-assets|-frontend|\/|[ _-]page)/i],
    [
      "WordPress",
      /wp-content\/|wp-includes\/|name=["']generator["'][^>]+WordPress/i,
    ],
    ["Wix", /wixstatic\.com|wix-warmup-data|name=["']generator["'][^>]+Wix/i],
    [
      "Squarespace",
      /static\d?\.squarespace\.com|squarespace-cdn\.com|Static\.SQUARESPACE/i,
    ],
    ["GoDaddy", /wsimg\.com|godaddy\.com\/websites|godaddy-website/i],
    ["Webflow", /data-wf-(?:site|page)=|webflow\.js/i],
    ["Shopify", /cdn\.shopify\.com|Shopify\.theme/i],
    ["Duda", /cdn\.website-editor\.net|dmRoot|duda\.co/i],
  ];
  return patterns.find(([, re]) => re.test(html))?.[0] || "Custom/unknown";
}
const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function brandMatches(name: string, text: string) {
  const core = normalize(name.split(/\s*[|•–—]\s*|\s+-\s+/)[0])
    .replace(/\b(llc|inc|ltd|corp)\b/g, "")
    .trim();
  const haystack = ` ${normalize(text)} `;
  if (!core) return false;
  if (haystack.includes(` ${core} `)) return true;
  // Conservative fuzzy match: contiguous tokens, one typo in a long token, never arbitrary word overlap.
  const tokens = core.split(/\s+/),
    words = normalize(text).split(/\s+/);
  const near = (a: string, b: string) => {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1)
      return false;
    let i = 0,
      j = 0,
      edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  return (
    tokens.length >= 2 &&
    words.some((_, i) => tokens.every((t, j) => near(t, words[i + j] || "")))
  );
}
const google = "https://developers.google.com/search/docs/";
type Guide = {
  impact: "High" | "Medium" | "Low";
  reason: string;
  source: string;
  steps: string[];
};
const guide = (
  impact: Guide["impact"],
  reason: string,
  path: string,
  ...steps: string[]
): Guide => ({
  impact,
  reason,
  source: path.startsWith("https:") ? path : google + path,
  steps,
});
export const guides: Record<string, Guide> = {
  "broken-links": guide(
    "Medium",
    "Broken destinations interrupt visitors and link discovery; a removed page is not automatically a site-wide ranking penalty.",
    "crawling-indexing/links-crawlable",
    "Open the source page and locate the recorded anchor text.",
    "Verify the target status. Replace the href with the suggested live same-site candidate only if its content is equivalent; otherwise remove the link or restore the intended page.",
  ),
  status: guide(
    "High",
    "Error pages may be unavailable for indexing; intentional removed pages can correctly return 404.",
    "crawling-indexing/http-network-errors",
    "Open the affected URL and confirm its HTTP status.",
    "Restore content that should exist; otherwise update inbound links or redirect only to a genuinely equivalent page.",
  ),
  fetch: guide(
    "Low",
    "This is incomplete coverage, not evidence of an SEO defect.",
    "crawling-indexing/http-network-errors",
    "Check hosting logs, DNS, TLS and access controls for the affected URL.",
    "Retry when the page is accessible; do not remove a URL based on this check alone.",
  ),
  redirects: guide(
    "Medium",
    "Extra redirect hops add delay and make discovery less direct.",
    "crawling-indexing/301-redirects",
    "Inspect the recorded redirect chain.",
    "Update the source link to the final URL; configure one permanent redirect from the old URL.",
  ),
  https: guide(
    "Medium",
    "HTTPS protects visitors and is part of page experience; it does not guarantee rankings.",
    "appearance/page-experience",
    "Enable a valid TLS certificate with your host.",
    "Redirect HTTP to HTTPS and update internal links and canonicals.",
  ),
  mixed: guide(
    "Medium",
    "Browsers may block HTTP resources on HTTPS pages, breaking content.",
    "https://web.dev/articles/fixing-mixed-content",
    "Use browser DevTools Console to locate blocked resources.",
    "Replace HTTP resource references with working HTTPS URLs and reload.",
  ),
  "soft-404": guide(
    "Medium",
    "An address with no page that answers like a real one leaves search engines to judge for themselves; Google reports the ones it judges empty as soft 404s.",
    "crawling-indexing/javascript/javascript-seo-basics",
    "Open an address on the site that has no page and look at the status it returns (browser DevTools, Network tab) and at the page's robots meta tag.",
    "Preferably set the server or host to answer 404 or 410 for addresses that have no page, while still showing visitors a helpful not-found page.",
    "On a single-page app where the server cannot know: add a noindex robots meta tag to the not-found view, or redirect it to an address the server answers with 404.",
    "Do not redirect missing addresses to the home page; redirect only when a page has moved to a real replacement.",
  ),
  canonical: guide(
    "Low",
    "A different canonical may be intentional; Google can select one without this tag.",
    "crawling-indexing/consolidate-duplicate-urls",
    "Compare the observed canonical with the preferred version of the page.",
    "Keep intentional cross-page canonicals; otherwise set one absolute canonical and align internal links.",
  ),
  noindex: guide(
    "High",
    "Noindex can exclude a page from search; this is correct for private or non-search pages.",
    "crawling-indexing/block-indexing",
    "Confirm whether this page should appear in search.",
    "If yes, remove noindex from the robots meta tag and X-Robots-Tag header; inspect the live URL in Search Console.",
  ),
  nofollow: guide(
    "Low",
    "This affects link-following hints; it is not an automatic ranking penalty.",
    "crawling-indexing/robots-meta-tag",
    "Inspect the page robots directives.",
    "Remove page-wide nofollow only when the linked destinations should be followed.",
  ),
  sitemap: guide(
    "Low",
    "Sitemaps aid discovery but are optional and do not guarantee indexing.",
    "crawling-indexing/sitemaps/overview",
    "Check the CMS-generated sitemap for the canonical, indexable URL.",
    "Include intended search pages, declare the sitemap in robots.txt and submit it in Search Console.",
  ),
  robots: guide(
    "Low",
    "Robots exclusions may be intentional; blocking crawl does not ensure removal from search.",
    "crawling-indexing/robots/intro",
    "Inspect the exact matching Disallow rule in robots.txt.",
    "Allow public content only if intended; use authentication for private content.",
  ),
  title: guide(
    "Medium",
    "Descriptive titles help Google and users understand the page; length alone is not an error.",
    "appearance/title-link",
    "Review the observed title and factual draft for this page.",
    "Set a concise, unique title in the page SEO settings; preview and publish after review.",
  ),
  description: guide(
    "Low",
    "A description may inform the search snippet; it is not a direct ranking factor or guaranteed snippet.",
    "appearance/snippet",
    "Review the existing description and evidence-based draft.",
    "Save a useful page-specific meta description in SEO settings; Google may use other page text.",
  ),
  h1: guide(
    "Low",
    "Clear headings aid comprehension; multiple H1s are not by themselves a ranking penalty.",
    "fundamentals/seo-starter-guide",
    "Inspect the recorded headings and the rendered page.",
    "Use a clear main heading and logical subheadings; change multiple H1s only if the hierarchy is confusing.",
  ),
  thin: guide(
    "Low",
    "Short content can be sufficient; there is no required SEO word count.",
    "fundamentals/creating-helpful-content",
    "Read the page and identify unanswered customer questions.",
    "Add only useful, verified details; do not pad text to meet the scanner threshold.",
  ),
  alt: guide(
    "Medium",
    "Useful alt text helps accessibility and image understanding.",
    "appearance/google-images",
    "Open each image listed without an alt attribute.",
    'Describe informative images in context; set alt="" for decorative images.',
  ),
  weight: guide(
    "Medium",
    "Large HTML can slow delivery and parsing; this is not total page weight.",
    "https://web.dev/learn/performance/general-html-performance",
    "Inspect the measured HTML size and template output.",
    "Remove duplicated markup and unnecessary inline payloads; enable compression and rerun PageSpeed.",
  ),
  mobile: guide(
    "Medium",
    "A missing viewport can make mobile content difficult to use.",
    "https://web.dev/articles/responsive-web-design-basics",
    'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
    "Test text and controls at narrow widths before publishing.",
  ),
  schema: guide(
    "Low",
    "Accurate markup helps interpret business facts; rich results and rankings are not guaranteed.",
    "appearance/structured-data/local-business",
    "Review the draft against the synced GBP and visible page content; omit private addresses.",
    "Add the JSON-LD script once, avoid duplicate plugin markup, then test with Google Rich Results Test. Service-area-only markup may not meet LocalBusiness rich-result address requirements.",
  ),
  maps: guide(
    "Low",
    "A map may help customers find you; embedding one is not a documented ranking requirement.",
    "fundamentals/seo-starter-guide",
    "Confirm customers visit this address.",
    "If useful, embed the correct listing in the contact page; skip for private service-area addresses.",
  ),
  call: guide(
    "Low",
    "A telephone link is a usability improvement, not a direct ranking requirement.",
    "fundamentals/seo-starter-guide",
    "Confirm the published business phone.",
    "Add a tel: link to the contact button and test it on a phone.",
  ),
  reviews: guide(
    "Low",
    "Authentic feedback may help visitors evaluate you; absence of a testimonial block is not a ranking penalty.",
    "fundamentals/creating-helpful-content",
    "Obtain permission for genuine customer feedback.",
    "Add accurate attribution and visible text; do not invent reviews or add self-serving review stars markup.",
  ),
  nap: guide(
    "Low",
    "Formatting differences are not proof of a ranking problem; consistent identity helps users.",
    "appearance/structured-data/local-business",
    "Compare the synced GBP value with the visible contact details.",
    "Correct factual discrepancies only; preserve natural brand names and service-area privacy.",
  ),
  gap: guide(
    "Low",
    "A missing exact heading match does not prove a content gap or require a new page.",
    "fundamentals/creating-helpful-content",
    "Search existing pages for coverage of this real service or area.",
    "Improve existing useful content; create a distinct page only when you can provide original, relevant information.",
  ),
  bot: guide(
    "Low",
    "AI crawler access is a policy choice, not a Google Search ranking requirement.",
    "appearance/ai-features",
    "Review the named crawler rule in robots.txt.",
    "Change only if consistent with your content licensing policy; Google-Extended is separate from Googlebot.",
  ),
  llms: guide(
    "Low",
    "llms.txt is optional; Google does not require special AI text files for Search.",
    "appearance/ai-features",
    "Decide whether an optional curated index is useful.",
    "If desired, publish a factual llms.txt Markdown index; do not prioritize it over crawlability or useful content.",
  ),
  faq: guide(
    "Low",
    "Useful answers help readers; this is content guidance, not a promise of enhanced search appearance.",
    "fundamentals/creating-helpful-content",
    "Identify genuine recurring customer questions.",
    "Add visible answers supported by business facts; leave unverified answers as drafts.",
  ),
  js: guide(
    "Medium",
    "Little initial text may mean rendering is needed; confirm with URL Inspection before assuming missing content.",
    "crawling-indexing/javascript/javascript-seo-basics",
    "Compare initial HTML and rendered content in Search Console URL Inspection.",
    "Use server rendering or prerendering if important content is inaccessible; keep resources crawlable.",
  ),
  "oversized-images": guide(
    "Medium",
    "Heavy images can delay loading; 300 KB is our optimization target, not a Google limit.",
    "https://web.dev/learn/performance/image-performance",
    "Resize to the displayed dimensions with responsive srcset variants.",
    "Export WebP or AVIF, lower quality while checking appearance, aim below 300,000 bytes and replace the referenced file. Recheck visual quality and measured bytes.",
  ),
  psi: guide(
    "Medium",
    "Lighthouse is a lab diagnostic; Google uses real-world page experience signals, not this score directly.",
    "appearance/core-web-vitals",
    "Inspect measured LCP, CLS and blocking time for this URL and device.",
    "Optimize the LCP resource, reserve image dimensions and defer nonessential JavaScript; rerun under comparable conditions.",
  ),
};
export function guideFor(id: string): Guide {
  const key = id.startsWith("duplicate-")
    ? id.slice(10)
    : id.startsWith("nap-")
      ? "nap"
      : id.startsWith("gap-")
        ? "gap"
        : id.startsWith("bot-")
          ? "bot"
          : id.startsWith("psi-")
            ? "psi"
            : ["schema-invalid", "structured"].includes(id)
              ? "schema"
              : id;
  if (!guides[key]) throw new Error(`Missing Site Scan guide: ${id}`);
  return guides[key];
}
// Paths vary by editor version/plan: the report explicitly describes these as starting points.
const paths: Record<Platform, [string, string, string, string]> = {
  WordPress: [
    "Pages → select page → Edit; Yoast SEO or Rank Math → title/description/Advanced",
    "Pages → Edit → select link, heading or image block; Media → Library for image files",
    "Use the existing SEO plugin schema settings, or a reviewed custom HTML block; avoid two schema plugins",
    "SEO plugin settings → sitemaps/robots; Redirection plugin for URL redirects; host dashboard for TLS",
  ],
  "WordPress/Elementor": [
    "WordPress → Pages → Edit → Yoast SEO or Rank Math metadata",
    "Pages → Edit with Elementor → select widget → Content (link/image/text); heading HTML Tag",
    "Elementor HTML widget for reviewed JSON-LD, or existing SEO plugin schema settings",
    "WordPress SEO plugin → sitemaps/robots; Redirection plugin; host dashboard for TLS",
  ],
  Wix: [
    "Pages & Menu → page menu → SEO basics",
    "Edit Site → select text/button/image → link or image settings",
    "Page SEO → Advanced SEO → Structured data markup",
    "SEO dashboard → URL Redirect Manager / robots.txt editor; Wix manages hosting",
  ],
  Squarespace: [
    "Pages → page settings → SEO",
    "Pages → Edit → select text/image block → Edit",
    "Page settings → Advanced → Page Header Code Injection (plan dependent)",
    "Settings → Developer Tools → URL Mappings / Code Injection; sitemap is managed",
  ],
  GoDaddy: [
    "Websites + Marketing → Edit Website → Settings → Search Engine Optimization",
    "Edit Website → page → section → select text, link or image",
    "Add an HTML section only if supported; ask support about head markup on your plan",
    "Website settings → domain/SEO; contact support for unsupported redirects or robots edits",
  ],
  Webflow: [
    "Pages panel → page settings → SEO Settings",
    "Designer → select element → Element Settings; Assets for replacement images",
    "Page settings → Custom Code → Inside head tag (plan dependent)",
    "Site settings → Publishing → 301 redirects; SEO → sitemap/robots",
  ],
  Shopify: [
    "Online Store → Pages → page → Search engine listing → Edit",
    "Online Store → Pages or Themes → Customize; Content → Files for images",
    "Online Store → Themes → Edit code → relevant Liquid template; check existing theme schema first",
    "Content → Menus → URL redirects (older UI: Navigation); theme robots.txt.liquid only with developer review",
  ],
  Duda: [
    "Pages → page settings → SEO",
    "Editor → page → select widget → Content; image picker to replace assets",
    "Page settings → SEO → Header HTML or supported schema settings",
    "Site settings → SEO → URL redirects; review sitemap/robots settings",
  ],
  "Custom/unknown": [
    "Ask the site developer to edit this route’s <title> and description meta tag",
    "Edit the route template/component containing the evidenced element",
    "Add the reviewed JSON-LD script to the page template once",
    "Developer/hosting configuration: HTTP status, redirects, TLS, robots.txt and sitemap.xml",
  ],
};
export function platformSteps(platform: Platform, id: string) {
  const p = paths[platform] || paths["Custom/unknown"];
  const key = id.replace("duplicate-", "");
  return p[
    ["title", "description"].includes(key)
      ? 0
      : ["schema", "schema-invalid", "structured"].includes(key)
        ? 2
        : [
              "status",
              "fetch",
              "redirects",
              "https",
              "canonical",
              "noindex",
              "nofollow",
              "sitemap",
              "robots",
              "soft-404",
            ].includes(key) || key.startsWith("bot-")
          ? 3
          : 1
  ];
}
/**
 * The part of the site a made-up address stands for: "/" for the one at the top, "/services/" for the one in a
 * section. It is the identity of what is checked (the address itself is new in every crawl), so a later crawl can
 * say whether THAT part of the site now answers honestly.
 */
export function missingPageScope(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.slice(0, path.lastIndexOf("/") + 1) || "/";
  } catch {
    return "/";
  }
}
/** Where a missing-page fix lives: the site's address plus that part ("https://x.com/services/"). */
export function missingPageFixPage(url: string): string {
  try {
    return new URL(url).origin + missingPageScope(url);
  } catch {
    return url;
  }
}
export type Fix = {
  key: string;
  findingId: string;
  category?: string;
  page: string;
  target?: string;
  evidence: Record<string, unknown>;
  code?: string;
  platform: Platform;
  clickPath: string;
  title?: string;
  guidance?: Guide;
  verification: "new" | "still present" | "fixed" | "not checked";
  done: boolean;
};
export const fixKey = (id: string, page: string, target = "") =>
  createHash("sha256")
    .update(JSON.stringify([id, page, target]))
    .digest("hex");
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const script = (s: unknown) =>
  '<script type="application/ld+json">\n' +
  JSON.stringify(s, null, 2).replace(/</g, "\\u003c") +
  "\n</script>";
export function enrichFindings(
  findings: Finding[],
  state: CrawlState,
  profile: any,
) {
  return findings
    .map((f) => ({ ...f, guidance: guideFor(f.id) }))
    .sort(
      (a, b) =>
        ({ High: 0, Medium: 1, Low: 2 })[a.guidance.impact] -
        { High: 0, Medium: 1, Low: 2 }[b.guidance.impact],
    );
}
export function fixesFor(
  findings: Finding[],
  state: CrawlState,
  profile: any,
): Fix[] {
  const fixes: Fix[] = [];
  for (const f of findings) {
    const add = (
      url: string,
      evidence: Record<string, unknown>,
      target?: string,
      code?: string,
    ) => {
      const page = state.pages.find((p) => p.url === url),
        platform = page?.platform || "Custom/unknown";
      fixes.push({
        key: fixKey(f.id, url, target),
        findingId: f.id,
        category: f.category,
        page: url,
        target,
        evidence,
        code,
        platform,
        clickPath: platformSteps(platform, f.id),
        title: f.title,
        guidance: guideFor(f.id),
        verification: "new",
        done: false,
      });
    };
    if (f.id === "broken-links") {
      for (const target of f.urls)
        for (const page of state.pages.filter((p) =>
          p.links.includes(target),
        )) {
          const anchor =
            page.linkEvidence
              ?.filter((l) => l.target === target)
              .map((l) => l.anchor)
              .join(" | ") || "(anchor not captured; rescan)";
          const terms = [
            ...new Set(
              normalize(anchor + " " + new URL(target).pathname)
                .split(" ")
                .filter((t) => t.length > 3),
            ),
          ];
          const match = state.pages
            .filter(
              (p) =>
                p.status === 200 &&
                p.url !== target &&
                new URL(p.url).origin === new URL(target).origin,
            )
            .map((p) => ({
              p,
              n: terms.filter((t) =>
                normalize(
                  p.title +
                    " " +
                    p.h1.join(" ") +
                    " " +
                    new URL(p.url).pathname,
                )
                  .split(" ")
                  .includes(t),
              ).length,
            }))
            .sort((a, b) => b.n - a.n)[0];
          add(
            page.url,
            {
              anchor,
              status:
                state.linkChecks.find((l) => l.url === target)?.status ??
                state.pages.find((p) => p.url === target)?.status,
              suggestedReplacement: match && match.n >= 2 ? match.p.url : null,
              note: "Replacement is a candidate from an observed live same-site page; review relevance.",
            },
            target,
          );
        }
    } else if (f.id === "oversized-images") {
      for (const i of state.imageChecks || [])
        if (i.bytes > 300000)
          for (const p of i.pages)
            add(
              p,
              {
                currentBytes: i.bytes,
                targetBytes: 300000,
                targetNote: "Optimization budget, not a ranking threshold",
              },
              i.url,
            );
    } else
      for (const url of f.urls) {
        const p = state.pages.find((p) => p.url === url);
        let evidence: Record<string, unknown> = {
            observed: "Not detected in scanned HTML; inspect rendered page.",
          },
          code: string | undefined;
        if (p)
          evidence = {
            status: p.status,
            title: p.title,
            description: p.description,
            headings: p.h1,
            canonical: p.canonical,
            noindex: p.noindex,
            htmlBytes: p.bytes,
          };
        if (f.id.includes("title") || f.id.includes("description")) {
          const title = (p?.h1[0] || p?.title || "").slice(0, 180),
            description = p?.text.slice(0, 160) || "";
          evidence = {
            current: f.id.includes("title") ? p?.title : p?.description,
            draftLabel:
              "Evidence-based draft — review before publishing; no AI call",
            draft: f.id.includes("title") ? title : description,
          };
          if (f.id.includes("title") && title)
            code = `<title>${esc(title)}</title>`;
          if (f.id.includes("description") && description)
            code = `<meta name="description" content="${esc(description)}">`;
        }
        if (["schema", "schema-invalid", "structured"].includes(f.id)) {
          evidence = {
            observed: p?.schema || [],
            invalidJSON: p?.invalidSchema,
            source: profile
              ? "Last synced GBP snapshot"
              : "No synced GBP; connect and sync before drafting",
          };
          if (profile) code = script(businessSchema(profile));
        }
        if (f.id === "alt")
          evidence = {
            images: p?.images
              .filter((i) => i.alt === undefined)
              .map((i) => i.url),
          };
        if (f.id === "soft-404")
          evidence = {
            partOfSite: missingPageScope(url),
            asked: (state.missingPages ?? []).map((m) => ({
              address: m.url,
              answered: m.status,
              endedAt: m.finalUrl,
              read: m.outcome,
              ...(m.note ? { note: m.note } : {}),
            })),
          };
        if (f.id === "redirects")
          evidence = { chain: p?.redirects, final: url };
        if (f.id === "mixed")
          evidence = { resources: p?.insecureResources || [] };
        if (f.id === "fetch")
          evidence = {
            error: state.errors.find((e) => e.url === url)?.message,
          };
        if (f.id === "robots" || f.id.startsWith("bot-"))
          evidence = { robots: state.robots };
        if (f.id.startsWith("nap-"))
          evidence = {
            syncedValue: profile?.[f.id.slice(4)],
            observedText: p?.text.slice(0, 2000),
            method:
              "Normalized brand core and conservative typo matching for name; text comparison for other fields",
          };
        if (f.id.startsWith("gap-"))
          evidence = {
            syncedEntry: f.title,
            profileValues: f.id.startsWith("gap-services-")
              ? profile?.services
              : profile?.service_areas,
            observedHeadingCount: state.pages.length,
            observedHeadings: state.pages.slice(0, 20).map((p) => ({
              page: p.url,
              title: p.title,
              h1: p.h1,
            })),
          };
        if (f.id === "mobile")
          code =
            '<meta name="viewport" content="width=device-width, initial-scale=1">';
        // The made-up address is new in every crawl; the fix is about the part of the site it stood for, so the same
        // answer in the next crawl is "still present", not a new fix beside an orphaned old one.
        if (f.id === "soft-404") {
          add(missingPageFixPage(url), evidence, undefined, code);
          continue;
        }
        add(url, evidence, undefined, code);
      }
  }
  return [...new Map(fixes.map((f) => [f.key, f])).values()].sort(
    (a, b) =>
      ({ High: 0, Medium: 1, Low: 2 })[a.guidance!.impact] -
      { High: 0, Medium: 1, Low: 2 }[b.guidance!.impact],
  );
}
export function reconcileFixes(
  current: Fix[],
  previous: Fix[],
  state: CrawlState,
  profile: any = null,
  psi: any[] = [],
): Fix[] {
  const old = new Map(previous.map((f) => [f.key, f])),
    keys = new Set(current.map((f) => f.key));
  const result: Fix[] = current.map((f) => ({
    ...f,
    done:
      old.get(f.key)?.verification === "fixed"
        ? false
        : old.get(f.key)?.done || false,
    verification:
      old.has(f.key) && old.get(f.key)?.verification !== "fixed"
        ? ("still present" as const)
        : ("new" as const),
  }));
  for (const f of previous)
    if (!keys.has(f.key)) {
      const page = state.pages.find(
        (p) => p.url === f.page && p.status === 200 && p.text.length >= 100,
      );
      let checked = !!page;
      if (f.findingId === "fetch" || f.findingId === "status")
        checked = state.pages.some((p) => p.url === f.page && p.status === 200);
      // Fixed only when addresses with no page were asked for again in this crawl and EVERY one was answered "not found"
      // (404/410) or as a noindexed page. An answer that proves nothing (sign-in, bot check, error) is not a fix.
      // Fixed only when THIS crawl asked again in the same part of the site (the top, or the same section) and got
      // "not found" (404/410) or a noindexed page there. Not asked, no answer, or an answer that proves nothing (a
      // sign-in, a bot check, an error) leaves it "not checked".
      if (f.findingId === "soft-404") {
        const part = missingPageFixPage(f.page);
        const again = (state.missingPages ?? []).filter(
          (m) => missingPageFixPage(m.url) === part,
        );
        checked =
          again.length > 0 &&
          again.every(
            (m) => m.outcome === "not_found" || m.outcome === "noindex",
          );
      }
      if (f.findingId === "broken-links")
        checked =
          !!page &&
          (!page.links.includes(f.target!) ||
            [...state.linkChecks, ...state.pages].some(
              (p) =>
                p.url === f.target &&
                p.status !== null &&
                p.status >= 200 &&
                p.status < 400,
            ));
      if (f.findingId === "oversized-images")
        checked =
          !!page &&
          (!page.images.some((i) => i.url === f.target) ||
            (state.imageChecks || []).some(
              (i) => i.url === f.target && i.bytes <= 300000,
            ));
      // Site-wide absence and sampled/provider checks require complete comparable coverage.
      if (
        /^(gap-|nap-)|^(maps|call|reviews|llms|schema|faq|robots)$/.test(
          f.findingId,
        )
      )
        checked =
          !!page &&
          state.initialized &&
          !state.queue.length &&
          !state.errors.length &&
          !state.blocked.length;
      if (f.findingId.startsWith("duplicate-"))
        checked =
          checked &&
          !state.queue.length &&
          !state.errors.length &&
          !state.blocked.length;
      if (f.findingId.startsWith("nap-"))
        checked =
          checked &&
          !!profile &&
          profile[f.findingId.slice(4)] === f.evidence.syncedValue;
      if (f.findingId.startsWith("gap-"))
        checked =
          checked &&
          !!profile &&
          JSON.stringify(f.evidence.profileValues) ===
            JSON.stringify(
              f.findingId.startsWith("gap-services-")
                ? profile.services
                : profile.service_areas,
            );
      if (f.findingId.startsWith("bot-")) checked = !!page && state.initialized;
      if (f.findingId.startsWith("psi-"))
        checked = psi.some(
          (p) =>
            p.url === f.page &&
            f.findingId === `psi-${p.strategy}-${p.url}` &&
            typeof p.score === "number" &&
            p.score >= 90,
        );
      result.push({ ...f, verification: checked ? "fixed" : "not checked" });
    }
  return result;
}
export function checklist(report: any, fixes: Fix[]) {
  return [
    `Site fix checklist: ${report.url}`,
    "Draft suggestions require review. Scores are audit indicators, not rankings.",
    ...fixes.map((f) => {
      const finding = report.findings.find((v: any) => v.id === f.findingId),
        g = guideFor(f.findingId);
      return `\n[${f.done ? "x" : " "}] ${g.impact} — ${finding?.title || f.findingId} — ${f.verification}\nPage: ${f.page}${f.target ? "\nTarget: " + f.target : ""}\nWhy: ${g.reason}\nSource: ${g.source}\nEvidence: ${JSON.stringify(f.evidence, null, 2)}\n${f.platform}: ${f.clickPath}\n${g.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n${f.code ? "DRAFT code — review before publishing:\n" + f.code : ""}`;
    }),
  ].join("\n");
}
