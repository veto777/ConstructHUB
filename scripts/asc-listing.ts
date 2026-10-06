/**
 * The App Store listing for both iPhone apps, kept in git (Remindr lesson 5: nothing that matters lives only in a
 * website form). `apply` writes it through the App Store Connect API; run it again after any edit — every step is
 * idempotent. The demo password is read from ~/.constructhub-keys/review-demo.json, never stored here.
 *
 *   npx tsx scripts/asc-listing.ts check    lengths and banned words only (no network)
 *   npx tsx scripts/asc-listing.ts apply    listing text, categories, age rating, price (free), availability,
 *                                           review contact + demo account + notes, TestFlight internal group
 *   npx tsx scripts/asc-listing.ts screenshots [app|crm]   replace each (or one) app's 6.7" iPhone set with docs/app/screenshots/<app|crm>/*.jpg
 *                                                (1290×2796 RGB, captured from the live apps' screens as the review account)
 *
 * Rules (docs/app/APP-STORE-PLAN.md): the apps sell nothing, so no price, plan, trial, upgrade or "buy" anywhere
 * in the listing; describe only what the apps really do; one demo account, described the same everywhere.
 * App Privacy ("nutrition labels") has no API — see docs/app/APP-PRIVACY.md for the answers to enter.
 */
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { asc } from "./asc";

const COPYRIGHT = "2026 Construct Hub LLC";
const CONTACT = { contactFirstName: "Veto", contactLastName: "Creed", contactPhone: "+18138152031", contactEmail: "support@constructhub.us" };
const DEMO_EMAIL = "support+appreview@constructhub.us";

const SHARED_REVIEW = `DEMO ACCOUNT (the same account works in both ConstructHUB apps)
Email: ${DEMO_EMAIL} — password in the Sign-In Information fields. Sign in on the first screen with email and password.
It has full access and a sample CRM workspace, "Sample Roofing Co. (demo)" (sample clients, jobs and estimates marked "Demo data").

NO PURCHASES (guideline 3.1.3(f))
The app is a free companion to the customer's existing ConstructHUB account. It sells nothing: no in-app purchases, no prices, plans, upgrade prompts or links to buy anywhere in the app. A tool that isn't on an account only says so. (Clients paying their contractor's invoice for construction work are physical services, 3.1.3(e).)

SIGN-IN AND ACCOUNT DELETION
Sign in with Apple, Google (in the system sign-in sheet, ASWebAuthenticationSession) or email and password. Account deletion is in the app (5.1.1(v)) and takes effect immediately: billing is cancelled, every session ends, a Sign in with Apple grant is revoked, and data is erased within 30 days.

ANSWERS TO THE STANDARD INFORMATION QUESTIONS (2.1)
1. Screen recording: available on request. The demo account above opens every screen, including sign-in, the notification permission prompt (Settings → Notifications → Turn on) and account deletion.
2. Devices tested: iPhone (see the recording); builds made with Xcode 26 and the iOS 26 SDK.
3. Purpose and audience: business tools for construction contractors in the United States (roofers, remodelers, builders) and their office staff.
4. Setup: none — sign in with the demo account.
5. Outside services: Google (sign-in; Google Business Profile with the owner's own authorization), Apple (Sign in with Apple, push notifications), SignalWire (phone calls and texts for the AI Call Assistant), Cloudflare (network and storage). Billing happens only on the website and never in the app. AI features run on ConstructHUB's own servers; no personal data is sent to an outside AI company, so no third-party AI consent applies.
6. Regional differences: offered in the United States only; the app is the same for every user.
7. Regulated industry: no — business productivity tools; no health, financial, gambling or other regulated services.`;

type Listing = {
  screenshots: "app" | "crm";
  appId: string; bundleId: string; name: string; subtitle: string; promotionalText: string; description: string;
  keywords: string; supportUrl: string; marketingUrl: string; privacyPolicyUrl: string; reviewNotes: string;
  messagingAndChat: boolean;
};

