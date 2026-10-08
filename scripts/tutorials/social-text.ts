/**
 * What each social platform's post says about a walkthrough — built, not hand-written, from the same
 * true material as the YouTube description (server/youtube/description.ts): the producer's title and
 * headline, the help entry, and the area's hashtags. Pure and deterministic.
 *
 * Rules (the same as the YouTube description, plus the platforms' own):
 *   · every sentence comes from the help entry or the step script — nothing is invented;
 *   · the recording is a demo workspace, and a post never presents its figures as anyone's results;
 *   · no vendor names, no superlatives or promises, no price (unless the help entry states one),
 *     "the CRM is a separate product with its own plans" — never "included";
 *   · constructhub.us is the only address a post gives.
 *
 * Limits, as published by the platforms and repeated in Blotato's media requirements
 * (https://help.blotato.com/rest-api-reference/publish-post/media.md, read 2026-10-08):
 *   Instagram  caption 2,200 characters. Hashtags: Instagram has enforced FIVE per post or Reel since
 *              December 2025 (it was 30) — more are blocked or stripped, so a post carries 5, not 8–12.
 *   TikTok     description 2,200 characters.
 *   LinkedIn   3,000 characters per post.
 *   Facebook   63,206 characters.
 *   X          280 characters per post through Blotato (we keep to 270; a link counts as 23 there,
 *              so counting it in full is the safe side).
 *   Threads    500 characters per post.
 */
import { AREAS, areaFor, bannedIn, pick, plain, rotate, sentences, taskOf } from "../../server/youtube/description";
import type { CutName } from "./social-lib";

export type SocialPlatform = "instagram" | "tiktok" | "linkedin" | "facebook" | "twitter" | "threads";
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = ["instagram", "tiktok", "linkedin", "facebook", "twitter", "threads"];

export type PlatformRule = {
  /** The platform's own limit, and ours (never above it). */
  limit: number; max: number;
  /** The length a post aims for: material is added up to it and taken away above `max`. */
  aim: number;
  hashtags: { min: number; max: number; use: number };
  /** Which cut it gets. Shorts-style players get the vertical one; feeds get 4:5 with the fuller walkthrough. */
  cut: CutName;
};
export const PLATFORM_RULES: Record<SocialPlatform, PlatformRule> = {
  // 1,200–1,800 characters of readable caption. FIVE hashtags: Instagram's own cap since December 2025.
  instagram: { limit: 2200, max: 1800, aim: 1350, hashtags: { min: 3, max: 5, use: 5 }, cut: "vertical" },
  tiktok: { limit: 2200, max: 900, aim: 0, hashtags: { min: 4, max: 6, use: 5 }, cut: "vertical" },
  // 900–1,400 characters, professional.
  linkedin: { limit: 3000, max: 1400, aim: 1050, hashtags: { min: 3, max: 5, use: 4 }, cut: "feed" },
  facebook: { limit: 63206, max: 1200, aim: 0, hashtags: { min: 2, max: 3, use: 3 }, cut: "feed" },
  twitter: { limit: 280, max: 270, aim: 0, hashtags: { min: 0, max: 2, use: 2 }, cut: "vertical" },
  // Blotato accepts Threads video up to 60 s: the vertical cut (≤ 59 s) is the one that fits.
  threads: { limit: 500, max: 480, aim: 0, hashtags: { min: 0, max: 2, use: 2 }, cut: "vertical" },
};

export const TUTORIALS_URL = "https://constructhub.us/tutorials";
const TUTORIALS_BARE = "constructhub.us/tutorials";
/** Said once in every longer post, so sample figures are never read as a customer's. */
export const DEMO_NOTE = "Shown on a demo workspace - the people, jobs and amounts are sample data.";
export const CRM_NOTE = "The CRM is a separate product with its own plans.";

