import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { HELP_ENTRIES, HELP_FEATURES, HELP_GROUPS, INTRO_FALLBACKS, NO_INTRO_FALLBACK, helpEntry, helpKeyForRoute, helpMatches, helpSections, helpSummary, introFallbackKey, isCrmRoute } from "@shared/help/registry";
import { parseTutorialScript, STEP_ACTIONS } from "@shared/help/step-script";
import { TUTORIAL_FILE, VIDEO_MANIFEST, helpVideoFor, tutorialMediaUrl } from "@shared/help/videos";
import { createHash } from "crypto";
import { indexes } from "../scripts/tutorials/gen-index";
import { HELP_GROUPS as GROUPS } from "@shared/help/types";
import { isKnownPath } from "@shared/app-routes";
import { PLANS, PLAN_KEYS, planForModule } from "@shared/plans";
import { VOICE_PERSONAS, VOICE_PERSONA_IDS } from "@shared/voice-personas";
import { FEATURE_CATALOGUE } from "@shared/feature-pages";
import { introVideoKey } from "@shared/feature-pages/intro-video";

/**
 * Static integrity checks for the help registry (shared/help/registry.ts) — no server needed.
 * It is the ONE source behind the "i" buttons (<HelpButton k="…" />), the walkthrough-video slot and
 * the /tutorials page, so a missing key, an empty part, a route the app does not answer or a video
 * that does not exist would all ship as a broken or dishonest help panel.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const CLIENT_ROOT = path.join(ROOT, "client/src");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield p;
  }
}

/**
 * The feature pages' intro films (shared/feature-pages/intro-video.ts): `intro-<slug>` for a page of the feature
 * catalogue. Not help entries — no "i" panel, no card on /tutorials — but a video all the same, so a manifest
 * or a step script under one of these keys is held to the same proof as an entry's.
 */
const INTRO_KEYS = new Set(FEATURE_CATALOGUE.map((e) => introVideoKey(e.key)));
/** The key names a help entry or a feature page's intro film. */
const knownVideoKey = (key: string) => !!helpEntry(key) || INTRO_KEYS.has(key);

