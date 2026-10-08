/**
 * The YouTube description builder: its rules on made-up input, then a LINT over every step script
 * IN THIS CHECKOUT — and nothing else: no sibling worktree, no analysis/ output, so the result is the
 * same on every machine. (The lint over every worktree on this machine, where producers record videos
 * that are not merged yet, is a report: `youtube-schedule.ts --lint-all`.) Reads files only.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AREAS, BANNED, DESCRIPTION_MAX_BYTES, DESCRIPTION_TARGET_MAX, DESCRIPTION_TARGET_MIN, MAX_HASHTAGS, TAGS_BUDGET, TITLE_MAX,
  BRAND_PRODUCTS, areaFor, bannedIn, buildDescription, buildTags, chaptersIn, fitTitle, lintDescription, plain, relatedFor, similarity, tagsCost, utf8Bytes, validChapters,
  type DescriptionInput,
} from "./description";
import { describeVideo, planTitles, scriptKeys, siblingWorktrees, type DescribeContext, type Described } from "./description-sources";
import { readLedger, readOrder } from "./schedule";
import { helpEntry } from "../../shared/help/registry";

const ROOT = path.resolve(import.meta.dirname, "../..");

const entry = {
  title: "Schedule", group: "CRM", whatItIs: "Every visit, install date and appointment on one calendar.",
  whatItDoes: "Month, week and agenda views for your own calendar, everyone’s, or one team member’s, with a warning when visits overlap.",
  howToUse: ["CRM → Schedule.", "Add a visit, choose who is going and link it to the client or project."],
  howItWorks: "Nothing lands on the schedule by itself — you add each visit.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
const step = (i: number, chapter?: string) => ({ caption: `Caption ${i}`, narration: `This is what the narrator says over step number ${i}, in a plain sentence of ordinary length.`, chapter });
const input = (o: Partial<DescriptionInput> = {}): DescriptionInput => ({
  helpKey: "crm-schedule", title: "How to schedule and edit an appointment | ConstructHUB CRM",
  summary: "A short walkthrough of the Schedule in the ConstructHUB CRM. You will add an appointment and change its time.",
  entry, steps: Array.from({ length: 16 }, (_, i) => step(i + 1, i % 5 === 0 ? `Part ${i / 5 + 1}` : undefined)),
  chapters: [{ at: "0:00", title: "Part 1" }, { at: "0:14", title: "Part 2" }, { at: "0:33", title: "Part 3" }, { at: "0:51", title: "Part 4" }],
  durationSec: 70, tags: ["contractor scheduling", "crew schedule", "ConstructHUB CRM"], playlist: "ConstructHUB CRM tutorials", track: "schedule",
  related: [{ helpKey: "crm-schedule-views", title: "How to switch month, week and agenda views" }, { helpKey: "crm-clients", title: "How to find a client and read their page", url: "https://www.youtube.com/watch?v=WekJrfc9uKA" }],
  ...o,
});
const hashtagsOf = (text: string) => text.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? [];
const timesOf = (text: string) => text.match(/\b\d{1,2}:\d{2}\b/g) ?? [];

/** The rules every description must keep, whatever it was built from (the library's own list: the CLI's --lint-all uses the same). */
function lint(d: { helpKey: string; title: string; description: string; tags: string[]; length: number; bytes: number }) {
  expect(lintDescription(d), d.helpKey).toEqual([]);
}

