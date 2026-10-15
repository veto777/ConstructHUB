/**
 * The contact finder: a vetted site whose found page and home page published no email gets its own contact pages read
 * (contact, advertise, write-for-us, about, staff/newsroom), linked from its home page or at the usual paths. Free: our
 * own requests through the SSRF-safe fetcher. Only addresses the site itself publishes are kept (vet.ts extractEmails).
 */
import * as cheerio from "cheerio";
import { normalizeDomain } from "./discover";
import { extractEmails, vetDeps } from "./vet";

/** Same-site pages worth reading for an address, best first. */
const PAGE_KINDS: { re: RegExp; rank: number }[] = [
  { re: /\bcontact|get in touch|reach us/, rank: 0 },
  { re: /advertis|media kit|sponsor|partner/, rank: 1 },
  { re: /write for us|contribut|guest post|submit|news ?tip|press release/, rank: 2 },
  { re: /about/, rank: 3 },
  { re: /staff|team|newsroom|editor|masthead|people/, rank: 4 },
];
const USUAL_PATHS = ["/contact", "/contact-us", "/about", "/about-us", "/advertise"];
export const MAX_CONTACT_PAGES = 6;

/** The same-site links on a page that look like contact pages, best first. */
export function contactLinks(html: string, pageUrl: string, domain: string): string[] {
  const $ = cheerio.load(html || "");
  const found = new Map<string, number>();
  $("a[href]").each((_, a) => {
    let abs: URL;
    try { abs = new URL(String($(a).attr("href")), pageUrl); } catch { return; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    const host = normalizeDomain(abs.href);
    if (!host || (host !== domain && !host.endsWith(`.${domain}`))) return;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(abs.pathname)) return;
    const label = `${$(a).text()} ${decodeURIComponent(abs.pathname)}`.toLowerCase().replace(/[-_/]+/g, " ");
    const kind = PAGE_KINDS.find((k) => k.re.test(label));
    if (!kind) return;
    abs.hash = "";
    const key = abs.href;
    if (!found.has(key) || found.get(key)! > kind.rank) found.set(key, kind.rank);
  });
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([u]) => u);
}

export type ContactSearch = { emails: string[]; contactUrl: string | null; pagesRead: number };

/** Read up to MAX_CONTACT_PAGES of the site's own pages until one publishes an address. */
export async function findContacts(domain: string, knownContactUrl: string | null = null): Promise<ContactSearch> {
  const home = `https://${domain}/`;
  const tried = new Set<string>();
  let contactUrl = knownContactUrl;
  let pagesRead = 0;
  const read = async (url: string): Promise<{ emails: string[]; body: string; url: string } | null> => {
    if (tried.has(url) || pagesRead >= MAX_CONTACT_PAGES) return null;
    tried.add(url);
    pagesRead++;
    const page = await vetDeps.fetch(url).catch(() => null);
    if (!page || page.status >= 400 || !page.body) return null;
    const $ = cheerio.load(page.body);
    $("script, style, noscript, template").remove();
    return { emails: extractEmails($, domain), body: page.body, url: page.url || url };
  };
  const queue: string[] = [];
  if (knownContactUrl) queue.push(knownContactUrl);
  const h = await read(home);
  if (h?.emails.length) return { emails: h.emails, contactUrl, pagesRead };
  if (h) queue.push(...contactLinks(h.body, h.url, domain));
  queue.push(...USUAL_PATHS.map((p) => `https://${domain}${p}`));
  for (const url of queue) {
    if (pagesRead >= MAX_CONTACT_PAGES) break;
    const r = await read(url);
    if (!r) continue;
    if (!contactUrl && /contact/i.test(r.url)) contactUrl = r.url;
    if (r.emails.length) return { emails: r.emails, contactUrl: contactUrl ?? r.url, pagesRead };
  }
  return { emails: [], contactUrl, pagesRead };
}