/** Every help key mounted in the client: <HelpButton k="…" /> and the `helpKey: "…"` rows of a tab list. */
function mountedKeys(): { key: string; where: string }[] {
  const found: { key: string; where: string }[] = [];
  for (const file of walk(CLIENT_ROOT)) {
    if (/help-button\.tsx$|\.test\.[tj]sx?$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const where = path.relative(CLIENT_ROOT, file);
    for (const m of src.matchAll(/<HelpButton\s+k="([^"]+)"/g)) found.push({ key: m[1], where });
    for (const m of src.matchAll(/helpKey:\s*"([^"]+)"/g)) found.push({ key: m[1], where });
  }
  return found;
}

describe("help registry", () => {
  it("every mounted HelpButton key exists", () => {
    const mounts = mountedKeys();
    // An empty sweep would mean the regexes rotted, not that nothing is missing.
    expect(mounts.length).toBeGreaterThanOrEqual(15);
    expect(mounts.filter(({ key }) => !helpEntry(key)).map(({ key, where }) => `${key} (mounted in ${where})`)).toEqual([]);
    // No dynamic keys: a computed k={…} cannot be checked here.
    for (const file of walk(CLIENT_ROOT)) {
      if (/help-button\.tsx$/.test(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/<HelpButton\s+k=\{([^}]+)\}/g)) expect(m[1].trim(), `${path.relative(CLIENT_ROOT, file)} mounts a computed key`).toBe("helpKey");
    }
  });

  it("Cloudflare and Search Console have an 'i' on the page title and on every tab and major section", () => {
    const keys = new Set(mountedKeys().filter((m) => m.where === "pages/site-connections.tsx").map((m) => m.key));
    for (const k of [
      "cloudflare", "cloudflare.sites", "cloudflare.connections", "cloudflare.onboarding", "cloudflare.work-queue",
      "cloudflare.edge-audit", "cloudflare.guide", "cloudflare.protection",
      "search-console", "search-console.sites", "search-console.connections", "search-console.onboarding",
      "search-console.work-queue", "search-console.guide", "search-console.sync-range", "search-console.analytics",
      "search-console.sitemaps-indexing",
    ]) expect(keys.has(k), k).toBe(true);
    // Every section in the registry is mounted somewhere: no orphan help text.
    // A section is reachable with its own "i" on the page, or listed under its feature's card on /tutorials (helpSections)
    // and behind the feature's "i" ("All tutorials"): the deep-dive walkthroughs (2026-10-13) are sections of listed features.
    for (const s of HELP_ENTRIES.filter((e) => e.parent)) expect(keys.has(s.key) || !helpEntry(s.parent!)?.unlisted, `${s.key} is mounted or listed under ${s.parent}`).toBe(true);
  });

  it("every entry has its four parts, a group and unique key", () => {
    const seen = new Set<string>();
    for (const e of HELP_ENTRIES) {
      expect(seen.has(e.key), `duplicate key ${e.key}`).toBe(false);
      seen.add(e.key);
      expect(e.key, "key shape").toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)?$/);
      expect(e.title.trim().length, `${e.key} title`).toBeGreaterThan(0);
      expect(e.whatItIs.trim().length, `${e.key} what it's for`).toBeGreaterThan(20);
      expect(e.whatItDoes.trim().length, `${e.key} what it does`).toBeGreaterThan(20);
      expect(e.howItWorks.trim().length, `${e.key} how it works`).toBeGreaterThan(20);
      expect(e.howToUse.length, `${e.key} steps`).toBeGreaterThanOrEqual(3);
      expect(e.howToUse.length, `${e.key} steps`).toBeLessThanOrEqual(5);
      for (const step of e.howToUse) expect(step.trim().length, `${e.key} step`).toBeGreaterThan(5);
      expect(new Set(e.howToUse).size, `${e.key} repeats a step`).toBe(e.howToUse.length);
      for (const n of e.needs ?? []) expect(n.trim().length, `${e.key} need`).toBeGreaterThan(5);
      expect(HELP_GROUPS, `${e.key} group`).toContain(e.group);
      // The card's one-liner is a whole sentence.
      expect(helpSummary(e)).toMatch(/[.!?]$/);
    }
  });

  it("a section belongs to a feature on the same page", () => {
    for (const e of HELP_ENTRIES.filter((x) => x.parent)) {
      const parent = helpEntry(e.parent!);
      expect(parent, `${e.key} parent`).toBeTruthy();
      expect(parent!.parent, `${e.key} is nested two deep`).toBeUndefined();
      expect(e.key.startsWith(`${parent!.key}.`), `${e.key} key prefix`).toBe(true);
      // A section shares its feature's route, or declares one under it ("/call-assistant/calls") so the page title's "i" switches per view (helpKeyForRoute).
      expect(e.route === parent!.route || e.route.startsWith(`${parent!.route}/`), `${e.key} route ${e.route} is under ${parent!.route}`).toBe(true);
      expect(e.group).toBe(parent!.group);
    }
    expect(helpSections("cloudflare").length).toBe(7);
    expect(helpSections("search-console").length).toBe(8);
  });

  it("every route is a path the app answers (shared/app-routes.ts) and has a <Route> in App.tsx", () => {
    const app = read("client/src/App.tsx");
    const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
    for (const e of HELP_ENTRIES) {
      expect(e.route, `${e.key} route`).toMatch(/^\/[a-z0-9/-]*$/);
      expect(isKnownPath(e.route), `${e.key} → ${e.route}`).toBe(true);
      expect(routes.has(e.route), `${e.key} → ${e.route} in App.tsx`).toBe(true);
    }
    expect(isKnownPath("/tutorials")).toBe(true);
    expect(routes.has("/tutorials")).toBe(true);
    expect(app).toMatch(/SIGNED_IN_ONLY = \[[\s\S]*?"\/tutorials"/);
  });

  it("documents every feature the sidebars list", () => {
    const featureRoutes = new Set(HELP_FEATURES.map((f) => f.route));
    // Platform sidebar: every `url: "/…"` except the pricing group's own links and the feature catalogue.
    const sidebar = read("client/src/components/app-sidebar.tsx");
    const urls = [...sidebar.matchAll(/url:\s*"(\/[^"#]*)"/g)].map((m) => m[1]).filter((u) => !/^\/(pricing|features)/.test(u));
    expect(urls.length).toBeGreaterThan(25);
    expect(urls.filter((u) => !featureRoutes.has(u)), "sidebar pages with no help entry").toEqual([]);
    expect(sidebar).toContain('href="/tutorials"');
    // CRM sidebar: the working pages (Settings and the staff console are not features to teach).
    const crm = read("client/src/components/crm-sidebar.tsx");
    const crmUrls = [...crm.matchAll(/url:\s*"(\/[^"]*)"/g)].map((m) => (m[1] === "/" ? "/crm" : m[1])).filter((u) => !["/crm/settings", "/admin"].includes(u));
    expect(crmUrls).toContain("/crm/jobcam");
    expect(crmUrls.filter((u) => !featureRoutes.has(u)), "CRM pages with no help entry").toEqual([]);
    expect(crm).toContain('marketingUrl("/tutorials');
    // "Start here" holds the overview films: one of them tours the CRM, so that group may point at either app.
    for (const f of HELP_FEATURES.filter((x) => x.group !== "Start here")) expect(isCrmRoute(f.route), `${f.key} group`).toBe(f.group === "CRM");
    expect(HELP_GROUPS[0]).toBe("Start here");
    // The owner's list, by name.
    for (const k of ["call-assistant", "social-media", "site-scan", "seo", "cloudflare", "search-console", "ip-tracker", "vpn-shield", "competitor-intel", "jobcam", "google-reviews"])
      expect(HELP_FEATURES.some((f) => f.key === k), k).toBe(true);
    for (const g of HELP_GROUPS) expect(HELP_FEATURES.some((f) => f.group === g), g).toBe(true);
  });

  it("claims no video without a manifest file whose objects were really uploaded (shared/help/videos/<key>.json)", () => {
    // One manifest file per recorded walkthrough: what mux.ts measured (its three files by storage key,
    // size and sha256, and the video's length) and what R2 answered when upload.ts put them there. The
    // registry builds `video` from it.
    const listed = Object.keys(VIDEO_MANIFEST);
    const dir = path.join(ROOT, "shared/help/videos");
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    expect(listed.slice().sort(), "shared/help/videos/index.ts is stale — npx tsx scripts/tutorials/gen-index.ts").toEqual(onDisk);
    for (const key of onDisk) expect(JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8")).helpKey, `${key}.json helpKey`).toBe(key);
    for (const key of listed) expect(knownVideoKey(key), `videos/${key}.json exists, but ${key} is neither a help entry nor a feature page's intro film`).toBe(true);
    /** A real recording under `key`: in our own storage under tutorials/, really uploaded, with its step script — never a stand-in. */
    const expectRealRecording = (key: string, video: NonNullable<ReturnType<typeof helpVideoFor>>) => {
      const m = VIDEO_MANIFEST[key];
      expect(m, `${key} has a video with no manifest file`).toBeTruthy();
      // Really uploaded: upload.ts writes the manifest only after R2 answered a HEAD for each object,
      // and records when, and the ETag R2 gave (the object's MD5 for a single-part put).
      expect(Number.isFinite(Date.parse(m.uploaded?.at)), `${key} has no upload proof — run scripts/tutorials/upload.ts`).toBe(true);
      for (const part of ["video", "captions", "poster"] as const) expect(m.uploaded[part], `${key} ${part} ETag`).toMatch(/^[0-9a-f]{32}(-\d+)?$/);
      expect(video).toEqual(helpVideoFor(key));
      expect(video.url, `${key} video url`).toMatch(/^(https:\/\/[^\s]+|\/)[^\s]*tutorials\/[^\s]+\.(mp4|webm)$/);
      expect(video.url).not.toMatch(/example|placeholder|sample|lorem|youtube|vimeo/i);
      expect(Number.isInteger(m.durationSec) && m.durationSec > 0 && m.durationSec < 1800, `${key} duration`).toBe(true);
      expect(video.durationSec).toBe(m.durationSec);
      expect(video.url).toBe(tutorialMediaUrl(m.video.key));
      expect(video.poster).toBe(tutorialMediaUrl(m.poster.key));
      expect(video.captions).toBe(tutorialMediaUrl(m.captions.key));
      for (const [part, ext, minBytes] of [["video", "mp4", 100_000], ["captions", "vtt", 50], ["poster", "jpg", 2_000]] as const) {
        const f = m[part];
        // tutorials/<helpKey>.<first 8 of its sha256>.<ext>: content-addressed, so a re-record is a new key.
        expect(f.sha256, `${key} ${part} sha256`).toMatch(/^[0-9a-f]{64}$/);
        expect(f.key, `${key} ${part} key`).toBe(`tutorials/${key}.${f.sha256.slice(0, 8)}.${ext}`);
        expect(f.key.slice("tutorials/".length)).toMatch(TUTORIAL_FILE);
        expect(Number.isInteger(f.bytes) && f.bytes >= minBytes, `${key} ${part} bytes`).toBe(true);
        // Where the file is at hand (the box that recorded it), it is the file the manifest describes.
        const local = path.join(ROOT, "tmp/tutorials", f.key.slice("tutorials/".length));
        if (fs.existsSync(local)) {
          const data = fs.readFileSync(local);
          expect(data.length, `${f.key} size on disk`).toBe(f.bytes);
          expect(createHash("sha256").update(data).digest("hex"), `${f.key} sha256 on disk`).toBe(f.sha256);
          if (/^[0-9a-f]{32}$/.test(m.uploaded[part])) expect(createHash("md5").update(data).digest("hex"), `${f.key}: the object in R2 is not this file`).toBe(m.uploaded[part]);
        }
      }
      // A walkthrough has a step script: the video is a recording of it, not a file from somewhere else.
      expect(fs.existsSync(path.join(ROOT, "docs/tutorials/scripts", `${key}.json`)), `${key} step script`).toBe(true);
    };
    for (const e of HELP_ENTRIES) {
      if (e.video === null) {
        expect(VIDEO_MANIFEST[e.key], `${e.key} has a manifest but no video`).toBeUndefined();
        // With no recording, the text must not point at one.
        const text = [e.title, e.whatItIs, e.whatItDoes, e.howItWorks, ...e.howToUse, ...(e.needs ?? [])].join(" ");
        expect(text, `${e.key} mentions a video it does not have`).not.toMatch(/walkthrough|tutorial video|watch the video/i);
        // The panel's film is then the feature's intro film — only through the reviewed map, and labelled as an intro.
        const fallback = introFallbackKey(e);
        if (e.film) {
          expect(e.videoSource, `${e.key} film source`).toBe("intro");
          expect(fallback && INTRO_KEYS.has(fallback), `${e.key} plays a film that is not its feature's intro film`).toBe(true);
          expect(e.film).toEqual(helpVideoFor(fallback!));
        } else {
          expect(e.videoSource, `${e.key} has no film`).toBeNull();
          expect(fallback === undefined || helpVideoFor(fallback) === null, `${e.key}: its feature's intro film exists but is not the panel's film`).toBe(true);
        }
        continue;
      }
      expect(e.videoSource, `${e.key} film source`).toBe("walkthrough");
      expect(e.film, `${e.key}: the panel plays the walkthrough itself`).toEqual(e.video);
      expectRealRecording(e.key, e.video);
    }
    // The feature pages' intro films: the same proof, under their own keys (none of them is a help entry).
    for (const key of listed.filter((k) => INTRO_KEYS.has(k))) {
      // An intro film has no written entry: helpEntry() synthesizes an unlisted one from its feature page (no card, no "i").
      expect(HELP_ENTRIES.some((e) => e.key === key), `${key} must not be a written help entry`).toBe(false);
      expect(helpEntry(key)?.unlisted, `${key} resolves to a synthesized, unlisted entry`).toBe(true);
      expect(helpEntry(key)?.videoSource, `${key} is an intro film`).toBe("intro");
      expectRealRecording(key, helpVideoFor(key)!);
    }
    // The intro frame never shows a play control without a video either.
    const intro = read("client/src/components/feature-landing/intro-video.tsx");
    expect(intro).toMatch(/const video = featureIntroVideo\(featureKey\);\s*if \(!video\) return null;/);
    // The UI never shows a play control without a film: the play button, the dialog and the panel are gated on `entry.film`,
    // and the label follows `videoSource` so an overview film is never called a walkthrough.
    const button = read("client/src/components/help-button.tsx");
    expect(button).toMatch(/\{entry\.film && \(\s*<>\s*<button[^>]*aria-label=\{`Watch the \$\{filmNoun\(entry\)\}/);
    expect(button).toMatch(/if \(!entry\.film\) return null;/);
    expect(button).toContain('entry.videoSource === "intro" ? "overview film" : "walkthrough"');
    expect(button).toContain("Video walkthrough coming soon");
    const page = read("client/src/pages/tutorials.tsx");
    // The player also waits for "Watch" (owner, 2026-10-13); it never renders without a real video.
    expect(page).toMatch(/if \(!entry\.video(?: \|\| !open)?\) return null;/);
    expect(page).toContain("Video coming soon");
    // No video file is checked in, and nothing in the client links one.
    expect(fs.existsSync(path.join(ROOT, "client/public/tutorials"))).toBe(false);
  });

  it("the intro-film fallback map is explicit and reviewed", () => {
    const pages = new Set(FEATURE_CATALOGUE.map((p) => p.key));
    const byKey = new Map(HELP_ENTRIES.map((e) => [e.key, e]));
    for (const [key, page] of Object.entries(INTRO_FALLBACKS)) {
      const e = byKey.get(key);
      expect(e, `INTRO_FALLBACKS: ${key} is not a help entry`).toBeTruthy();
      expect(e?.parent, `INTRO_FALLBACKS: ${key} is a section — map its feature, sections inherit`).toBeUndefined();
      expect(pages.has(page), `INTRO_FALLBACKS: ${key} → ${page} is not a feature page`).toBe(true);
      expect(NO_INTRO_FALLBACK[key], `${key} is both mapped and excused`).toBeUndefined();
    }
    for (const key of Object.keys(NO_INTRO_FALLBACK)) expect(byKey.get(key), `NO_INTRO_FALLBACK: ${key} is not a help entry`).toBeTruthy();
    // Sections inherit: a section's fallback is its feature's.
    for (const e of HELP_ENTRIES) if (e.parent) expect(introFallbackKey(e)).toBe(introFallbackKey(byKey.get(e.parent)!));
    // A main-app feature at a feature page's own route plays that page's film, or says why not.
    const hrefs = new Map(FEATURE_CATALOGUE.map((p) => [p.app.href, p.key]));
    const missing = HELP_FEATURES
      .filter((e) => e.group !== "Start here" && !isCrmRoute(e.route) && hrefs.has(e.route) && !INTRO_FALLBACKS[e.key] && !NO_INTRO_FALLBACK[e.key])
      .map((e) => `${e.key} (at ${e.route}, the ${hrefs.get(e.route)} page's route): add it to INTRO_FALLBACKS or NO_INTRO_FALLBACK in shared/help/registry.ts`);
    expect(missing).toEqual([]);
    // The map is never a neighbour's film: a key maps to a page whose route is the entry's own, or an owner-reviewed pairing listed here.
    const reviewedElsewhere: Record<string, string> = {
      "google-business": "gbp", "profile-guard": "profileGuard", photos: "gbpContent", "media-library": "media",
      "database-directory": "permits", "search-history": "permits", "permit-alerts": "permits", "social-youtube": "social",
      "crm-lead-new": "crmLeads", "crm-schedule-views": "crmSchedule", "crm-sms-setup": "texting",
      "crm-jobcam-share-link": "jobcam", "crm-jobcam-share": "jobcam", "crm-jobcam-tags": "jobcam", "crm-jobcam-upload": "jobcam",
      "crm-jobcam-timeline": "jobcam", "crm-jobcam-project": "jobcam",
    };
    const pageHref = new Map(FEATURE_CATALOGUE.map((p) => [p.key, p.app.href]));
    for (const [key, page] of Object.entries(INTRO_FALLBACKS)) {
      const e = byKey.get(key)!;
      expect(pageHref.get(page) === e.route || reviewedElsewhere[key] === page, `INTRO_FALLBACKS: ${key} (${e.route}) → ${page} (${pageHref.get(page)}) is not a reviewed pairing`).toBe(true);
    }
  });

  it("a page route resolves to its own entry (helpKeyForRoute), never to an unlisted one", () => {
    expect(helpKeyForRoute("/cloudflare")).toBe("cloudflare");
    expect(helpKeyForRoute("/cloudflare?tab=sites#x")).toBe("cloudflare");
    // A section on a deeper route than its feature is that page's entry; one on the feature's route is not.
    const byKey = new Map(HELP_ENTRIES.map((e) => [e.key, e]));
    for (const s of HELP_ENTRIES.filter((e) => e.parent && !e.unlisted)) {
      expect(helpKeyForRoute(s.route), s.key).toBe(s.route === byKey.get(s.parent!)!.route ? s.parent : s.key);
    }
    // Several features share a page: the one named after the route wins, deterministically — not file order.
    expect(helpKeyForRoute("/crm/settings")).toBe("crm-settings");
    expect(helpKeyForRoute("/crm/pipeline")).toBe("crm-pipeline");
    expect(helpKeyForRoute("/crm/integrations")).toBe("crm-integrations");
    expect(helpKeyForRoute("/crm/clients")).toBe("crm-clients");
    expect(helpKeyForRoute("/crm/jobcam")).toBe("jobcam");
    expect(helpKeyForRoute("/crm")).toBe("crm-home");
    expect(helpKeyForRoute("/locations")).toBe("locations");
    // The same answer whatever order the entries are listed in.
    const reversed = HELP_ENTRIES.slice().reverse();
    const pick = (route: string) => { const r = route.replace(/[?#].*$/, ""); const c = reversed.filter((e) => !e.unlisted && (e.route === r || r.startsWith(e.route + "/"))); return c; };
    for (const route of ["/crm/settings", "/crm/pipeline", "/crm/clients", "/crm/estimates", "/crm/payments", "/crm/team", "/crm/inbox"]) {
      expect(pick(route).some((e) => e.key === helpKeyForRoute(route)), route).toBe(true);
    }
    expect(helpKeyForRoute("/crm/clients/12")).toBe("crm-clients");
    expect(helpKeyForRoute("/no-such-page")).toBeUndefined();
    // "/" is never a prefix match: the home film is not every page's entry.
    expect(helpKeyForRoute("/settings")).not.toBe("brand-what-is-constructhub");
    for (const e of HELP_ENTRIES) if (e.unlisted) expect(helpKeyForRoute(e.route)).not.toBe(e.key);
  });

  it("help entries that live one per file are collected, named after their key and filed under their group", () => {
    const dir = path.join(ROOT, "shared/help/entries");
    for (const [file, content] of indexes()) expect(fs.readFileSync(file, "utf8"), `${path.relative(ROOT, file)} is stale — npx tsx scripts/tutorials/gen-index.ts`).toBe(content);
    const groupDir = (g: string) => g.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const d of dirs) {
      expect(GROUPS.map(groupDir), `entries/${d} is not a help group`).toContain(d);
      for (const f of fs.readdirSync(path.join(dir, d))) {
        expect(f, `entries/${d}/${f}`).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)?\.ts$/);
        const e = helpEntry(f.slice(0, -3));
        expect(e, `entries/${d}/${f} is not collected (its key must be its file name)`).toBeTruthy();
        expect(groupDir(e!.group), `${e!.key} is filed under the wrong group`).toBe(d);
        // A CRM entry added this way is one walkthrough's worth: its key says so.
        if (d === "crm") expect(e!.key, f).toMatch(/^crm-[a-z0-9-]+$/);
        // The overview films are brand pieces, not one feature's walkthrough: their keys say so.
        if (d === "start-here") expect(e!.key, f).toMatch(/^brand-[a-z0-9-]+$/);
      }
    }
    expect(helpEntry("crm-create-estimate")?.route).toBe("/crm/estimates/new");
    expect(read(".gitattributes")).toContain("shared/help/videos/index.ts merge=union");
    expect(read(".gitattributes")).toContain("shared/help/entries/index.ts merge=union");
  });

  it("types no plan name: plan requirements come from the plan model", () => {
    const entryFiles = [...walk(path.join(ROOT, "shared/help/entries"))].filter((f) => !f.endsWith("index.ts"));
    const src = [read("shared/help/registry.ts"), ...entryFiles.map((f) => fs.readFileSync(f, "utf8"))].join("\n");
    const names = PLAN_KEYS.map((k) => PLANS[k].name).join("|");
    expect(src).not.toMatch(new RegExp(`\\b(${names}) plans?\\b`));
    expect(src).not.toMatch(/\$\d/);
    // …and they resolve to real text: the module's plan is named from the plan model
    // (cloudflareSearchConsole starts at Pro on the 2026-10-09 ladder).
    const cf = helpEntry("cloudflare")!;
    expect(cf.needs!.join(" ")).toContain(`${PLANS[planForModule("cloudflareSearchConsole")].name} plan`);
    expect(helpEntry("search-console")!.needs!.join(" ")).toContain("Cloudflare + Search Console");
  });

  it("the Cloudflare and Search Console text matches what the code enforces", () => {
    const routes = read("server/cloudflare/routes.ts"), client = read("server/cloudflare/client.ts");
    const service = read("server/cloudflare/service.ts"), worker = read("server/cloudflare/worker.ts");
    const gsc = read("server/gsc/service.ts"), gscRoutes = read("server/gsc/routes.ts"), gscClient = read("server/gsc/client.ts");
    const text = (k: string) => { const e = helpEntry(k)!; return [e.whatItIs, e.whatItDoes, e.howItWorks, ...e.howToUse, ...(e.needs ?? [])].join(" "); };
    // The limited key's three permissions.
    for (const scope of ["Zone Read", "Analytics Read", "Zone WAF Edit"]) {
      expect(client).toContain(`"${scope}"`);
      expect(text("cloudflare.connections")).toContain(scope);
    }
    expect(client.match(/export const ZONE_PERMISSIONS = \[([\s\S]*?)\]/)![1].match(/"/g)!.length).toBe(6);
    expect(service).toContain("name = `ConstructHUB (${new Date().toISOString().slice(0, 10)})`");
    // Previews last an hour; nothing reaches Cloudflare before confirm.
    expect(routes).toContain("> 3600000");
    expect(text("cloudflare.protection")).toContain("one hour");
    // The rule packs' numbers.
    expect(service).toMatch(/requests_per_period: 10,/);
    expect(service).toMatch(/requests_per_period: 120,/);
    expect(text("cloudflare.protection")).toContain("10 requests in 10 seconds");
    expect(text("cloudflare.protection")).toContain("120 requests in 10 seconds");
    // The worker: retries, the uncertain state, the hourly budget.
    expect(worker).toContain("job.attempts < 5");
    expect(worker).toContain("interval '15 minutes'");
    expect(read("server/cloudflare/common.ts")).toContain("500, amount, 3600000");
    expect(text("cloudflare.work-queue")).toContain("up to five times");
    expect(text("cloudflare.work-queue")).toContain("500 of each kind of action per hour");
    // Search Console: the one scope, 16 months, 28-day windows, the inspection quotas.
    expect(gscClient).toContain('GSC_SCOPE = "https://www.googleapis.com/auth/webmasters"');
    expect(gscRoutes).toContain("scope: `openid email ${GSC_SCOPE}`");
    expect(routes).toContain("getUTCMonth() - 16");
    expect(text("search-console.sync-range")).toContain("16 months");
    expect(gsc).toContain("getUTCDate() + 28");
    expect(text("search-console.sync-range")).toContain("28-day");
    expect(gsc).toMatch(/gsc:inspection:\$\{a\.external_id\}`, 1900, 1, 86400000/);
    expect(gsc).toMatch(/gsc:inspection:minute:\$\{a\.external_id\}`, 500, 1, 60000/);
    expect(text("search-console.sitemaps-indexing")).toContain("1,900 a day and 500 a minute");
  });

  it("search finds features by name and by their text", () => {
    const hit = (q: string) => HELP_FEATURES.filter((f) => helpMatches(f, q)).map((f) => f.key);
    expect(hit("cloudflare")).toContain("cloudflare");
    expect(hit("Global API Key")).toEqual(["cloudflare"]); // matched through its Connections section
    expect(hit("sitemaps")).toContain("search-console");
    expect(hit("zzzz-nothing")).toEqual([]);
    expect(hit("").length).toBe(HELP_FEATURES.length);
  });
});

describe("tutorial step scripts", () => {
  const dir = path.join(ROOT, "docs/tutorials/scripts");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("every checked-in script parses and belongs to a help entry", () => {
    expect(files).toContain("cloudflare.connections.json");
    expect(files).toContain("database-directory.json");
    for (const f of files) {
      const { $schema: _schema, ...json } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const script = parseTutorialScript(json);
      expect(f).toBe(`${script.helpKey}.json`);
      expect(knownVideoKey(script.helpKey), `${script.helpKey} is neither a help entry nor a feature page's intro film`).toBe(true);
      expect(VOICE_PERSONA_IDS).toContain(script.narrator);
      // A script never carries a real credential, and the rule is about the VALUE being typed — not about what the
      // field's selector happens to be called (a key's NAME, a client's example.com address and a search are fine):
      //   · a {{PLACEHOLDER}} (filled from the environment at record time) is always blurred;
      //   · anything else must be demo text: no email outside example.com, no phone outside 555-01xx,
      //     nothing shaped like a key or a token; and a password field only ever takes a placeholder.
      for (const s of script.steps.filter((x) => x.action === "type")) {
        const sel = s.selector ?? "", value = s.value ?? "", where = `${f}: "${value.slice(0, 24)}" typed into ${sel}`;
        if (/\{\{(?!DATE)[A-Z0-9_]+\}\}/.test(value)) { expect(s.redact, `${where} — a placeholder is blurred`).toBe(true); continue; }
        expect(/password/i.test(sel) || /type=["']?password/i.test(sel), `${where} — a password is a {{PLACEHOLDER}}`).toBe(false);
        for (const email of value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) expect(email, where).toMatch(/@([a-z0-9-]+\.)*example\.com$/i);
        for (const phone of value.match(/\(?\b\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g) ?? []) expect(phone.replace(/\D/g, ""), where).toMatch(/^\d{3}55501\d\d$/);
        expect(/\b(sk|pk|rk|whsec|ghp|gho|xox[abp])[_-][A-Za-z0-9_-]{8,}|\bAKIA[A-Z0-9]{12,}|\beyJ[A-Za-z0-9_-]{10,}\.|\bBearer\s+\S{12,}/.test(value), `${where} — looks like a key or a token`).toBe(false);
        expect(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/.test(value), `${where} — a long random-looking string`).toBe(false);
      }
    }
  });

  it("a walkthrough made on the production line follows the house style", () => {
    // Every script but the two written before the line existed.
    for (const f of files.filter((x) => !["database-directory.json", "cloudflare.connections.json"].includes(x))) {
      const { $schema: _schema, ...json } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const script = parseTutorialScript(json);
      // 1024×576 at 1.875 = a 1920×1080 master with the page a quarter larger than on a 1280 screen.
      expect([script.viewport.width, script.viewport.height, script.zoom], f).toEqual([1024, 576, 1.875]);
      expect(script.youtube, `${f} youtube block`).toBeTruthy();
      expect(script.thumbnail, `${f} thumbnail block`).toBeTruthy();
      expect(script.steps.filter((s, i) => i === 0 || s.chapter).length, `${f} chapters`).toBeGreaterThanOrEqual(3);
      const said = [script.title, script.youtube!.title, script.youtube!.description, ...script.youtube!.tags, ...script.steps.map((s) => s.narration)].join(" ");
      // Nothing about how the video was made, and no price: prices live in the plan model, not in a recording.
      expect(said, f).not.toMatch(/higgsfield|kokoro|playwright|ffmpeg|\bAI voice\b/i);
      // A tutorial never says or shows a price. An overview film (a `brand-` script) may — the owner asked for
      // named, dated price comparisons — but only with its sources in the script (they go into the description),
      // and a spoken amount belongs to a card that shows it with its dated footnote.
      // An amount of money: "$189", "189 dollars", "ninety-four dollars". (Not the word alone — "type the amount in dollars" names a unit.)
      const AMOUNT = /\$\s?\d|\b(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[\s-]+(?:and\s+)?(?:one|two|three|four|five|six|seven|eight|nine))?\s+dollars?\b/i;
      const priced = (t: string) => AMOUNT.test(t);
      const cardText = (s: (typeof script.steps)[number]) => s.card ? JSON.stringify(s.card) : "";
      if (!script.helpKey.startsWith("brand-")) expect(priced(script.steps.map((s) => s.narration + cardText(s)).join(" ")), `${f} narrates a price`).toBe(false);
      else if (script.steps.some((s) => priced(s.narration) || priced(cardText(s)))) {
        expect(script.youtube!.sources?.length ?? 0, `${f}: a film that names a price lists where it was read (youtube.sources)`).toBeGreaterThan(0);
        expect(script.steps.some((s) => s.action === "card" && /constructhub\.us\/pricing/.test(s.card?.footnote ?? "")), `${f}: our own price is sourced on a card too`).toBe(true);
        for (const s of script.steps.filter((x) => priced(x.narration))) {
          expect(s.action, `${f}: "${s.narration.slice(0, 40)}…" says an amount — it belongs on a card`).toBe("card");
          expect(s.card?.footnote ?? "", `${f}: the card under a spoken amount carries the dated footnote`).toMatch(/\b20\d\d\b/);
        }
      }
      // A film that names another company says whose trademark the name is, and never judges them.
      if (script.youtube?.names?.length) {
        const all = script.steps.map((s) => s.narration + " " + cardText(s)).join(" ");
        expect(all, `${f}: a comparison states facts, not opinions of the other company`).not.toMatch(/rip-?off|scam|overpriced|greedy|they hide|nobody uses|terrible|worse|junk|\bcheapest\b|#1|\bbest\b/i);
        expect(all, `${f}: a comparison says the plans differ`).toMatch(/different features|features differ|not the same features|tools we (do not|don.t) have/i);
      }
      // Demo identities only: typed emails are example.com, typed phones are 555-01xx.
      for (const s of script.steps.filter((x) => x.action === "type" && x.value)) {
        for (const email of s.value!.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email, f).toMatch(/@(?:[\w-]+\.)*example\.com$/);
        for (const phone of s.value!.match(/\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}/g) ?? []) expect(phone, f).toMatch(/555[ -.]?01\d\d$/);
      }
    }
  });

  it("the JSON Schema twin lists the same actions and narrators", () => {
    const schema = JSON.parse(read("shared/help/step-script.schema.json"));
    expect(schema.properties.steps.items.properties.action.enum).toEqual([...STEP_ACTIONS]);
    expect(schema.properties.narrator.enum).toEqual([...VOICE_PERSONA_IDS]);
  });

  it("the pipeline doc names the Janice voice exactly as the code has it", () => {
    const doc = read("docs/tutorials/VIDEO-PIPELINE.md");
    expect(VOICE_PERSONAS.janice.voice).toBe("af_heart");
    expect(doc).toContain(VOICE_PERSONAS.janice.voice);
    expect(doc).toContain("Kokoro-82M");
    expect(read("voice/speech.py")).toContain('KOKORO_REPO = "hexgrad/Kokoro-82M"');
    for (const key of ["VOICE_ENGINE_URL", "VOICE_INTERNAL_SECRET", "VOICE_TTS_DEVICE", "/tts/preview"]) expect(doc, key).toContain(key);
  });

  it("narration fits what the voice engine and the captions can take", () => {
    for (const f of files) {
      const { $schema: _schema, ...json } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const s of parseTutorialScript(json).steps) {
        // No markup or stage directions: the line is spoken and shown as a caption exactly as written.
        expect(s.narration, f).not.toMatch(/[<>{}\[\]]|\s{2,}/);
        expect(s.narration.trim(), f).toBe(s.narration);
      }
    }
  });
});