export type SocialEntry = { title: string; whatItIs: string; whatItDoes: string; howToUse: readonly string[]; howItWorks?: string; needs?: readonly string[]; group: string };
export type SocialTextInput = {
  helpKey: string;
  /** The producer's YouTube title ("How to … | ConstructHUB CRM") or, without one, the script's title. */
  title: string;
  /** The thumbnail headline — the hook ("Send estimates fast"). */
  headline?: string | null;
  entry?: SocialEntry | null;
  track?: string | null;
};
export type SocialPost = { text: string; hashtags: string[]; length: number; limit: number; cut: CutName };
export type SocialText = { helpKey: string; hook: string; area: string; platforms: Record<SocialPlatform, SocialPost>; notes: string[] };

/** Hashtags that fit any contractor video; the area's own two come first. */
const GENERAL_TAGS = ["#construction", "#generalcontractor", "#contractortips", "#smallbusiness", "#remodeling", "#roofing", "#homeimprovement", "#constructionbusiness"];

/** Two sentences say the same thing when half of the shorter one's three-word runs are in the other. */
export function sameThing(a: string, b: string): boolean {
  const runs = (t: string) => { const w = t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean), s = new Set<string>(); for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(" ")); return s; };
  const x = runs(a), y = runs(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  x.forEach((r) => { if (y.has(r)) both++; });
  return both / Math.min(x.size, y.size) >= 0.5;
}
const endStop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const hashtagsIn = (text: string): string[] => text.match(/(?<![\w&])#[A-Za-z][A-Za-z0-9_]*/g) ?? [];

/** What may not be in a post, beyond the description's banned words. Returns what is wrong (empty = fine). */
export function lintPost(platform: SocialPlatform, text: string, entryText = ""): string[] {
  const rule = PLATFORM_RULES[platform], bad: string[] = [];
  if (text.length > rule.max) bad.push(`${text.length} characters, over ${rule.max}`);
  if (text.length > rule.limit) bad.push(`over ${platform}'s limit of ${rule.limit}`);
  const tags = hashtagsIn(text);
  if (tags.length < rule.hashtags.min || tags.length > rule.hashtags.max) bad.push(`${tags.length} hashtags, wants ${rule.hashtags.min}-${rule.hashtags.max}`);
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) bad.push("a hashtag is repeated");
  for (const b of bannedIn(text)) bad.push(`says "${b}"`);
  // A price only when the help entry itself states it.
  for (const m of text.match(/\$\s?\d[\d,.]*/g) ?? []) if (!entryText.includes(m)) bad.push(`a price (${m}) that the help entry does not state`);
  // The only address is constructhub.us (no sub-domain, no other site).
  for (const m of text.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:us|com|io|net|org|app|co|ai)\b/gi) ?? [])
    if (!/^(?:https?:\/\/)?constructhub\.us$/i.test(m)) bad.push(`an address other than constructhub.us (${m})`);
  if (/\b(?:real|actual)\s+(?:results?|customers?|clients?|numbers?|revenue)\b|\bour customers?\b|\bresults? (?:like|you)\b/i.test(text)) bad.push("reads as a claim about real results");
  return bad;
}

/**
 * Three short lines that say what the feature gives you: the help entry's own sentences first
 * (what it does, then what it is), the area's facts after — each one under `maxLen` characters,
 * none repeated, none that breaks a rule.
 */
export function benefitLines(input: SocialTextInput, area: string, maxLen = 120, count = 3): string[] {
  const e = input.entry;
  const pool = [...sentences(e?.whatItDoes ?? ""), ...sentences(e?.whatItIs ?? ""), ...rotate(AREAS[area]?.why ?? [], input.helpKey, "social-why")];
  const out: string[] = [];
  for (const maxNow of [maxLen, maxLen + 40, 400]) {
    for (const raw of pool) {
      if (out.length >= count) break;
      const s = endStop(plain(raw));
      if (s.length > maxNow || s.length < 20 || bannedIn(s).length || /\$\s?\d/.test(s) || out.some((y) => sameThing(s, y))) continue;
      out.push(s);
    }
  }
  return out;
}

