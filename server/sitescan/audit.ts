import * as cheerio from "cheerio";
import { safeFetch, siteUrl, type PageResponse } from "./http";
import { robotsRules } from "./robots";
export const categories = [
  "technical",
  "performance",
  "local",
  "content",
  "ai-readiness",
] as const;
export type Category = (typeof categories)[number];
export type Finding = {
  id: string;
  category: Category;
  severity: "critical" | "warning" | "info";
  title: string;
  urls: string[];
  why: string;
  fix: string;
};
export type Page = {
  url: string;
  status: number;
  title: string;
  description: string;
  text: string;
  h1: string[];
  links: string[];
  images: { url: string; alt: string | undefined }[];
  bytes: number;
  canonical: string | null;
  noindex: boolean;
  nofollow: boolean;
  schema: any[];
  invalidSchema: boolean;
  htmlSignals: {
    mixed: boolean;
    maps: boolean;
    call: boolean;
    reviews: boolean;
    faq: boolean;
    viewport: boolean;
  };
  redirects: string[];
};
export type CrawlState = {
  origin?: string;
  queue: string[];
  pages: Page[];
  errors: { url: string; message: string }[];
  blocked: string[];
  robots: string;
  sitemap: string[];
  initialized: boolean;
  llms: boolean;
  imageChecks?: { url: string; bytes: number; pages: string[] }[];
  linkChecks: { url: string; status: number | null }[];
};
export const emptyState = (url: string): CrawlState => ({
  queue: [url],
  pages: [],
  errors: [],
  blocked: [],
  robots: "",
  sitemap: [],
  initialized: false,
  llms: false,
  linkChecks: [],
});
export function parsePage(r: PageResponse): Page {
  const $ = cheerio.load(r.body),
    schema: any[] = [];
  let invalidSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const v = JSON.parse($(el).text());
      schema.push(...(Array.isArray(v) ? v : v["@graph"] || [v]));
    } catch {
      invalidSchema = true;
    }
  });
  const absolute = (value: string) => {
    try {
      return siteUrl(new URL(value, r.url).href);
    } catch {
      return null;
    }
  };
  const links = $("a[href]")
    .map((_, el) => absolute($(el).attr("href") || ""))
    .get()
    .filter(Boolean)
    .slice(0, 2000);
  const images = $("img")
    .map((_, el) => ({
      url: absolute($(el).attr("src") || "") || "",
      alt: $(el).attr("alt"),
    }))
    .get()
    .filter((i) => i.url)
    .slice(0, 200);
  const title = $("title").first().text().trim(),
    description = $('meta[name="description" i]').attr("content") || "",
    h1 = $("h1")
      .map((_, el) => $(el).text().trim())
      .get();
  const canonical = absolute($('link[rel="canonical"]').attr("href") || "");
  const robots =
    ($('meta[name="robots" i]').attr("content") || "") +
    " " +
    (r.headers["x-robots-tag"] || "");
  const htmlSignals = {
    mixed:
      $('[src^="http:"]').length > 0 || $('link[href^="http:"]').length > 0,
    maps: $('iframe[src*="google"][src*="maps"]').length > 0,
    call: $('a[href^="tel:"]').length > 0,
    reviews: /testimonials|customer reviews/i.test($("body").text()),
    faq: /frequently asked|\bFAQ\b/i.test($("body").text()),
    viewport: $('meta[name="viewport"]').length > 0,
  };
  $("script,style,noscript,svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 16000);
  return {
    url: r.url,
    status: r.status,
    title,
    description,
    text,
    h1,
    links,
    images,
    bytes: r.bytes,
    canonical: $('link[rel="canonical"]').length ? canonical : null,
    noindex: /noindex|\bnone\b/i.test(robots),
    nofollow: /nofollow|\bnone\b/i.test(robots),
    schema,
    invalidSchema,
    htmlSignals,
    redirects: r.redirects,
  };
}
export async function crawl(
  url: string,
  cap: number,
  state = emptyState(url),
  checkpoint: (s: CrawlState) => Promise<void> = async () => {},
  http = safeFetch,
  wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  maxMs = 20 * 60_000,
) {
  let origin = state.origin || new URL(url).origin;
  const requestedOrigin = new URL(url).origin;
  const started = Date.now();
  if (!state.initialized) {
    const r = await http(
      origin + "/robots.txt",
      (u) =>
        new URL(u).hostname.replace(/^www\./, "") ===
        new URL(url).hostname.replace(/^www\./, ""),
    );
    if (
      r.status >= 500 ||
      r.status === 401 ||
      r.status === 403 ||
      r.status === 429
    )
      throw new Error(
        "Robots policy unavailable or access denied; crawl deferred.",
      );
    origin = new URL(r.url).origin;
    state.origin = origin;
    state.robots = r.status === 200 ? r.body : "";
    const robots = robotsRules(state.robots);
    if (robots.delay > 30)
      throw new Error(
        "Site requests a crawl delay over 30 seconds; manual audit required.",
      );
    const maps = [...robots.sitemaps, origin + "/sitemap.xml"].slice(0, 10),
      seen = new Set<string>();
    while (maps.length && seen.size < 10 && Date.now() - started < maxMs) {
      const rawMap = maps.shift()!;
      let map: string;
      try {
        map = siteUrl(new URL(rawMap, origin).href);
      } catch {
        continue;
      }
      if (
        seen.has(map) ||
        new URL(map).origin !== origin ||
        !robots.allowed(map)
      )
        continue;
      seen.add(map);
      await wait(Math.max(300, robots.delay * 1000));
      const result = await http(
        map,
        (u) => new URL(u).origin === origin && robots.allowed(u),
      ).catch(() => null);
      if (!result || result.status !== 200) continue;
      const $ = cheerio.load(result.body, { xml: true });
      $("sitemap loc").each((_, el) => {
        try {
          const next = siteUrl($(el).text());
          if (maps.length < 10) maps.push(next);
        } catch {}
      });
      $("url loc").each((_, el) => {
        try {
          const next = siteUrl($(el).text());
          if (new URL(next).origin === origin && state.sitemap.length < 5000)
            state.sitemap.push(next);
        } catch {}
      });
    }
    if (robots.allowed(origin + "/llms.txt")) {
      await wait(Math.max(300, robots.delay * 1000));
      const llms = await http(
        origin + "/llms.txt",
        (u) => new URL(u).origin === origin && robots.allowed(u),
      ).catch(() => null);
      state.llms =
        !!llms &&
        llms.status === 200 &&
        !/<html/i.test(llms.body) &&
        llms.body.trim().length > 0;
    }
    state.queue = [...new Set([...state.queue, ...state.sitemap])].slice(
      0,
      cap * 5,
    );
    state.initialized = true;
    await checkpoint(state);
  }
  const robots = robotsRules(state.robots),
    visited = new Set([
      ...state.pages.flatMap((p) => [p.url, ...p.redirects]),
      ...state.errors.map((e) => e.url),
      ...state.blocked,
    ]);
  while (
    state.queue.length &&
    state.pages.length + state.errors.length < cap &&
    Date.now() - started < maxMs
  ) {
    const next = state.queue[0];
    if (visited.has(next)) {
      state.queue.shift();
      continue;
    }
    visited.add(next);
    if (!robots.allowed(next)) {
      state.blocked.push(next);
      state.queue.shift();
      await checkpoint(state);
      continue;
    }
    await wait(Math.max(300, robots.delay * 1000));
    try {
      const r = await http(
        next,
        (u) =>
          [origin, requestedOrigin].includes(new URL(u).origin) &&
          robots.allowed(u),
      );
      if (
        r.headers["content-type"] &&
        !/html|xhtml/i.test(r.headers["content-type"])
      ) {
        state.errors.push({
          url: next,
          message: "Non-HTML response excluded from page checks.",
        });
      } else if (new URL(r.url).origin !== origin) {
        state.errors.push({
          url: next,
          message:
            "Redirect leaves the selected origin; destination excluded from audit.",
        });
      } else {
        // Several discovered aliases can redirect to the same page. Count the
        // destination once so aliases cannot fabricate duplicate-content findings.
        if (state.pages.some((p) => p.url === r.url)) {
          state.queue.shift();
          await checkpoint(state);
          continue;
        }
        const page = parsePage(r);
        state.pages.push(page);
        visited.add(r.url);
        for (const redirect of r.redirects) visited.add(redirect);
        if (!page.nofollow)
          for (const link of page.links)
            if (
              new URL(link).origin === origin &&
              !visited.has(link) &&
              !state.queue.includes(link) &&
              state.queue.length < cap * 5
            )
              state.queue.push(link);
      }
    } catch {
      state.errors.push({
        url: next,
        message:
          "Request failed, exceeded a limit, or was blocked by the network safety policy.",
      });
    }
    state.queue.shift();
    await checkpoint(state);
  }
  return state;
}
const businessTypes = new Set([
  "LocalBusiness", "HomeAndConstructionBusiness", "Electrician",
  "GeneralContractor", "HVACBusiness", "HousePainter", "Locksmith",
  "MovingCompany", "Plumber", "RoofingContractor",
]);
function isBusinessSchema(value: any): boolean {
  const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
  return types.some((type: unknown) => typeof type === "string" &&
    businessTypes.has(type.replace(/^https?:\/\/schema\.org\//, "")));
}
export function findingsFor(state: CrawlState, profile: any = null): Finding[] {
  const findings: Finding[] = [];
  const add = (
    id: string,
    category: Category,
    severity: Finding["severity"],
    title: string,
    urls: string[],
    why: string,
    fix: string,
  ) => {
    if (urls.length)
      findings.push({
        id,
        category,
        severity,
        title,
        urls: [...new Set(urls)],
        why,
        fix,
      });
  };
  const pages = state.pages,
    urls = (test: (p: Page) => boolean) => pages.filter(test).map((p) => p.url);
  add(
    "status",
    "technical",
    "critical",
    "HTTP errors",
    urls((p) => p.status >= 400),
    "Search engines and visitors cannot use these pages.",
    "Restore the page or redirect to a relevant replacement.",
  );
  add(
    "fetch",
    "technical",
    "warning",
    "Pages could not be checked",
    state.errors.map((e) => e.url),
    "Coverage is incomplete; these are not confirmed broken links.",
    "Check server availability, redirects, robots and network access.",
  );
  add(
    "redirects",
    "technical",
    "warning",
    "Redirect chains",
    urls((p) => p.redirects.length > 1),
    "Extra hops delay access.",
    "Link directly to the final URL and use one redirect.",
  );
  add(
    "https",
    "technical",
    "critical",
    "Pages use HTTP",
    urls((p) => p.url.startsWith("http:")),
    "Unencrypted pages expose traffic.",
    "Enable HTTPS and redirect HTTP to HTTPS.",
  );
  add(
    "mixed",
    "technical",
    "warning",
    "Mixed content",
    urls((p) => p.url.startsWith("https:") && p.htmlSignals.mixed),
    "Browsers may block insecure resources.",
    "Use HTTPS for scripts, styles and images.",
  );
  add(
    "canonical",
    "technical",
    "warning",
    "Missing or conflicting canonical",
    urls((p) => !p.canonical || p.canonical !== p.url),
    "Ambiguous preferred URLs can split indexing signals.",
    "Review and set the intended absolute canonical URL.",
  );
  add(
    "noindex",
    "technical",
    "warning",
    "Noindex pages",
    urls((p) => p.noindex),
    "These pages request exclusion from search.",
    "Remove noindex only if the page should appear in search.",
  );
  add(
    "nofollow",
    "technical",
    "info",
    "Nofollow pages",
    urls((p) => p.nofollow),
    "Links on these pages discourage crawler discovery.",
    "Review whether nofollow is intentional.",
  );
  add(
    "sitemap",
    "technical",
    "warning",
    "Pages absent from discovered sitemaps",
    urls((p) => !state.sitemap.includes(p.url)),
    "Sitemaps help discovery but do not guarantee indexing.",
    "Add indexable canonical pages to an XML sitemap and declare it in robots.txt.",
  );
  add(
    "robots",
    "technical",
    "info",
    "Robots exclusions",
    state.blocked,
    "These URLs were not crawled.",
    "Review exclusions; keep private and duplicate content blocked.",
  );
  for (const field of ["title", "description"] as const) {
    add(
      field,
      "content",
      "warning",
      `Missing or long ${field}`,
      urls(
        (p) => !p[field] || p[field].length > (field === "title" ? 60 : 160),
      ),
      "Clear search snippets help people choose a result.",
      "Write a unique factual title (about 60 characters) and meta description (about 160 characters).",
    );
    add(
      "duplicate-" + field,
      "content",
      "warning",
      `Duplicate ${field}`,
      urls(
        (p) =>
          !!p[field] && pages.filter((q) => q[field] === p[field]).length > 1,
      ),
      "Identical snippets make pages hard to distinguish.",
      "Describe each page’s specific subject.",
    );
  }
  add(
    "h1",
    "content",
    "warning",
    "Missing or multiple H1 headings",
    urls((p) => p.h1.length !== 1),
    "A clear main heading explains the page topic.",
    "Use one descriptive main H1 and organized subheadings.",
  );
  add(
    "thin",
    "content",
    "warning",
    "Limited readable content",
    urls((p) => p.text.split(/\s+/).length < 150),
    "Limited text may not answer visitor questions; short pages can still be appropriate.",
    "Add useful original scope, process and answers supported by business facts.",
  );
  add(
    "alt",
    "content",
    "warning",
    "Images missing alt attributes",
    urls((p) => p.images.some((i) => i.alt === undefined)),
    "Assistive technology needs meaningful alternatives.",
    "Describe informative images; use empty alt for decoration.",
  );
  add(
    "weight",
    "performance",
    "warning",
    "Large HTML payload",
    urls((p) => p.bytes > 500_000),
    "Large documents delay parsing; this is HTML size, not total transferred page weight.",
    "Reduce HTML size and measure full resources in PageSpeed.",
  );
  add(
    "mobile",
    "performance",
    "warning",
    "Missing mobile viewport",
    urls((p) => !p.htmlSignals.viewport),
    "Mobile layout may render at desktop width.",
    "Add a width=device-width viewport and test responsive layouts.",
  );
  add(
    "schema-invalid",
    "local",
    "warning",
    "Invalid or incomplete business structured data",
    urls(
      (p) =>
        p.invalidSchema ||
        p.schema.some(
          (s) =>
            isBusinessSchema(s) &&
            (!s.name || (!s.address && !s.areaServed)),
        ),
    ),
    "Unparseable or incomplete markup reduces machine understanding.",
    "Validate JSON-LD syntax and provide known name and address or service area.",
  );
  add(
    "schema",
    "local",
    "warning",
    "Business schema not found",
    pages.length &&
      !pages.some((p) =>
        p.schema.some(isBusinessSchema),
      )
      ? [pages[0].url]
      : [],
    "Structured facts help identify the business.",
    "Add verified LocalBusiness JSON-LD; omit unknown facts.",
  );
  for (const [key, title, fix] of [
    [
      "maps",
      "Google Maps embed not found",
      "Embed the correct Google Maps listing if useful.",
    ],
    [
      "call",
      "Click-to-call link not found",
      "Add a tel: link using the verified phone number.",
    ],
    [
      "reviews",
      "Review or testimonial content not found",
      "Add authentic customer feedback with permission.",
    ],
  ] as const)
    add(
      key,
      "local",
      "info",
      title,
      pages.length && !pages.some((p) => p.htmlSignals[key])
        ? [pages[0].url]
        : [],
      "This is a heuristic across scanned pages, not proof of absence.",
      fix,
    );
  if (profile && pages.length) {
    const text = pages
        .map((p) => p.text)
        .join(" ")
        .toLowerCase(),
      digits = text.replace(/\D/g, "");
    for (const [key, label] of [
      ["business_name", "name"],
      ["address", "street address"],
      ["phone", "phone"],
    ] as const)
      if (
        profile[key] &&
        !(key === "phone"
          ? digits.includes(String(profile[key]).replace(/\D/g, ""))
          : text.includes(String(profile[key]).toLowerCase()))
      )
        add(
          "nap-" + key,
          "local",
          "warning",
          `GBP ${label} not matched`,
          [pages[0].url],
          "The synced GBP value was not found verbatim in scanned text; formatting may differ.",
          "Confirm the visible NAP matches the linked Google Business Profile.",
        );
    for (const [key, label] of [
      ["services", "service"],
      ["service_areas", "service-area"],
    ] as const)
      for (const value of profile[key] || [])
        if (
          !pages.some((p) =>
            (p.title + " " + p.h1.join(" "))
              .toLowerCase()
              .includes(value.toLowerCase()),
          )
        )
          add(
            "gap-" + key + "-" + value,
            "local",
            "warning",
            `No matching ${label} page: ${value}`,
            [pages[0].url],
            "No scanned title or H1 matched this synced GBP entry.",
            "Create a useful page only if you actually offer this service or serve this area.",
          );
  }
  for (const agent of [
    "GPTBot",
    "ClaudeBot",
    "PerplexityBot",
    "Google-Extended",
  ])
    add(
      "bot-" + agent,
      "ai-readiness",
      "info",
      `${agent} blocked by robots`,
      urls((p) => !robotsRules(state.robots, agent).allowed(p.url)),
      "Crawler access is a business choice, not a promise of AI visibility.",
      "Review this bot’s robots rules against your content policy.",
    );
  add(
    "llms",
    "ai-readiness",
    "info",
    "llms.txt not found",
    !state.llms && pages.length ? [pages[0].url] : [],
    "This optional emerging convention offers a curated content index; ranking benefits are unproven.",
    "Optionally publish a factual Markdown index of key pages.",
  );
  add(
    "faq",
    "ai-readiness",
    "info",
    "FAQ content not detected",
    pages.length && !pages.some((p) => p.htmlSignals.faq) ? [pages[0].url] : [],
    "Direct answers can help readers and machine extraction.",
    "Add visible questions and factual answers; review all AI drafts.",
  );
  add(
    "structured",
    "ai-readiness",
    "warning",
    "No structured data",
    urls((p) => !p.schema.length),
    "Machines have less explicit context.",
    "Add appropriate factual JSON-LD matching visible page content.",
  );
  add(
    "js",
    "ai-readiness",
    "warning",
    "Little server-rendered text",
    urls((p) => p.text.length < 100),
    "Client rendering may hide content from crawlers; this is a heuristic.",
    "Serve meaningful HTML before JavaScript and verify rendering.",
  );
  add(
    "oversized-images",
    "performance",
    "warning",
    "Oversized sampled images",
    (state.imageChecks || [])
      .filter((i) => i.bytes > 300_000)
      .flatMap((i) => i.pages),
    "These sampled image responses exceed 300 KB.",
    "Resize and compress images; serve responsive modern formats.",
  );
  add(
    "broken-links",
    "technical",
    "warning",
    "Broken checked links",
    state.linkChecks
      .filter(
        (c) =>
          c.status !== null &&
          c.status >= 400 &&
          c.status !== 403 &&
          c.status !== 429,
      )
      .map((c) => c.url),
    "These sampled link targets returned an HTTP error.",
    "Update or remove broken links after verifying the destination.",
  );
  return findings.sort(
    (a, b) =>
      ({ critical: 0, warning: 1, info: 2 })[a.severity] -
      { critical: 0, warning: 1, info: 2 }[b.severity],
  );
}
export function scoresFor(findings: Finding[], state: CrawlState, psi: any[]) {
  const scores: Record<string, number | null> = {};
  for (const category of categories)
    scores[category] = !state.pages.length
      ? null
      : category === "performance"
        ? null
        : Math.max(
            0,
            100 -
              findings
                .filter((f) => f.category === category)
                .reduce(
                  (n, f) =>
                    n + { critical: 20, warning: 8, info: 2 }[f.severity],
                  0,
                ),
          );
  const measured = psi.filter((p) => typeof p.score === "number");
  if (measured.length)
    scores.performance = Math.round(
      measured.reduce((n, p) => n + p.score, 0) / measured.length,
    );
  const available = Object.values(scores).filter(
    (n): n is number => n !== null,
  );
  return {
    overall: available.length
      ? Math.round(available.reduce((a, b) => a + b, 0) / available.length)
      : null,
    categories: scores,
  };
}