export const LISTINGS: Listing[] = [
  {
    screenshots: "app", appId: "6819417454", bundleId: "us.constructhub.app", name: "ConstructHUB: Contractor Tools",
    subtitle: "Permits, reviews & local leads",
    promotionalText: "Get alerts when your Google Business Profile changes, answer reviews, find any permit office and check your website — right from the job site.",
    description: `ConstructHUB is the growth toolkit for construction contractors. This app opens your ConstructHUB account on iPhone, so the tools you use on the web go with you to the job site.

WHAT'S IN THE APP
• Google Business Profile: your locations, Profile Guard alerts when your listing is edited, your reviews with AI-drafted replies, and posts and photos.
• Ranking grid: see where your business shows up on the map across your service area.
• Permit office directory: find the permit office and online permit portal for a city or county.
• Property records: find the county appraiser or assessor office for a property.
• Site Scan: check your website for speed, search and on-page problems.
• Social media posting and website traffic protection.
• AI Call Assistant, for businesses that use it on their phone line: every call it answered, with the caller, a summary and the recording, and each real caller filed as a lead.

MADE FOR YOUR PHONE
• Notifications for new calls, leads, reviews and profile changes. Tap one to open the exact page.
• Choose the four tabs at the bottom of the screen.
• Sign in with Apple, Google, or your email and password.
• Share files with the iPhone share sheet and attach photos from your camera or library.

Your ConstructHUB account works the same on the web and in the app. Running jobs and estimates? ConstructHUB CRM is the companion app for clients, estimates, invoices and scheduling.`,
    keywords: "contractor,permit,roofing,google business profile,reviews,leads,call answering,construction,seo",
    supportUrl: "https://constructhub.us/support", marketingUrl: "https://constructhub.us/", privacyPolicyUrl: "https://constructhub.us/privacy",
    messagingAndChat: false,
    reviewNotes: `WHAT THIS APP IS
ConstructHUB: Contractor Tools opens a contractor's ConstructHUB account (constructhub.us): the AI Call Assistant dashboard, Google Business Profile tools (Profile Guard, reviews, posts), the ranking grid, the permit office directory, property records and Site Scan. ConstructHUB CRM, submitted separately by the same team, is a different product (clients, estimates, jobs, invoices) — the two apps share only the sign-in.

WHAT TO TRY
Database Directory (permit offices by city or county), Property Records, Site Scan (enter any website address), Settings → Phone tab bar, Settings → Notifications → "Turn on" (push), Settings → My account → Delete account. Google Business Profile tools show their empty state: they need the business owner's own Google account, which a reviewer can't connect. The AI Call Assistant answers a business's own phone line; the demo account has no phone line connected, so that screen says it isn't on this account.

NATIVE FEATURES (4.2)
Push notifications (tap opens the exact page), Sign in with Apple, Google sign-in in the system sheet, iPhone share sheet for downloaded files, camera and photo attachments, an offline screen with retry, and a customizable bottom tab bar.

${SHARED_REVIEW}`,
  },
  {
    screenshots: "crm", appId: "6819417824", bundleId: "us.constructhub.crm", name: "ConstructHUB CRM",
    subtitle: "Estimates, jobs & invoices",
    promotionalText: "Send estimates your clients sign on their phone, track every job from lead to paid, and keep your crew on the same schedule.",
    description: `ConstructHUB CRM runs the office side of a contracting business from your iPhone: clients, estimates, jobs, invoices, scheduling and your team.

WHAT'S IN THE APP
• Clients: contact details, addresses, notes, documents and history, plus a private client portal for each client.
• Estimates: build line-item estimates from your saved items, send them, and collect your client's e-signature.
• Jobs: a pipeline from lead to paid, with each job's details, trades and status.
• Invoices: send invoices your clients can pay online.
• Schedule: appointments and crew scheduling.
• Team: invite your crew with roles and permissions.
• Messages with your clients in one inbox.

MADE FOR YOUR PHONE
• Notifications when a lead comes in, a client signs an estimate or a client writes to you. Tap one to open it.
• Attach job photos from your camera or photo library.
• Choose the four tabs at the bottom of the screen.
• Sign in with Apple, Google, or your email and password.

Your ConstructHUB account works the same on the web and in the app. ConstructHUB: Contractor Tools is the companion app for calls, reviews and your Google Business Profile.`,
    keywords: "crm,contractor,estimate,invoice,roofing,construction,jobs,schedule,field service,client portal",
    supportUrl: "https://constructhub.us/support", marketingUrl: "https://constructhub.us/", privacyPolicyUrl: "https://portal.constructhub.us/crm-privacy",
    messagingAndChat: true,
    reviewNotes: `WHAT THIS APP IS
ConstructHUB CRM is a contractor's customer relationship manager (portal.constructhub.us): clients, estimates with e-signature, jobs, invoices, schedule, team and client messages. ConstructHUB: Contractor Tools, submitted separately by the same team, is a different product (calls, Google Business Profile, permits) — the two apps share only the sign-in.

WHAT TO TRY
The demo workspace has sample clients (Jordan Rivera, Maria Chen, Harbor View HOA), two jobs and two estimates. Open Clients, Jobs, an estimate (E-1001), Schedule, More → Customize the bar, the "Turn on" notifications card in More, and More → Delete account. Client messages are private business messages between a contractor and their own clients.

NATIVE FEATURES (4.2)
Push notifications (tap opens the exact page), Sign in with Apple, Google sign-in in the system sheet, camera and photo attachments for job photos, iPhone share sheet for downloaded PDFs, an offline screen with retry, and a customizable bottom tab bar.

${SHARED_REVIEW}`,
  },
];