describe("the description builder", () => {
  it("fills the description to the target without going over, and is the same every time", () => {
    const d = buildDescription(input());
    lint(d);
    expect(d.length).toBeGreaterThanOrEqual(DESCRIPTION_TARGET_MIN);
    expect(d.underTarget).toBe(false);
    expect(buildDescription(input()).description).toBe(d.description);
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d).toMatchObject({ area: "schedule", chapters: true, title: "How to schedule and edit an appointment | ConstructHUB CRM" });
  });

  it("opens with the search phrase and the benefit, then the sections in order", () => {
    const d = buildDescription(input()).description;
    expect(d.startsWith("How to schedule and edit an appointment in ConstructHUB CRM - ")).toBe(true);
    expect(d.split("\n")[0].length).toBeLessThanOrEqual(220);
    const order = ["IN THIS VIDEO", "CHAPTERS", "STEP BY STEP", "WHAT YOU NEED", "GOOD TO KNOW", "WHY CONTRACTORS USE THIS", "RELATED CONSTRUCTHUB CRM TUTORIALS", "ABOUT CONSTRUCTHUB", "Search terms: ", "#contractors "].map((l) => d.indexOf(`\n${l}`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d).toMatch(/\n1\. (Caption 1 - )?This is what the narrator says over step number 1,/);
    expect(d).toContain("• A ConstructHub CRM plan - the CRM is a separate product with its own plans.");
    expect(d).toContain("• How to find a client and read their page - https://www.youtube.com/watch?v=WekJrfc9uKA");
    expect(d).toContain("• How to switch month, week and agenda views\n"); // no link until it is public
    expect(d).toContain("Playlist: ConstructHUB CRM tutorials");
    expect(d).toContain("https://constructhub.us/tutorials#help-crm-schedule");
    expect(d.trimEnd().split("\n").pop()).toBe("#contractors #scheduling #constructionCRM #ConstructHUB");
    expect(d).toMatch(/sample data/); // the demo workspace is never passed off as a customer
  });

  it("writes Steps without times when the chapter list is not one YouTube accepts", () => {
    for (const chapters of [null, [{ at: "0:00", title: "A" }, { at: "0:20", title: "B" }], [{ at: "0:02", title: "A" }, { at: "0:20", title: "B" }, { at: "0:40", title: "C" }], [{ at: "0:00", title: "A" }, { at: "0:05", title: "B" }, { at: "0:40", title: "C" }]]) {
      const d = buildDescription(input({ chapters }));
      lint(d);
      expect(d.chapters).toBe(false);
      expect(d.description).toContain("\nSTEPS\n1. Part 1\n2. Part 2");
      expect(chaptersIn(d.description)).toEqual([]);
    }
    expect(validChapters([{ at: "0:00", title: "A" }, { at: "0:20", title: "B" }, { at: "0:65", title: "C" }])).toBe(false);
    expect(validChapters([{ at: "0:00", title: "A" }, { at: "0:20", title: "B" }, { at: "0:40", title: "C" }], 45)).toBe(false); // the last one is 5 s long
    expect(validChapters([{ at: "0:00", title: "A" }, { at: "0:20", title: "B" }, { at: "1:00:40", title: "C" }])).toBe(true);
  });

  it("cuts from the bottom up when the source is too long — the walkthrough last — and says so", () => {
    const long = input({ steps: Array.from({ length: 80 }, (_, i) => step(i + 1, i % 20 === 0 ? `Part ${i / 20 + 1}` : undefined)) });
    const d = buildDescription(long);
    lint(d);
    expect(d.length).toBeGreaterThanOrEqual(DESCRIPTION_TARGET_MIN);
    expect(d.description).toContain("The video shows the remaining steps.");
    expect(d.notes.join(" ")).toMatch(/stops after step \d+ of 80/);
    expect(d.description).toContain("https://constructhub.us/tutorials"); // the links and the hashtags survive
  });

  it("says so, instead of padding, when there is not enough to say", () => {
    const d = buildDescription(input({ entry: null, summary: null, steps: [step(1), step(2)], chapters: null, related: [], tags: null }));
    lint(d);
    expect(d.underTarget).toBe(true);
    expect(d.length).toBeLessThan(DESCRIPTION_TARGET_MIN);
    expect(d.notes.join(" ")).toMatch(/do not hold enough/);
    // nothing is said twice to make up the length
    const lines = d.description.split("\n").filter((l) => l.length > 30);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("never repeats a sentence, and leaves out the area's facts the help entry already states", () => {
    const d = buildDescription(input()).description;
    const all = d.split("\n").flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter((x) => x.length > 40);
    expect(new Set(all).size).toBe(all.length);
    expect(d).not.toContain(AREAS.schedule.why[6]); // "Nothing lands on the schedule by itself…" is the entry's own sentence
  });

  it("drops a source sentence that breaks a rule, strips angle brackets and breaks stray times", () => {
    const d = buildDescription(input({
      summary: "The best scheduling there is. You will add an appointment.",
      steps: [{ caption: "Start <now>", narration: "Set it to 10:30 in the morning. This is included with every plan. It is guaranteed to work.", chapter: "Part 1" }, ...Array.from({ length: 12 }, (_, i) => step(i + 2))],
      chapters: null,
    }));
    lint(d);
    expect(d.description).toContain("You will add an appointment.");
    expect(d.description).toContain("Set it to 10.30 in the morning.");
    expect(d.description).not.toMatch(/every plan|guaranteed|scheduling there is/);
    expect(d.notes.join(" | ")).toMatch(/"best"/);
    expect(plain("a <b> “c” — d’s … 1:05")).toBe("a b \"c\" - d's ... 1.05");
    expect(BANNED.map((b) => b.name)).toEqual(expect.arrayContaining(["included with", "best", "#1", "guarantee", "portal.constructhub"]));
    expect(bannedIn("Offer good / better / best options")).toEqual([]); // the name of a kind of estimate, not a claim
    expect(bannedIn("the best CRM, #1 for roofers, data from DataForSEO at portal.constructhub.us")).toEqual(["best", "#1", "a data vendor's name", "portal.constructhub"]);
  });

  it("keeps a producer's title, and shortens only one that is over 70 characters", () => {
    expect(fitTitle("How to add a client | ConstructHUB CRM")).toBe("How to add a client | ConstructHUB CRM");
    expect(fitTitle("How to Find Any Building Permit Office & Permit Portal (All 50 States) | ConstructHUB")).toBe("How to Find Any Building Permit Office & Permit Portal | ConstructHUB");
    const cut = fitTitle("How to do a very long thing with a great many words in it that never seems to end | ConstructHUB CRM");
    expect(cut.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(cut.endsWith(" | ConstructHUB CRM")).toBe(true);
    expect(cut.startsWith("How to do a very long thing")).toBe(true);
  });

  it("builds the tags from the producer's, then the area's, most specific first, under the budget", () => {
    const tags = buildTags({ helpKey: "crm-schedule", tags: ["Crew Schedule", "contractor scheduling", "crew schedule", "a, b"] }, "schedule");
    expect(tags.slice(0, 3)).toEqual(["Crew Schedule", "contractor scheduling", "a b"]);
    expect(tags).toContain("contractor scheduling software");
    expect(tagsCost(tags)).toBeLessThanOrEqual(TAGS_BUDGET);
    expect(tagsCost(tags)).toBeGreaterThan(TAGS_BUDGET - 45);
    expect(tagsCost(["one", "two words"])).toBe(3 + 1 + 9 + 2);
  });

  it("knows which area a video belongs to: the platform's pages are not CRM videos", () => {
    expect(areaFor({ helpKey: "database-directory", track: "getting-started", group: "Permits & Databases" })).toBe("permits");
    expect(areaFor({ helpKey: "crm-home", track: "getting-started", group: "CRM" })).toBe("getting-started");
    expect(areaFor({ helpKey: "crm-create-estimate", track: "estimates" })).toBe("estimates");
    expect(areaFor({ helpKey: "crm-estimate-something-new", track: null })).toBe("estimates");
    expect(areaFor({ helpKey: "jobcam", track: "jobcam", group: "CRM" })).toBe("jobcam");
    expect(areaFor({ helpKey: "crm-whatever", track: null })).toBe("crm");
    expect(areaFor({ helpKey: "cloudflare.connections", group: "Tools" })).toBe("platform");
    for (const t of readOrder(path.join(ROOT, "docs", "tutorials", "youtube-order.json"))) expect(AREAS[t.name], t.name).toBeDefined();
  });

  it("lists the nearest videos of the same track first, then the tracks beside it", () => {
    const tracks = [{ name: "a", keys: ["a1", "a2"] }, { name: "b", keys: ["b1", "b2", "b3", "b4"] }, { name: "c", keys: ["c1"] }];
    const r = relatedFor("b2", tracks, (k) => (k === "b4" ? null : `How to ${k} | ConstructHUB CRM`), (k) => (k === "b1" ? "https://www.youtube.com/watch?v=x" : null));
    expect(r.map((x) => x.helpKey)).toEqual(["b3", "b1", "c1", "a1", "a2"]);
    expect(r[1]).toEqual({ helpKey: "b1", title: "How to b1", url: "https://www.youtube.com/watch?v=x" });
  });

  it("keeps the bank of area copy clean: no banned word, no statistic, no keyword twice in an area", () => {
    for (const [name, a] of Object.entries(AREAS)) {
      const text = [...a.taglines, ...a.why, ...a.keywords, ...a.hashtags].join(" \n ");
      expect(bannedIn(text), name).toEqual([]);
      expect(/[<>]/.test(text), name).toBe(false);
      expect(text, name).not.toMatch(/\d+\s?%|\b\d{3,}\b|\$\s?\d/); // no percentages, counts or prices
      expect(new Set(a.keywords.map((k) => k.toLowerCase())).size, name).toBe(a.keywords.length);
      expect(a.keywords.length, name).toBeGreaterThanOrEqual(12);
      expect(a.taglines.every((t) => !t.endsWith(".")), name).toBe(true);
    }
  });
});

/* ── The overview films ───────────────────────────────────────────────────── */

describe("the brand description (\"Start here\" films)", () => {
  const brandEntry = {
    title: "What is ConstructHUB?", group: "Start here",
    whatItIs: "ConstructHUB is two products for contractors: Business tools for finding work and looking after your Google listing, and a CRM for running the jobs you win.",
    whatItDoes: "Business tools hold the permit office directory. The CRM holds clients, estimates and invoices.",
    howToUse: ["Open constructhub.us and create an account.", "Choose Business tools, the CRM, or both."],
    howItWorks: "Permit office links are checked.", needs: ["A ConstructHUB account."],
  };
  const film = (o: Partial<DescriptionInput> = {}): DescriptionInput => ({
    helpKey: "brand-what-is-constructhub", title: "What is ConstructHUB? Business tools and a CRM for contractors", summary: null, entry: brandEntry,
    steps: [{ caption: "The problem", narration: "Leads in one app. Estimates in another.", chapter: "The problem" }, { caption: "Two products", narration: "ConstructHUB is two products." },
      { caption: "Directory", narration: "Business tools start with a directory of permit offices.", chapter: "Business tools" }, { caption: "CRM", narration: "The second product is the CRM.", chapter: "The CRM" }],
    chapters: [{ at: "0:00", title: "The problem" }, { at: "0:12", title: "Business tools" }, { at: "0:34", title: "The CRM" }], durationSec: 72,
    tags: ["what is constructhub", "contractor software"], track: null, related: [{ helpKey: "crm-clients", title: "How to find a client" }], ...o,
  });

  it("is a channel trailer, not a tutorial: what it is, the two products, links, chapters, what the film says, how to start", () => {
    const d = buildDescription(film());
    lint(d);
    expect(d).toMatchObject({ variant: "brand", area: "brand", chapters: true, underTarget: false });
    expect(d.description.split("\n")[0]).toBe(brandEntry.whatItIs);
    for (const line of BRAND_PRODUCTS) expect(d.description).toContain(line);
    const order = ["THE TWO PRODUCTS", "LINKS", "CHAPTERS", "WHAT THE FILM SAYS", "HOW TO START", "GOOD TO KNOW"].map((h) => d.description.indexOf(`\n${h}\n`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d.description).toContain("Plans for each product: https://constructhub.us/pricing");
    expect(d.description).toContain("Permit office directory: https://constructhub.us/databases");
    expect(d.description).toContain("https://constructhub.us/tutorials#help-brand-what-is-constructhub");
    expect(d.description).toContain("▶ The problem\nLeads in one app. Estimates in another. ConstructHUB is two products.");
    expect(d.description).toContain("1. Open constructhub.us and create an account.");
    expect(d.description).toContain("sample data");
    // None of the tutorial template: no "how to" hook, no keyword bank, no related list, no price, no length padding.
    expect(d.description).not.toMatch(/STEP BY STEP|Search terms:|WHY CONTRACTORS|RELATED|IN THIS VIDEO|How to find a client|\$\s?\d/);
    expect(d.description.length).toBeLessThan(DESCRIPTION_TARGET_MIN);
    expect(d.notes.join(" ")).not.toMatch(/padding/);
    expect(d.tags.slice(0, 2)).toEqual(["what is constructhub", "contractor software"]);
    expect(d.tags).toContain("ConstructHUB");
    expect(buildDescription(film()).sha256).toBe(d.sha256);
  });

  it("is chosen by the help group, or asked for; a CRM entry still gets the tutorial text", () => {
    expect(buildDescription(film({ entry: null })).variant).toBe("tutorial");
    expect(buildDescription(film({ entry: null, variant: "brand" })).variant).toBe("brand");
    expect(buildDescription(input()).variant).toBe("tutorial");
  });

  it("keeps the banned words out, leaves a bad chapter list out, and drops the narration before it runs over", () => {
    const d = buildDescription(film({ steps: [{ caption: "x", narration: "It is the best CRM. ConstructHUB is two products." }], chapters: [{ at: "0:00", title: "A" }, { at: "0:04", title: "B" }] }));
    lint(d);
    expect(d.description).not.toMatch(/the best CRM|CHAPTERS/);
    expect(d.notes.join(" ")).toMatch(/left out/);
    const long = buildDescription(film({ steps: Array.from({ length: 80 }, (_, i) => ({ caption: `c${i}`, narration: `Sentence number ${i} of a narration that goes on for far longer than any film's would.` })), chapters: null }));
    lint(long);
    expect(long.description).not.toContain("WHAT THE FILM SAYS");
    expect(long.notes.join(" ")).toMatch(/narration is left out/);
  });

  it("the two films of this checkout get it", async () => {
    const all = (await describeAll([ROOT], [])).filter((d) => d.helpKey.startsWith("brand-"));
    expect(all.map((d) => d.helpKey)).toEqual(expect.arrayContaining(["brand-what-is-constructhub", "brand-tour-crm"]));
    for (const d of all) { lint(d); expect(d.variant, d.helpKey).toBe("brand"); expect(d.description, d.helpKey).toContain("THE TWO PRODUCTS"); }
  });
});

/* ── The lint over the real scripts ───────────────────────────────────────── */

async function describeAll(worktrees: string[], outDirs: string[]): Promise<Described[]> {
  const ctx: DescribeContext = {
    root: ROOT, worktrees, outDirs, tracks: readOrder(path.join(ROOT, "docs", "tutorials", "youtube-order.json")),
    ledger: readLedger(path.join(ROOT, "docs", "tutorials", "youtube-schedule.json")).videos, entryOf: (k) => helpEntry(k),
  };
  const out: Described[] = [];
  for (const k of scriptKeys(worktrees)) { const d = await describeVideo(k, ctx); expect(d, `${k}: a script with no steps?`).not.toBeNull(); out.push(d!); }
  return out;
}
function lintAll(all: Described[]) {
  const short: string[] = [];
  for (const d of all) {
    lint(d);
    // 4,300 or more wherever the script and the entry hold enough. A shorter one is NOT a failure: it says so
    // (`underTarget` + a note the scheduler's dry run prints) and is reported here — never padded.
    if (d.variant === "brand") { expect(d.underTarget, d.helpKey).toBe(false); continue; } // a film has no length target
    if (d.length < DESCRIPTION_TARGET_MIN) { expect(d.underTarget, d.helpKey).toBe(true); expect(d.notes.join(" "), d.helpKey).toMatch(/without padding/); short.push(`${d.helpKey} (${d.length})`); }
    else expect(d.underTarget, d.helpKey).toBe(false);
    if (/^(crm-|jobcam)/.test(d.helpKey)) expect(d.description, d.helpKey).toContain("separate product with its own plans");
  }
  let worst = { s: 0, pair: "" };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const s = similarity(all[i].description, all[j].description);
    if (s > worst.s) worst = { s, pair: `${all[i].helpKey} ~ ${all[j].helpKey}` };
  }
  expect(worst.s, `too alike: ${worst.pair}`).toBeLessThan(0.6);
  return { short, worst };
}

describe("good / better / best is the name of three options, not a claim", () => {
  it("reads past the phrase, and past Best as a label where the text is about the three options — and nowhere else", () => {
    expect(bannedIn("Add a Good, a Better and a Best option.\n▶ Good\n▶ Better\n▶ Best\n13. Best: the top option")).toEqual([]);
    expect(bannedIn("▶ Best\nThe best CRM")).toEqual(["best"]);                       // no three options here
    expect(bannedIn("Good, better and best.\nIt is the best CRM.")).toEqual(["best"]); // a claim is still a claim
  });
});

describe("lint: every step script's description", () => {
  it("this checkout: every script builds a description that keeps all the rules, and no two are near-copies", async () => {
    // Only what is committed: this checkout's scripts and entries, no production folder (chapter times come
    // from one, so the text is checked here in its chapter-less form; --lint-all checks the produced form).
    const all = await describeAll([ROOT], []);
    expect(all.length).toBeGreaterThanOrEqual(5);
    const { short, worst } = lintAll(all);
    console.info(`description lint: ${all.length} scripts in this checkout · ${Math.min(...all.map((d) => d.length))}–${Math.max(...all.map((d) => d.length))} characters · most alike ${worst.s.toFixed(2)} (${worst.pair})`
      + (short.length ? `\n  UNDER ${DESCRIPTION_TARGET_MIN}, reported and not padded: ${short.join(", ")}` : ""));
    for (const d of all) expect(d.input.entry, `${d.helpKey}: no help entry`).not.toBeNull();
    // Short is allowed, but it is the exception: most scripts reach the target from their own material.
    expect(short.length, `too many under the target: ${short.join(", ")}`).toBeLessThan(all.length / 4);
  });

  it("the Database Directory video is described as the permit directory it is, not as a CRM video", async () => {
    const d = (await describeAll([ROOT], [])).find((x) => x.helpKey === "database-directory")!;
    expect(d.area).toBe("permits");
    expect(d.title).toBe("How to Find Any Building Permit Office & Permit Portal | ConstructHUB");
    expect(d.description).toMatch(/permit office/i);
    expect(d.description).toMatch(/permit portal/i);
    expect(d.description).toContain("Free to browse.");
    expect(d.description).toContain("#buildingpermits");
    expect(d.description).not.toMatch(/ConstructHUB CRM -|constructionCRM|CRM plan|sample data/);
    expect(d.tags).toEqual(expect.arrayContaining(["building permit lookup", "permit office lookup", "permit portal", "county building permits", "city building permits"]));
  });

  it("never reads a sibling worktree: the same scripts are found whatever else is on the machine", () => {
    const here = fs.readdirSync(path.join(ROOT, "docs", "tutorials", "scripts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    expect(scriptKeys([ROOT])).toEqual(here);
    expect(siblingWorktrees(ROOT)[0]).toBe(ROOT); // the CLI's --lint-all starts from here and adds the others
  });

  it("reads the planned titles for the related list", () => {
    const titles = planTitles(ROOT);
    expect(titles.get("crm-clients")).toBe("Find a client and read their page");
    expect(titles.size).toBeGreaterThan(50);
  });
});
