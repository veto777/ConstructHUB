/**
 * The daily gator clip — one command, and a person in the middle.
 *
 *   D="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/daily.ts"
 *   $D                       make the next approved concept (within the per-clip budget), run the automatic
 *                            checks, and put it in the review folder. STOPS THERE — nothing is posted.
 *   $D --status              the queue: what is waiting for review, what is approved, what is next
 *   $D --approve <id>        "I looked at its frames (and listened): post it" — uploads it and queues it at
 *                            the next free peak slot on each account (the cadence and the rate rules hold)
 *   $D --reject <id> --why "…"   it is not posted; the reason is kept, and the next run moves on
 *   --budget N               credits one clip may cost, retakes included (default 24 ≈ $1.50)
 *   --concept <id>           make this one instead of the next in the queue
 *
 * The queue is docs/gator/queue.json (committed): `order` is the list of concepts APPROVED FOR MAKING, in
 * order — add an id to approve its concept; `state` is what became of each. A clip that has not been
 * through `--approve` cannot be posted by this tool: an automatic check can measure loudness and size, it
 * cannot see a second tail or hear a wrong word. No cron, no timer: someone runs this.
 *
 * Review folder: analysis/gator-shorts/_review/<id>/ — clip.mp4, cover.jpg, review.jpg (twelve frames),
 * REVIEW.md (the checklist and what the checks measured).
 */
import fs from "fs";
import path from "path";
import { ROOT, parseArgs } from "../tutorials/lib";
import { CONCEPTS, conceptById, lintConcept, type Concept } from "./concepts";
import { spent } from "./higgsfield";
import { OUT, clipSpent, produce, readLedger } from "./make";
import { viralMain } from "./post";

export const QUEUE = path.join(ROOT, "docs", "gator", "queue.json");
export const REVIEW_DIR = path.join(OUT, "_review");
export const DEFAULT_CLIP_BUDGET = 24;
export type QueueState = { status: "ready-for-review" | "approved" | "rejected"; at: string; credits?: number; checks?: string[]; why?: string };
export type Queue = { version: 1; order: string[]; state: Record<string, QueueState> };
export const readQueue = (file = QUEUE): Queue => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1, order: [], state: {} });
const saveQueue = (q: Queue) => { fs.mkdirSync(path.dirname(QUEUE), { recursive: true }); fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2) + "\n"); };

/** The next concept to make: the first in `order` that has no state yet. Pure (tested). */
export function nextInQueue(q: Queue, known: readonly string[]): string | null {
  for (const id of q.order) if (!q.state[id] && known.includes(id)) return id;
  return null;
}
/** May this clip be posted? Only after a reviewer said so. Pure (tested). */
export function mayPost(q: Queue, id: string): string | null {
  const s = q.state[id];
  if (!s) return `${id} has not been made by the daily command`;
  if (s.status === "rejected") return `${id} was rejected${s.why ? `: ${s.why}` : ""}`;
  if (s.status === "ready-for-review") return null;
  return `${id} is already ${s.status}`;
}

/** What a machine can check of a finished clip. An empty list = nothing wrong that can be measured. */
export function automaticChecks(c: Concept, social: any, creditsSpent: number, budget: number): { passed: string[]; failed: string[] } {
  const passed: string[] = [], failed: string[] = [], ok = (cond: boolean, yes: string, no: string) => (cond ? passed : failed).push(cond ? yes : no);
  const lint = lintConcept(c);
  ok(!lint.length, "the concept keeps the house rules that can be checked", `house rules: ${lint.join("; ")}`);
  ok(social?.clip?.width === 1080 && social?.clip?.height === 1920 && social?.clip?.fps === 30, "1080×1920, 30 fps", `the clip is ${social?.clip?.width}×${social?.clip?.height} at ${social?.clip?.fps} fps`);
  ok(social?.clip?.durationSec >= 5 && social?.clip?.durationSec <= 30, `${social?.clip?.durationSec} s`, `${social?.clip?.durationSec} s is outside 5–30 s`);
  ok(Math.abs((social?.clip?.lufs ?? -99) + 14) <= 2, `${social?.clip?.lufs} LUFS`, `${social?.clip?.lufs} LUFS is not about −14`);
  ok((social?.clip?.truePeakDb ?? 0) <= -1, `true peak ${social?.clip?.truePeakDb} dBTP`, `true peak ${social?.clip?.truePeakDb} dBTP — too hot`);
  ok(social?.aiGenerated === true && social?.disclosure?.tiktok?.isAiGenerated === true && social?.disclosure?.youtube?.containsSyntheticMedia === true, "AI-generated flags set for every platform", "an AI-generated flag is missing");
  if (c.shots.some((s) => s.say)) ok((social?.speech?.lineOverBedDb ?? 0) >= 10, `the line is ${social?.speech?.lineOverBedDb} dB over the bed`, `the line is only ${social?.speech?.lineOverBedDb} dB over the bed`);
  ok(creditsSpent <= budget + 1e-9, `${creditsSpent} credits (budget ${budget})`, `${creditsSpent} credits — over the clip's budget of ${budget}`);
  return { passed, failed };
}