// Words that would contradict "sells nothing" (3.1.3(f)) or promise what we can't.
const BANNED = /\$|\bprice|\bpricing|\bplan\b|\bplans\b|\btrial|\bupgrade|\bsubscri|\bbuy\b|\bpurchase|\bfree\b|\bdiscount|\bguarantee/i;

export function checkListing(l: Listing): string[] {
  const problems: string[] = [];
  const max: [keyof Listing, number][] = [["name", 30], ["subtitle", 30], ["promotionalText", 170], ["description", 4000], ["keywords", 100], ["reviewNotes", 4000]];
  for (const [k, n] of max) if (String(l[k]).length > n) problems.push(`${l.bundleId} ${k}: ${String(l[k]).length} > ${n}`);
  for (const k of ["name", "subtitle", "promotionalText", "description", "keywords"] as const) {
    const m = BANNED.exec(l[k]);
    if (m) problems.push(`${l.bundleId} ${k}: "${m[0]}" (the apps sell nothing — keep money words out of the listing)`);
  }
  return problems;
}

async function one(path: string) { return (await asc("GET", path)).data; }

/** Territories where the app is on sale right now (read back from Apple, not assumed). */
export async function availableTerritories(appId: string): Promise<string[]> {
  const a = await asc("GET", `/v1/apps/${appId}/appAvailabilityV2`);
  const on: string[] = [];
  for (let next: string | null = `/v2/appAvailabilities/${a.data.id}/territoryAvailabilities?limit=200&include=territory`; next;) {
    const r = await asc("GET", next);
    for (const t of r.data) if (t.attributes.available) on.push(t.relationships.territory.data.id);
    next = r.links?.next ? String(r.links.next).replace("https://api.appstoreconnect.apple.com", "") : null;
  }
  return on;
}

