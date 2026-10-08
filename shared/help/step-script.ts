/**
 * Step scripts for the walkthrough videos (docs/tutorials/VIDEO-PIPELINE.md).
 *
 * One script per help entry: a recorder (Playwright, `recordVideo`) plays the steps against a demo
 * account, moving a visible cursor and drawing a highlight ring on each target; the same file feeds
 * the narration (one line per step) and the captions (.vtt). Nothing here records anything — this
 * is the contract the tools (scripts/tutorials/) and the scripts share. The JSON Schema twin is step-script.schema.json.
 */
import { z } from "zod";

/** What the cursor does at a step. */
export const STEP_ACTIONS = [
  "goto",       // open `url` (a path on the app under recording)
  "highlight",  // ring the target, no click — "look here"
  "hover",
  "click",
  "type",       // type `value` into the target (never a real credential — see `redact`)
  "select",     // choose `value` in a <select>
  "press",      // press the key named in `value` (e.g. "Escape")
  "scroll",     // scroll the target into view
  "wait",       // hold on the current frame for `holdMs` (narration only)
  "back",       // the browser's Back button (after a link that opened what would be a new tab)
  "upload",     // choose `files` (demo files in scripts/tutorials/assets/) in the file input or file chooser behind the target
  "drag",       // press on the target, carry it to `to`, let go (a card to another column)
  "session",    // switch to another person's browser: `session` = "owner" | "client" | "member:<Name>"
  "fixture",    // call a tutorial fixture helper (recording slots only): `fixture` = "<provider>.<action>", `input`
  "wait-for",   // wait until `selector` or `text` is on screen (or gone: `state: "hidden"`), up to `timeoutMs`
  "scroll-to",  // scroll the page so the target sits `offset` px under the top (no ring) — open a long page at a card
  "card",       // a full-screen brand card (`card`): a stat, or a two-column comparison — overview films only
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

/**
 * A full-screen card (scripts/tutorials/card.ts draws it). A NUMBER ON A CARD IS A CLAIM: a card that
 * shows a price ("$") must carry a footnote saying whose list price it is and as of when — and the
 * film's entry in docs/brand/VIDEO-SCRIPTS.md lists where the number was read.
 */
export const tutorialCardSchema = z.object({
  /** The small label above the headline ("As of October 2026"). */
  kicker: z.string().min(2).max(56).optional(),
  headline: z.string().min(2).max(64),
  /** Word(s) of the headline to set on the orange pill. */
  accent: z.string().min(1).max(28).optional(),
  /** One big figure and what it counts. */
  stat: z.object({ value: z.string().min(1).max(10), label: z.string().min(2).max(64) }).optional(),
  /** Exactly two columns, side by side: them, then us (`us: true` draws the orange frame). */
  columns: z.array(z.object({
    title: z.string().min(2).max(34), value: z.string().min(1).max(10).optional(), unit: z.string().min(2).max(60).optional(),
    lines: z.array(z.string().min(2).max(64)).max(4).optional(), us: z.boolean().optional(),
  })).length(2).optional(),
  /** The small print: whose price, which plan, as of when. */
  footnote: z.string().min(4).max(200).optional(),
  /** The gator, bottom right. */
  mascot: z.boolean().optional(),
}).superRefine((c, ctx) => {
  if (c.stat && c.columns) ctx.addIssue({ code: "custom", message: "a card is a stat or two columns, not both", path: ["columns"] });
  if (c.accent && !c.headline.toLowerCase().includes(c.accent.toLowerCase())) ctx.addIssue({ code: "custom", message: "accent must be part of the headline", path: ["accent"] });
  const shown = [c.headline, c.stat?.value, c.stat?.label, ...(c.columns ?? []).flatMap((x) => [x.value, x.unit, ...(x.lines ?? [])])].filter(Boolean).join(" ");
  if (/\$\s?\d/.test(shown) && !/\b(20\d\d)\b/.test(c.footnote ?? "")) ctx.addIssue({ code: "custom", message: "a card that shows a price needs a footnote that says whose list price it is and as of when (a year)", path: ["footnote"] });
});
export type TutorialCard = z.infer<typeof tutorialCardSchema>;

export const tutorialStepSchema = z.object({
  /** CSS selector or a `data-testid=…` selector of the element to act on. Not needed for goto/wait. */
  selector: z.string().min(1).max(300).optional(),
  action: z.enum(STEP_ACTIONS),
  /** goto only: a root-relative path. */
  url: z.string().regex(/^\//).max(300).optional(),
  /** type / select / press. */
  value: z.string().max(500).optional(),
  /** A short label for this step (the recorder's log and timings.json). */
  caption: z.string().min(1).max(160),
  /** What the narrator says over this step; it is also the captions track (captions.vtt). */
  narration: z.string().min(1).max(600),
  /** Extra time to stay on the step after the action, in ms (the recorder also waits for the narration). */
  holdMs: z.number().int().min(0).max(30_000).optional(),
  /** Blur the target in the recording (keys, emails, client names). */
  redact: z.boolean().optional(),
  /** Starts a YouTube chapter with this name (the first step always starts one, at 0:00). */
  chapter: z.string().min(2).max(60).optional(),
  /** upload: demo files to choose, by their path under scripts/tutorials/assets/ ("photos/site-02.jpg"). Never a file from anywhere else. */
  files: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.[a-z0-9]+$/).max(120)).min(1).max(12).optional(),
  /** drag: the selector of where to drop. */
  to: z.string().min(1).max(300).optional(),
  /**
   * session: whose browser the camera shows from here on. "owner" — the demo owner (where every video
   * starts); "client" — the homeowner, signed out, on the client portal's own host; "member:<Display
   * Name>" — one of the demo company's team members, really signed in as them. Each has its own cookies.
   * With `url`, the session opens that path first; with `fixture` (+ `input`), the address that helper
   * hands over — the link in the client's email, a checkout link.
   */
  session: z.string().regex(/^(owner|client|member:[A-Za-z][A-Za-z .'&-]{1,60})$/).optional(),
  /** fixture: the helper to call, "<provider>.<action>" (docs/tutorials/FIXTURES.md lists them). */
  fixture: z.string().regex(/^[a-z][a-z-]*\.[a-z][a-zA-Z]*$/).max(60).optional(),
  /** fixture: what the helper takes. Strings may use {{DATE}} and {{PLACEHOLDERS}} like `value`. */
  input: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  /** fixture: open the address the helper answers with (an emailed link) in the current session. */
  open: z.boolean().optional(),
  /** wait-for: text to wait for, instead of (or as well as) `selector`. */
  text: z.string().min(1).max(200).optional(),
  /** wait-for: "visible" (default) or "hidden". */
  state: z.enum(["visible", "hidden"]).optional(),
  /** wait-for: how long to wait, in ms (default 15000). */
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  /**
   * scroll-to: how far under the top of the window the target comes to rest, in CSS px (default 84: clear of the app's header).
   * Also for a `goto` that has a `selector`: the page opens already scrolled to that element, and nothing above it is ever filmed.
   */
  offset: z.number().int().min(0).max(400).optional(),
  /** card: what the card says. */
  card: tutorialCardSchema.optional(),
  /**
   * click: the page will ask "are you sure?" with the browser's own confirm box (window.confirm) —
   * "accept" answers OK. Without it the recorder answers Cancel, as it always has. The box itself is
   * never on camera (a headless browser draws none): say what was asked in the narration.
   */
  dialog: z.enum(["accept", "dismiss"]).optional(),
  /** highlight / hover: push in on the target (1.15–1.8 × the page) for this step — the money moment. Undone by the next step. */
  punch: z.number().min(1.1).max(1.8).optional(),
}).superRefine((s, ctx) => {
  if (s.action === "goto" && !s.url) ctx.addIssue({ code: "custom", message: "goto needs url", path: ["url"] });
  if (!["goto", "wait", "press", "back", "session", "fixture", "wait-for", "card"].includes(s.action) && !s.selector) ctx.addIssue({ code: "custom", message: `${s.action} needs selector`, path: ["selector"] });
  if (["type", "select", "press"].includes(s.action) && s.value === undefined) ctx.addIssue({ code: "custom", message: `${s.action} needs value`, path: ["value"] });
  if (s.action === "upload" && !s.files) ctx.addIssue({ code: "custom", message: "upload needs files", path: ["files"] });
  if (s.action === "drag" && !s.to) ctx.addIssue({ code: "custom", message: "drag needs to", path: ["to"] });
  if (s.action === "session" && !s.session) ctx.addIssue({ code: "custom", message: "session needs session", path: ["session"] });
  if (s.action === "fixture" && !s.fixture) ctx.addIssue({ code: "custom", message: "fixture needs fixture", path: ["fixture"] });
  if (s.action === "wait-for" && !s.selector && !s.text) ctx.addIssue({ code: "custom", message: "wait-for needs selector or text", path: ["selector"] });
  if (s.action === "card" && !s.card) ctx.addIssue({ code: "custom", message: "card needs card", path: ["card"] });
  if (s.action === "card" && s.selector) ctx.addIssue({ code: "custom", message: "a card has no selector", path: ["selector"] });
  if (s.card !== undefined && s.action !== "card") ctx.addIssue({ code: "custom", message: "card is only for card", path: ["card"] });
  if (s.offset !== undefined && !(s.action === "scroll-to" || (s.action === "goto" && s.selector))) ctx.addIssue({ code: "custom", message: "offset is only for scroll-to, or a goto that arrives at a selector", path: ["offset"] });
  if (s.dialog !== undefined && s.action !== "click") ctx.addIssue({ code: "custom", message: "dialog is only for click", path: ["dialog"] });
  if (s.punch !== undefined && !["highlight", "hover"].includes(s.action)) ctx.addIssue({ code: "custom", message: "punch is only for highlight / hover", path: ["punch"] });
  // A field that belongs to another action is a typo, not a hint: refuse it.
  const only = (field: "files" | "to" | "session" | "fixture" | "input" | "open" | "text" | "state" | "timeoutMs", actions: string[]) => {
    if (s[field] !== undefined && !actions.includes(s.action)) ctx.addIssue({ code: "custom", message: `${field} is only for ${actions.join(" / ")}`, path: [field] });
  };
  only("files", ["upload"]); only("to", ["drag"]); only("session", ["session"]); only("fixture", ["fixture", "session"]); only("input", ["fixture", "session"]); only("open", ["fixture"]);
  only("text", ["wait-for"]); only("state", ["wait-for"]); only("timeoutMs", ["wait-for"]);
  if (s.url !== undefined && !["goto", "session"].includes(s.action)) ctx.addIssue({ code: "custom", message: "url is only for goto / session", path: ["url"] });
  if (s.action === "session" && s.url !== undefined && s.fixture !== undefined) ctx.addIssue({ code: "custom", message: "a session opens at url or at a fixture's address, not both", path: ["fixture"] });
});
export type TutorialStep = z.infer<typeof tutorialStepSchema>;

export const tutorialScriptSchema = z.object({
  /** The help entry this video belongs to (a key of HELP_ENTRIES). */
  helpKey: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  /** Recording size; the page is responsive, so a phone cut is a second script run. */
  viewport: z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(480).max(2160) }),
  /**
   * Device scale factor: the video is viewport × zoom pixels. The house style is a 1024×576 page at
   * 1.875 — a 1920×1080 master in which the page is 25% larger than on a 1280-wide screen.
   */
  zoom: z.number().min(1).max(3).default(1),
  /** The Call Assistant persona whose voice narrates (shared/voice-personas.ts). */
  narrator: z.enum(["janice", "gabe", "sofia", "maya", "marcus", "ethan"]).default("janice"),
  steps: z.array(tutorialStepSchema).min(1).max(80),
  /**
   * Blurred FROM PAGE LOAD, on every page of the recording, before the element first paints — for
   * something secret that appears by itself (a key the page shows right after "Create", a join link,
   * an embed code) and would be readable until a later step pointed at it. Plain CSS selectors only
   * (`[data-testid="text-new-api-key"] code`): they go into a stylesheet, so no `text=` / `>>` / `:has-text()`.
   * A step's own `redact: true` still blurs its target when the step reaches it.
   */
  redactSelectors: z.array(z.string().min(1).max(200).refine((v) => !/text=|>>|:has-text|:text\(|xpath=|[{}<]/.test(v), "a plain CSS selector")).max(12).optional(),
  /**
   * Taken out of the picture (their space is kept) on every page of the recording, from page load: a
   * mark that may not appear in a film — the overview films carry no Google logo, and the app's own
   * side menu draws three. Presentation only, like the assistant bubble the recorder already hides;
   * never a way to hide what a feature really shows. Plain CSS selectors.
   */
  hideSelectors: z.array(z.string().min(1).max(200).refine((v) => !/text=|>>|:has-text|:text\(|xpath=|[{}<]/.test(v), "a plain CSS selector")).max(12).optional(),
  /** What the YouTube upload says (youtube.json is generated from this and the measured timings). */
  youtube: z.object({
    /** Task first: "How to create and send an estimate | ConstructHUB CRM". */
    title: z.string().min(10).max(70),
    /** Two or three true sentences: the opening of the YouTube description. The rest (steps, chapters, links, search terms) is built at upload time by server/youtube/description.ts. */
    description: z.string().min(40).max(600),
    tags: z.array(z.string().min(2).max(40)).min(3).max(12),
    playlist: z.string().min(3).max(100).default("ConstructHUB CRM tutorials"),
    /** 28 Science & Technology, 27 Education. */
    category: z.union([z.literal(27), z.literal(28)]).default(28),
    /**
     * Overview films only. Where every number on screen about ANOTHER company was read, and when: the
     * description prints them under SOURCES. A script whose cards or narration name a competitor's
     * price must list its source here (server/help-registry.test.ts).
     */
    sources: z.array(z.object({ label: z.string().min(3).max(120), url: z.string().url().startsWith("https://").max(200), read: z.string().regex(/^20\d\d-\d\d-\d\d$/) })).max(6).optional(),
    /** Companies the film names: the description says their names are their owners' trademarks and that ConstructHUB is not affiliated. */
    names: z.array(z.string().min(2).max(40)).max(6).optional(),
  }).optional(),
  /** The designed 1280×720 thumbnail (scripts/tutorials/thumbnail.ts). */
  thumbnail: z.object({
    /** Two to five words, true to the video: "SEND ESTIMATES FAST". */
    headline: z.string().min(4).max(40).refine((h) => { const n = h.trim().split(/\s+/).length; return n >= 2 && n <= 5; }, "2 to 5 words"),
    /** One word of the headline to set in orange. */
    accent: z.string().min(1).max(20).optional(),
    kicker: z.string().min(2).max(28).default("CRM Tutorial"),
    /** The step whose finished frame is the screenshot (its ring marks the key element). */
    step: z.number().int().min(0).max(79),
  }).optional(),
}).superRefine((s, ctx) => {
  if (s.thumbnail && s.thumbnail.step >= s.steps.length) ctx.addIssue({ code: "custom", message: "thumbnail.step is not a step", path: ["thumbnail", "step"] });
  // The thumbnail's screenshot is taken at the END of that step, and wants the ring on the key element:
  // a click drops its ring (and usually changes the screen), a goto / back / wait / press has none.
  else if (s.thumbnail && !["highlight", "hover", "type", "select", "scroll", "card"].includes(s.steps[s.thumbnail.step].action))
    ctx.addIssue({ code: "custom", message: "thumbnail.step must be a highlight, hover, type, select or scroll step (the ring stays on those), or a card", path: ["thumbnail", "step"] });
  if (s.thumbnail?.accent && !s.thumbnail.headline.toLowerCase().split(/\s+/).includes(s.thumbnail.accent.toLowerCase())) ctx.addIssue({ code: "custom", message: "thumbnail.accent must be a word of the headline", path: ["thumbnail", "accent"] });
});
export type TutorialScript = z.infer<typeof tutorialScriptSchema>;

/** Parse a script file's JSON; throws a ZodError naming the bad step. */
export const parseTutorialScript = (json: unknown): TutorialScript => tutorialScriptSchema.parse(json);
