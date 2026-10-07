import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { HELP_ENTRIES, HELP_FEATURES, HELP_GROUPS, helpEntry, helpMatches, helpSections, helpSummary, isCrmRoute } from "@shared/help/registry";
import { parseTutorialScript, STEP_ACTIONS } from "@shared/help/step-script";
import { TUTORIAL_FILE, VIDEO_MANIFEST, helpVideoFor, tutorialMediaUrl } from "@shared/help/videos";
import { createHash } from "crypto";
import { isKnownPath } from "@shared/app-routes";
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { VOICE_PERSONAS, VOICE_PERSONA_IDS } from "@shared/voice-personas";

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
    for (const s of HELP_ENTRIES.filter((e) => e.parent)) expect(keys.has(s.key), `${s.key} is mounted`).toBe(true);
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
      expect(e.route).toBe(parent!.route);
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
    for (const f of HELP_FEATURES) expect(isCrmRoute(f.route), `${f.key} group`).toBe(f.group === "CRM");
    // The owner's list, by name.
    for (const k of ["call-assistant", "social-media", "site-scan", "seo", "cloudflare", "search-console", "ip-tracker", "vpn-shield", "competitor-intel", "jobcam", "google-reviews"])
      expect(HELP_FEATURES.some((f) => f.key === k), k).toBe(true);
    for (const g of HELP_GROUPS) expect(HELP_FEATURES.some((f) => f.group === g), g).toBe(true);
  });

  it("claims no video that is not in the committed manifest (shared/help/videos.json)", () => {
    // The manifest is what mux.ts measured: one entry per recorded walkthrough, its three files by
    // storage key, size and sha256, and the video's length. The registry builds `video` from it.
    const listed = Object.keys(VIDEO_MANIFEST);
    for (const key of listed) expect(helpEntry(key), `videos.json lists ${key}, which is not a help entry`).toBeTruthy();
    for (const e of HELP_ENTRIES) {
      const m = VIDEO_MANIFEST[e.key];
      if (e.video === null) {
        expect(m, `${e.key} is in videos.json but has no video`).toBeUndefined();
        // With no recording, the text must not point at one.
        const text = [e.title, e.whatItIs, e.whatItDoes, e.howItWorks, ...e.howToUse, ...(e.needs ?? [])].join(" ");
        expect(text, `${e.key} mentions a video it does not have`).not.toMatch(/walkthrough|tutorial video|watch the video/i);
        continue;
      }
      // A real recording: listed in the manifest, in our own storage under tutorials/, never a stand-in.
      expect(m, `${e.key} has a video that videos.json does not list`).toBeTruthy();
      expect(e.video).toEqual(helpVideoFor(e.key));
      expect(e.video.url, `${e.key} video url`).toMatch(/^(https:\/\/[^\s]+|\/)[^\s]*tutorials\/[^\s]+\.(mp4|webm)$/);
      expect(e.video.url).not.toMatch(/example|placeholder|sample|lorem|youtube|vimeo/i);
      expect(Number.isInteger(m.durationSec) && m.durationSec > 0 && m.durationSec < 1800, `${e.key} duration`).toBe(true);
      expect(e.video.durationSec).toBe(m.durationSec);
      expect(e.video.url).toBe(tutorialMediaUrl(m.video.key));
      expect(e.video.poster).toBe(tutorialMediaUrl(m.poster.key));
      expect(e.video.captions).toBe(tutorialMediaUrl(m.captions.key));
      for (const [part, ext, minBytes] of [["video", "mp4", 100_000], ["captions", "vtt", 50], ["poster", "jpg", 2_000]] as const) {
        const f = m[part];
        // tutorials/<helpKey>.<first 8 of its sha256>.<ext>: content-addressed, so a re-record is a new key.
        expect(f.sha256, `${e.key} ${part} sha256`).toMatch(/^[0-9a-f]{64}$/);
        expect(f.key, `${e.key} ${part} key`).toBe(`tutorials/${e.key}.${f.sha256.slice(0, 8)}.${ext}`);
        expect(f.key.slice("tutorials/".length)).toMatch(TUTORIAL_FILE);
        expect(Number.isInteger(f.bytes) && f.bytes >= minBytes, `${e.key} ${part} bytes`).toBe(true);
        // Where the file is at hand (the box that recorded it), it is the file the manifest describes.
        const local = path.join(ROOT, "tmp/tutorials", f.key.slice("tutorials/".length));
        if (fs.existsSync(local)) {
          const data = fs.readFileSync(local);
          expect(data.length, `${f.key} size on disk`).toBe(f.bytes);
          expect(createHash("sha256").update(data).digest("hex"), `${f.key} sha256 on disk`).toBe(f.sha256);
        }
      }
      // A walkthrough has a step script: the video is a recording of it, not a file from somewhere else.
      expect(fs.existsSync(path.join(ROOT, "docs/tutorials/scripts", `${e.key}.json`)), `${e.key} step script`).toBe(true);
    }
    // The UI never shows a play control for a null video: both are gated on `entry.video`.
    const button = read("client/src/components/help-button.tsx");
    expect(button).toMatch(/\{entry\.video && \(\s*<>\s*<button[^>]*aria-label=\{`Watch the walkthrough/);
    expect(button).toContain("Video walkthrough coming soon");
    const page = read("client/src/pages/tutorials.tsx");
    expect(page).toMatch(/if \(!entry\.video\) return null;/);
    expect(page).toContain("Video coming soon");
    // No video file is checked in, and nothing in the client links one.
    expect(fs.existsSync(path.join(ROOT, "client/public/tutorials"))).toBe(false);
  });

  it("types no plan name: plan requirements come from the plan model", () => {
    const src = read("shared/help/registry.ts");
    const names = PLAN_KEYS.map((k) => PLANS[k].name).join("|");
    expect(src).not.toMatch(new RegExp(`\\b(${names}) plans?\\b`));
    expect(src).not.toMatch(/\$\d/);
    // …and they resolve to real text.
    const cf = helpEntry("cloudflare")!;
    expect(cf.needs!.join(" ")).toContain(`${PLANS.agency.name} plan`);
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
      expect(helpEntry(script.helpKey), script.helpKey).toBeTruthy();
      expect(VOICE_PERSONA_IDS).toContain(script.narrator);
      // A script never carries a real credential: typed secrets are {{PLACEHOLDERS}} filled at record time, and blurred.
      for (const s of script.steps.filter((x) => x.action === "type" && /key|token|password|email/i.test(x.selector ?? "")))
        { expect(s.value, f).toMatch(/^\{\{[A-Z_]+\}\}$/); expect(s.redact, f).toBe(true); }
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
