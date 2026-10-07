/**
 * Step scripts for the walkthrough videos (docs/tutorials/VIDEO-PIPELINE.md).
 *
 * One script per help entry: a recorder (Playwright, `recordVideo`) plays the steps against a demo
 * account, moving a visible cursor and drawing a highlight ring on each target; the same file feeds
 * the narration (one line per step) and the captions (.vtt). Nothing here records anything — this
 * is the contract the recorder and the scripts share. The JSON Schema twin is step-script.schema.json.
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
  /** The on-screen caption for this step (also the .vtt cue text). */
  caption: z.string().min(1).max(160),
  /** The sentence the narrator says over this step. */
  narration: z.string().min(1).max(600),
  /** Extra time to stay on the step after the action, in ms (the recorder also waits for the narration). */
  holdMs: z.number().int().min(0).max(30_000).optional(),
  /** Blur the target in the recording (keys, emails, client names). */
  redact: z.boolean().optional(),
}).superRefine((s, ctx) => {
  if (s.action === "goto" && !s.url) ctx.addIssue({ code: "custom", message: "goto needs url", path: ["url"] });
  if (!["goto", "wait", "press"].includes(s.action) && !s.selector) ctx.addIssue({ code: "custom", message: `${s.action} needs selector`, path: ["selector"] });
  if (["type", "select", "press"].includes(s.action) && s.value === undefined) ctx.addIssue({ code: "custom", message: `${s.action} needs value`, path: ["value"] });
});
export type TutorialStep = z.infer<typeof tutorialStepSchema>;

export const tutorialScriptSchema = z.object({
  /** The help entry this video belongs to (a key of HELP_ENTRIES). */
  helpKey: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  /** Recording size; the page is responsive, so a phone cut is a second script run. */
  viewport: z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(480).max(2160) }),
  /** The Call Assistant persona whose voice narrates (shared/voice-personas.ts). */
  narrator: z.enum(["janice", "gabe", "sofia", "maya", "marcus", "ethan"]).default("janice"),
  steps: z.array(tutorialStepSchema).min(1).max(80),
});
export type TutorialScript = z.infer<typeof tutorialScriptSchema>;

/** Parse a script file's JSON; throws a ZodError naming the bad step. */
export const parseTutorialScript = (json: unknown): TutorialScript => tutorialScriptSchema.parse(json);