async function applyListing(l: Listing) {
  const say = (s: string) => console.log(`${l.bundleId}: ${s}`);
  // App-level: content rights; App Info: categories, name/subtitle/privacy URL, age rating.
  await asc("PATCH", `/v1/apps/${l.appId}`, { data: { type: "apps", id: l.appId, attributes: { contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } } });
  const [info] = await one(`/v1/apps/${l.appId}/appInfos`);
  await asc("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: {
    primaryCategory: { data: { type: "appCategories", id: "BUSINESS" } }, secondaryCategory: { data: { type: "appCategories", id: "PRODUCTIVITY" } } } } });
  const [infoLoc] = await one(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  await asc("PATCH", `/v1/appInfoLocalizations/${infoLoc.id}`, { data: { type: "appInfoLocalizations", id: infoLoc.id,
    attributes: { name: l.name, subtitle: l.subtitle, privacyPolicyUrl: l.privacyPolicyUrl } } });
  const age = await one(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const NONE = "NONE";
  await asc("PATCH", `/v1/ageRatingDeclarations/${age.id}`, { data: { type: "ageRatingDeclarations", id: age.id, attributes: {
    alcoholTobaccoOrDrugUseOrReferences: NONE, contests: NONE, gamblingSimulated: NONE, gunsOrOtherWeapons: NONE,
    medicalOrTreatmentInformation: NONE, profanityOrCrudeHumor: NONE, sexualContentGraphicAndNudity: NONE, sexualContentOrNudity: NONE,
    horrorOrFearThemes: NONE, matureOrSuggestiveThemes: NONE, violenceCartoonOrFantasy: NONE, violenceRealistic: NONE,
    violenceRealisticProlongedGraphicOrSadistic: NONE,
    gambling: false, lootBox: false, unrestrictedWebAccess: false, advertising: false, ageAssurance: false, parentalControls: false,
    healthOrWellnessTopics: false, userGeneratedContent: false, socialMedia: false, messagingAndChat: l.messagingAndChat,
  } } });
  say("app info, categories, age rating");

  // Version 1.0: text, URLs, copyright.
  const [version] = await one(`/v1/apps/${l.appId}/appStoreVersions?filter[platform]=IOS&limit=1`);
  await asc("PATCH", `/v1/appStoreVersions/${version.id}`, { data: { type: "appStoreVersions", id: version.id, attributes: { copyright: COPYRIGHT, releaseType: "AFTER_APPROVAL" } } });
  const [vLoc] = await one(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  await asc("PATCH", `/v1/appStoreVersionLocalizations/${vLoc.id}`, { data: { type: "appStoreVersionLocalizations", id: vLoc.id, attributes: {
    description: l.description, keywords: l.keywords, promotionalText: l.promotionalText, supportUrl: l.supportUrl, marketingUrl: l.marketingUrl } } });
  say("version text");

  // Price: free, set explicitly (Remindr lesson 6: availability and pricing first).
  const points = await asc("GET", `/v1/apps/${l.appId}/appPricePoints?filter[territory]=USA&limit=5`);
  const free = points.data.find((p: any) => Number(p.attributes.customerPrice) === 0);
  await asc("POST", "/v1/appPriceSchedules", { data: { type: "appPriceSchedules", relationships: {
      app: { data: { type: "apps", id: l.appId } }, baseTerritory: { data: { type: "territories", id: "USA" } },
      manualPrices: { data: [{ type: "appPrices", id: "${free}" }] } } },
    included: [{ type: "appPrices", id: "${free}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } } }] });
  say("price: free");

  // Availability: the United States only (a US contractor product; also no EU trader-status requirement). Apple's v2
  // call lists every territory, each marked available or not. Read first, never infer from an error.
  const current = await asc("GET", `/v1/apps/${l.appId}/appAvailabilityV2`).catch((e: any) => { if (e.status === 404) return null; throw e; });
  if (!current) {
    const territories: string[] = [];
    for (let next: string | null = "/v1/territories?limit=200"; next;) {
      const r = await asc("GET", next);
      territories.push(...r.data.map((t: any) => t.id));
      next = r.links?.next ? String(r.links.next).replace("https://api.appstoreconnect.apple.com", "") : null;
    }
    if (!territories.includes("USA")) throw new Error("territory list has no USA");
    await asc("POST", "/v2/appAvailabilities", { data: { type: "appAvailabilities", attributes: { availableInNewTerritories: false }, relationships: {
        app: { data: { type: "apps", id: l.appId } },
        territoryAvailabilities: { data: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}` })) } } },
      included: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}`, attributes: { available: t === "USA" },
        relationships: { territory: { data: { type: "territories", id: t } } } })) });
  }
  const live = await availableTerritories(l.appId);
  if (live.length !== 1 || live[0] !== "USA") throw new Error(`availability is ${live.join(",") || "nowhere"} — expected USA only; fix it before submitting`);
  say("availability: United States only (checked)");

  // Review details: contact, the one demo account, the notes.
  const demo = JSON.parse(readFileSync(join(homedir(), ".constructhub-keys", "review-demo.json"), "utf8"));
  if (demo.email !== DEMO_EMAIL) throw new Error("review-demo.json email differs from DEMO_EMAIL — keep the one demo account consistent");
  const attrs = { ...CONTACT, demoAccountName: demo.email, demoAccountPassword: demo.password, demoAccountRequired: true, notes: l.reviewNotes };
  const existing = await asc("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
  if (existing.data) await asc("PATCH", `/v1/appStoreReviewDetails/${existing.data.id}`, { data: { type: "appStoreReviewDetails", id: existing.data.id, attributes: attrs } });
  else await asc("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: attrs,
    relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
  say("review contact, demo account, notes");

  // TestFlight: an internal group with every build, so the team can install it on a real iPhone.
  const groups = await asc("GET", `/v1/apps/${l.appId}/betaGroups?limit=20`);
  let group = groups.data.find((g: any) => g.attributes.name === "Construct Hub team");
  if (!group) group = (await asc("POST", "/v1/betaGroups", { data: { type: "betaGroups", attributes: { name: "Construct Hub team", isInternalGroup: true, hasAccessToAllBuilds: true },
    relationships: { app: { data: { type: "apps", id: l.appId } } } } })).data;
  say(`TestFlight internal group #${group.id}`);
  return { versionId: version.id, groupId: group.id };
}

/** Replace the version's 6.7" iPhone screenshot set with the files in docs/app/screenshots/<dir>, in name order. */
async function uploadScreenshots(l: Listing) {
  const dir = join(process.cwd(), "docs", "app", "screenshots", l.screenshots);
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  if (!files.length || files.length > 10) throw new Error(`${dir}: need 1–10 screenshots, found ${files.length}`);
  const [version] = await one(`/v1/apps/${l.appId}/appStoreVersions?filter[platform]=IOS&limit=1`);
  const [vLoc] = await one(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  const sets = await one(`/v1/appStoreVersionLocalizations/${vLoc.id}/appScreenshotSets`);
  for (const old of sets.filter((x: any) => x.attributes.screenshotDisplayType === "APP_IPHONE_67")) await asc("DELETE", `/v1/appScreenshotSets/${old.id}`);
  const set = (await asc("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: "APP_IPHONE_67" },
    relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: vLoc.id } } } } })).data;
  for (const f of files) {
    const bytes = readFileSync(join(dir, f));
    const shot = (await asc("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: f, fileSize: bytes.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } })).data;
    for (const op of shot.attributes.uploadOperations) {
      const res = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h: any) => [h.name, h.value])),
        body: bytes.subarray(op.offset, op.offset + op.length) });
      if (!res.ok) throw new Error(`${f}: upload part ${res.status}`);
    }
    await asc("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(bytes).digest("hex") } } });
  }
  // Apple processes each image; wait until every one is COMPLETE (or report the failure).
  for (let i = 0; i < 150; i++) {
    const shots = await one(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
    const states = shots.map((x: any) => x.attributes.assetDeliveryState?.state);
    if (states.some((st: string) => st === "FAILED")) throw new Error(`${l.bundleId}: screenshot processing failed: ${JSON.stringify(shots.map((x: any) => x.attributes.assetDeliveryState))}`);
    if (states.length === files.length && states.every((st: string) => st === "COMPLETE")) { console.log(`${l.bundleId}: ${files.length} screenshots COMPLETE`); return; }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`${l.bundleId}: screenshots still processing after 10 minutes`);
}

async function main() {
  const cmd = process.argv[2];
  const problems = LISTINGS.flatMap(checkListing);
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  if (cmd === "check") { console.log("listing OK:", LISTINGS.map((l) => `${l.name} (${l.description.length}/4000, notes ${l.reviewNotes.length}/4000)`).join("; ")); return; }
  if (cmd === "apply") { for (const l of LISTINGS) await applyListing(l); return; }
  if (cmd === "screenshots") { for (const l of LISTINGS.filter((x) => !process.argv[3] || x.screenshots === process.argv[3])) await uploadScreenshots(l); return; }
  console.log("usage: check | apply | screenshots");
}
if (process.argv[1]?.endsWith("asc-listing.ts")) main().catch((e) => { console.error(e.message); process.exit(1); });
