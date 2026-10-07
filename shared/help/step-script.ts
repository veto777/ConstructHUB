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
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

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
}).superRefine((s, ctx) => {
  if (s.action === "goto" && !s.url) ctx.addIssue({ code: "custom", message: "goto needs url", path: ["url"] });
  if (!["goto", "wait", "press", "back"].includes(s.action) && !s.selector) ctx.addIssue({ code: "custom", message: `${s.action} needs selector`, path: ["selector"] });
  if (["type", "select", "press"].includes(s.action) && s.value === undefined) ctx.addIssue({ code: "custom", message: `${s.action} needs value`, path: ["value"] });
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
  /** What the YouTube upload says (youtube.json is generated from this and the measured timings). */
  youtube: z.object({
    /** Task first: "How to create and send an estimate | ConstructHUB CRM". */
    title: z.string().min(10).max(70),
    /** Two or three true sentences; chapters and links are added by the tool. */
    description: z.string().min(40).max(600),
    tags: z.array(z.string().min(2).max(40)).min(3).max(12),
    playlist: z.string().min(3).max(100).default("ConstructHUB CRM tutorials"),
    /** 28 Science & Technology, 27 Education. */
    category: z.union([z.literal(27), z.literal(28)]).default(28),
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
  else if (s.thumbnail && !["highlight", "hover", "type", "select", "scroll"].includes(s.steps[s.thumbnail.step].action))
    ctx.addIssue({ code: "custom", message: "thumbnail.step must be a highlight, hover, type, select or scroll step (the ring stays on those)", path: ["thumbnail", "step"] });
  if (s.thumbnail?.accent && !s.thumbnail.headline.toLowerCase().split(/\s+/).includes(s.thumbnail.accent.toLowerCase())) ctx.addIssue({ code: "custom", message: "thumbnail.accent must be a word of the headline", path: ["thumbnail", "accent"] });
});
export type TutorialScript = z.infer<typeof tutorialScriptSchema>;

/** Parse a script file's JSON; throws a ZodError naming the bad step. */
export const parseTutorialScript = (json: unknown): TutorialScript => tutorialScriptSchema.parse(json);