const reviewMd = (c: Concept, social: any, checks: { passed: string[]; failed: string[] }, credits: number) => `# Review: ${c.title} (\`${c.id}\`)

Made ${new Date().toISOString()} · ${social.clip.durationSec} s · ${credits} credits ($${(credits * 0.0625).toFixed(2)}) · ${c.shots.some((s) => s.say) ? "he talks" : "silent / captions only"}

**Nothing is posted until someone has looked.** Open \`clip.mp4\` (sound on) and \`review.jpg\`, then:

- [ ] He is our gator in every shot: yellow hard hat, dark sunglasses (no eyes showing), black hoodie, orange vest, tool belt, boots; one tail; hands not mangled
- [ ] No teeth-baring grin popping in a shot where he should be deadpan
- [ ] No readable or garbled lettering, no logo, no badge, no real brand anywhere in the picture
- [ ] At height: harness on, lanyard visibly clipped to an anchor
- [ ] The hook reads in the first second and nothing important is under the captions
${c.shots.some((s) => s.say) ? `- [ ] The line is said right (every word, no mispronunciation): ${c.shots.filter((s) => s.say).map((s) => `“${s.say!.text}”`).join(" / ")}\n- [ ] His jaw moves while he talks and is shut when he does not\n` : ""}- [ ] It is funny or charming, warm, and at nobody's expense

Approve: \`npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/daily.ts --approve ${c.id}\`
Reject:  \`npx tsx scripts/gator/daily.ts --reject ${c.id} --why "…"\`  ·  retake a shot: \`scripts/gator/make.ts ${c.id} --retake-still s1\` / \`--retake-video s1\`, then \`--assemble\`

## Measured
${checks.passed.map((p) => `- ok: ${p}`).join("\n")}
${checks.failed.map((p) => `- **FAILED: ${p}**`).join("\n")}

## Posts
${Object.entries(social.platforms).map(([p, v]: [string, any]) => (v ? `**${p}**${v.title ? ` — ${v.title}` : ""}\n\n> ${String(v.text).split("\n").join("\n> ")}` : `**${p}** — skipped`)).join("\n\n")}
`;

/** Copy a finished clip into the review folder with its sheet. Returns the checks. */
export function toReview(c: Concept, budget: number): { passed: string[]; failed: string[]; credits: number } {
  const src = path.join(OUT, c.id), dst = path.join(REVIEW_DIR, c.id);
  const social = JSON.parse(fs.readFileSync(path.join(src, "social.json"), "utf8")), credits = clipSpent(readLedger(), c.id);
  const checks = automaticChecks(c, social, credits, budget);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ["clip.mp4", "cover.jpg", "review.jpg", "social.json"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  fs.writeFileSync(path.join(dst, "REVIEW.md"), reviewMd(c, social, checks, credits));
  return { ...checks, credits };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["status"]);
  const q = readQueue(), known = CONCEPTS.map((c) => c.id);
  const budget = typeof args.flags.budget === "string" ? Number(args.flags.budget) : DEFAULT_CLIP_BUDGET;
  if (!(budget > 0 && budget <= 100)) throw new Error("--budget is 1–100 credits");
  if (args.flags.status) {
    const s = spent(readLedger());
    console.log(`budget: ${s.credits} of ${readLedger().cap.credits} credits spent`);
    for (const id of q.order) console.log(`  ${(q.state[id]?.status ?? "to make").padEnd(17)} ${id}${q.state[id]?.why ? `  (${q.state[id].why})` : ""}`);
    console.log(`next: ${nextInQueue(q, known) ?? "— the queue is empty: add concept ids to `order` in docs/gator/queue.json"}`);
    return;
  }
  if (typeof args.flags.reject === "string") {
    const id = args.flags.reject;
    if (!q.state[id]) throw new Error(`${id} is not in the review queue`);
    q.state[id] = { ...q.state[id], status: "rejected", at: new Date().toISOString(), why: typeof args.flags.why === "string" ? args.flags.why : "no reason given" };
    saveQueue(q); console.log(`${id}: rejected — it will not be posted`);
    return;
  }
  if (typeof args.flags.approve === "string") {
    const id = args.flags.approve, no = mayPost(q, id);
    if (no) throw new Error(no);
    if (!fs.existsSync(path.join(REVIEW_DIR, id, "REVIEW.md"))) throw new Error(`${id} has no review sheet (${path.join(REVIEW_DIR, id)})`);
    if (q.state[id].checks?.length) throw new Error(`${id} failed its automatic checks (${q.state[id].checks!.join("; ")}) — fix and assemble it again before approving`);
    // The cadence (one a day at a peak slot, never back-to-back, the platforms' rate rule) picks the time.
    const code = await viralMain([id, "--go", "--brief"]);
    if (code !== 0) throw new Error(`${id}: the poster stopped (exit ${code}) — it stays ready for review`);
    q.state[id] = { ...q.state[id], status: "approved", at: new Date().toISOString() };
    saveQueue(q); console.log(`${id}: approved and queued — commit docs/gator/queue.json and docs/gator/viral-schedule.json`);
    return;
  }
  const id = typeof args.flags.concept === "string" ? args.flags.concept : nextInQueue(q, known);
  if (!id) { console.log("Nothing to make: every concept in docs/gator/queue.json `order` has been made. Add ids to approve more concepts."); return; }
  if (q.state[id]) throw new Error(`${id} is already ${q.state[id].status}`);
  if (!q.order.includes(id)) throw new Error(`${id} is not approved for making — add it to \`order\` in docs/gator/queue.json`);
  const c = conceptById(id);
  console.log(`${id} — “${c.title}”  (budget ${budget} credits)`);
  await produce(c, budget);
  const r = toReview(c, budget);
  q.state[id] = { status: "ready-for-review", at: new Date().toISOString(), credits: r.credits, ...(r.failed.length ? { checks: r.failed } : {}) };
  saveQueue(q);
  for (const p of r.passed) console.log(`  ok: ${p}`);
  for (const f of r.failed) console.log(`  FAILED: ${f}`);
  console.log(`\nREADY FOR REVIEW — not posted: ${path.join(REVIEW_DIR, id)}\n  look at clip.mp4 and review.jpg, tick REVIEW.md, then:  daily.ts --approve ${id}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