export function buildSocialText(input: SocialTextInput): SocialText {
  const notes: string[] = [], key = input.helpKey, e = input.entry ?? null;
  const area = areaFor({ helpKey: key, track: input.track, group: e?.group }), A = AREAS[area] ?? AREAS.crm;
  const crm = area !== "permits" && area !== "platform";
  const product = crm ? "ConstructHUB CRM" : "ConstructHUB";
  const ok = (t: string) => !bannedIn(t).length && !/\$\s?\d/.test(t);
  const task = taskOf(input.title) || plain(e?.title ?? key);
  const taskLine = endStop(/^how to\b/i.test(task) ? `${task} ${crm ? "in" : "on"} ${product}` : `${task} - a ${product} walkthrough`);
  const headline = plain(input.headline ?? "").replace(/[.!]+$/, "");
  const hook = headline && ok(headline) ? endStop(headline.charAt(0).toUpperCase() + headline.slice(1)) : taskLine;
  if (input.headline && hook === taskLine) notes.push("the headline was left out of the posts (it breaks a rule)");
  const lead = hook === taskLine ? taskLine : `${hook} ${taskLine}`;

  // The true material, cleaned once: the help entry's own words, then the area's facts and search phrases.
  const whatIs = sentences(e?.whatItIs ?? "").map((x) => endStop(plain(x))).filter(ok);
  const whatDoes = sentences(e?.whatItDoes ?? "").map((x) => endStop(plain(x))).filter(ok);
  const how = (e?.howToUse ?? []).map((x) => endStop(plain(x))).filter(ok).slice(0, 5);
  const said = new Set([...whatIs, ...whatDoes]);
  // An area fact that only repeats what the entry already said (or another fact) is left out.
  const why: string[] = [];
  for (const x of rotate(A.why, key, "social-why").map((y) => endStop(plain(y)))) if (ok(x) && ![...said, ...why].some((y) => sameThing(x, y))) why.push(x);
  const phrases = rotate(A.keywords, key, "social-terms").filter(ok).slice(0, 3);
  const looking = phrases.length === 3 ? pick([
    `For contractors looking for ${phrases[0]}, ${phrases[1]} or ${phrases[2]}.`,
    `If you have been searching for ${phrases[0]}, ${phrases[1]} or ${phrases[2]}, this is that screen.`,
    `Made for contractors searching for ${phrases[0]}, ${phrases[1]} or ${phrases[2]}.`,
  ], key, "social-looking") : null;
  const benefits = benefitLines(input, area);
  if (benefits.length < 3) notes.push(`only ${benefits.length} benefit line(s): the help entry and the area have no more short, clean sentences`);
  const closer = pick(["Watch the full walkthrough", "See every step", "The full tutorial is here"], key, "social-closer");
  const whyHead = pick(["WHY CONTRACTORS USE IT", "GOOD TO KNOW", "WHAT YOU GET"], key, "social-whyhead");
  const howHead = pick(["HOW IT WORKS", "STEP BY STEP", "THE SHORT VERSION"], key, "social-howhead");
  // The CRM videos are recorded in a demo workspace (sample people and amounts). The platform pages show the real directory data.
  const fine = crm ? `${CRM_NOTE} ${DEMO_NOTE}` : "";

  const tagPool = ["#contractors", ...A.hashtags, "#ConstructHUB", ...rotate(GENERAL_TAGS, key, "social-tags")].filter((t, i, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  const entryText = e ? [e.whatItIs, e.whatItDoes, ...e.howToUse, e.howItWorks ?? "", ...(e.needs ?? [])].join(" ") : "";

  /** A post as blocks; `extra` are added one at a time (before the last `tail` blocks) while it is under the aim, and dropped from the end while over the cap. */
  type Draft = { head: string[]; extra: string[]; tail: string[]; sep: string };
  const drafts: Record<SocialPlatform, Draft> = {
    instagram: {
      head: [lead, [...whatIs.slice(0, 1), ...whatDoes.slice(0, 2)].join(" "), how.length ? `${howHead}\n${how.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "", `${whyHead}\n• ${why[0] ?? benefits[0] ?? ""}`],
      extra: [...why.slice(1, 6).map((x) => `• ${x}`)],
      tail: [looking ?? "", `Full tutorial: link in bio / ${TUTORIALS_BARE}`, fine], sep: "\n\n",
    },
    tiktok: { head: [lead, whatIs[0] ?? benefits[0] ?? ""], extra: [], tail: [`Full tutorial: ${TUTORIALS_BARE}`], sep: "\n" },
    linkedin: {
      head: [`${endStop(/^how to\b/i.test(task) ? `${task} ${crm ? "in" : "on"} ${product}` : task)} A short walkthrough for contractors and owners.`, [...whatIs.slice(0, 2), ...whatDoes.slice(0, 2)].join(" "), why.slice(0, 2).join(" ")],
      extra: why.slice(2, 6),
      tail: [fine, `${closer}: ${TUTORIALS_URL}`], sep: "\n\n",
    },
    facebook: { head: [lead, whatIs[0] ?? "", benefits.filter((b) => b !== whatIs[0]).slice(0, 2).map((b) => `• ${b}`).join("\n")], extra: [], tail: [`${closer}: ${TUTORIALS_URL}`, crm ? DEMO_NOTE : ""], sep: "\n\n" },
    twitter: { head: [lead], extra: [], tail: [`Full tutorial: ${TUTORIALS_URL}`], sep: " " },
    threads: { head: [lead, benefits.find((b) => b !== whatIs[0]) ?? whatIs[0] ?? ""], extra: [], tail: [`Full tutorial: ${TUTORIALS_BARE}`], sep: "\n\n" },
  };

  const platforms = {} as Record<SocialPlatform, SocialPost>;
  for (const p of SOCIAL_PLATFORMS) {
    const rule = PLATFORM_RULES[p], d = drafts[p];
    const head = d.head.filter(Boolean), tail = d.tail.filter(Boolean), extra = [...d.extra];
    const hashtags = tagPool.slice(0, rule.hashtags.use);
    const used: string[] = [];
    const join = () => {
      // Bullets that follow a bulleted block stay in it (one line each), everything else is its own block.
      let body = "";
      for (const blk of [...head, ...used, ...tail]) body += body && blk.startsWith("• ") && /(^|\n)• [^\n]*$/.test(body) ? `\n${blk}` : body ? `${d.sep}${blk}` : blk;
      return [body, hashtags.join(" ")].filter(Boolean).join(d.sep === " " ? " " : "\n\n");
    };
    while (extra.length && join().length < rule.aim) used.push(extra.shift()!);
    // Too long: the added lines go first, then hashtags (down to the platform's minimum), then the headline, then the middle.
    while (join().length > rule.max && used.length) used.pop();
    while (join().length > rule.max && hashtags.length > rule.hashtags.min) hashtags.pop();
    if (join().length > rule.max && head[0] === lead && lead !== taskLine) { head[0] = taskLine; notes.push(`${p}: the headline was dropped to fit ${rule.max} characters`); }
    while (join().length > rule.max && head.length > 1) { head.pop(); notes.push(`${p}: a block was dropped to fit ${rule.max} characters`); }
    const text = join();
    if (rule.aim && text.length < rule.aim * 0.85) notes.push(`${p}: ${text.length} characters - the help entry and the area have no more true material to reach ${rule.aim}`);
    const wrong = lintPost(p, text, entryText);
    if (wrong.length) throw new Error(`${key}: the ${p} post ${wrong.join("; ")}`);
    platforms[p] = { text, hashtags, length: text.length, limit: rule.limit, cut: rule.cut };
  }
  return { helpKey: key, hook, area, platforms, notes };
}
