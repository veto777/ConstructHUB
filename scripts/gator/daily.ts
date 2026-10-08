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
import { readQueue, saveQueue, type PostPlatform, type Queue } from "./queue";

export { QUEUE, readQueue, type Queue, type QueueState } from "./queue";
export const REVIEW_DIR = path.join(OUT, "_review");
export const DEFAULT_CLIP_BUDGET = 24;

/**
 * The next concept to MAKE: the first in `order` that has no state and no finished clip. A clip that is
 * already on disk (`made`) is never made — and paid for — again: it is registered instead. Pure (tested).
 */
export function nextInQueue(q: Queue, known: readonly string[], made: readonly string[] = []): string | null {
  for (const id of q.order) if (!q.state[id] && known.includes(id) && !made.includes(id)) return id;
  return null;
}
/** May this clip be approved? Only one that was made and is waiting (or held). Pure (tested). */
export function mayApprove(q: Queue, id: string): string | null {
  const s = q.state[id];
  if (!s) return `${id} has not been made by the daily command`;
  if (s.status === "rejected") return `${id} was rejected${s.why ? `: ${s.why}` : ""}`;
  if (s.status === "ready-for-review" || s.status === "held") return s.checks?.length ? `${id} failed its automatic checks (${s.checks.join("; ")})` : null;
  return `${id} is already ${s.status}`;
}
/** May this clip be posted? Only after a reviewer said so. Pure (tested). */
export function mayPost(q: Queue, id: string): string | null {
  const s = q.state[id];
  if (!s) return `${id} has not been made by the daily command`;
  if (s.status === "approved") return s.post && s.caption ? null : `${id} is approved but has no caption or no file per platform`;
  return `${id} is ${s.status}${s.why ? `: ${s.why}` : ""} — not posted`;
}
/** Which file each platform gets by default: subtitles where he talks (muted feeds), the music cut of a replay edit; LinkedIn only when asked. Pure (tested). */
export function defaultPost(files: readonly string[], o: { talks: boolean; replay?: boolean; linkedin?: boolean }): Partial<Record<PostPlatform, string>> {
  const has = (f: string) => files.includes(f);
  const feed = o.replay && has("replay-music.mp4") ? "replay-music.mp4" : o.talks && has("captioned.mp4") ? "captioned.mp4" : has("pure.mp4") ? "pure.mp4" : "clip.mp4";
  return { tiktok: feed, instagram: feed, ...(o.linkedin ? { linkedin: has("pure.mp4") ? "pure.mp4" : "clip.mp4" } : {}) };
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
  for (const f of ["clip.mp4", "cover.jpg", "review.jpg", "social.json"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  fs.writeFileSync(path.join(dst, "REVIEW.md"), reviewMd(c, social, checks, credits));
  return { ...checks, credits };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["status", "schedule", "go", "linkedin"]);
  const q = readQueue(), known = CONCEPTS.map((c) => c.id);
  const budget = typeof args.flags.budget === "string" ? Number(args.flags.budget) : DEFAULT_CLIP_BUDGET;
  if (!(budget > 0 && budget <= 100)) throw new Error("--budget is 1–100 credits");
  if (args.flags.status) {
    const s = spent(readLedger());
    console.log(`budget: ${s.credits} of ${readLedger().cap.credits} credits spent`);
    for (const id of q.order) console.log(`  ${(q.state[id]?.status ?? "to make").padEnd(17)} ${id}${q.state[id]?.why ? `  (${q.state[id].why})` : ""}`);
    console.log(`next: ${nextInQueue(q, known, known.filter((k) => fs.existsSync(path.join(OUT, k, "social.json")))) ?? "— the queue is empty: add concept ids to `order` in docs/gator/queue.json"}`);
    return;
  }
  if (typeof args.flags.reject === "string") {
    const id = args.flags.reject;
    if (!q.state[id]) throw new Error(`${id} is not in the review queue`);
    q.state[id] = { ...q.state[id], status: "rejected", at: new Date().toISOString(), why: typeof args.flags.why === "string" ? args.flags.why : "no reason given" };
    saveQueue(q); console.log(`${id}: rejected — it will not be posted`);
    return;
  }
  if (typeof args.flags.hold === "string") {
    const id = args.flags.hold;
    if (!q.state[id]) throw new Error(`${id} is not in the review queue`);
    q.state[id] = { ...q.state[id], status: "held", at: new Date().toISOString(), why: typeof args.flags.why === "string" ? args.flags.why : "waiting for the owner" };
    saveQueue(q); console.log(`${id}: held — it will not be posted until someone approves it`);
    return;
  }
  if (typeof args.flags.approve === "string") {
    // "I looked at its frames (and listened): it may be posted." Approving does not post: --schedule does.
    const id = args.flags.approve, no = mayApprove(q, id);
    if (no) throw new Error(no);
    const dir = path.join(OUT, id), c = conceptById(id);
    const caption: [string, string?] = typeof args.flags.caption === "string" ? (args.flags.caption.split("|").map((x) => x.trim()) as [string, string?]) : q.state[id].caption ?? [c.caption];
    const post = q.state[id].post ?? defaultPost(fs.readdirSync(dir), { talks: c.shots.some((x) => x.say), replay: fs.existsSync(path.join(dir, "replay-music.mp4")) && !c.shots.some((x) => x.say), linkedin: !!args.flags.linkedin });
    q.state[id] = { ...q.state[id], status: "approved", at: new Date().toISOString(), by: typeof args.flags.by === "string" ? args.flags.by : "a reviewer", caption, post };
    delete q.state[id].why;
    saveQueue(q); console.log(`${id}: approved — ${Object.entries(post).map(([p, f]) => `${p}: ${f}`).join(", ")}. It goes out with the next --schedule --go.`);
    return;
  }
  if (args.flags.schedule) {
    // Every approved clip that an account does not have yet, in the queue's order, into the next free gator slots.
    const ids = q.order.filter((id) => !mayPost(q, id));
    if (!ids.length) { console.log("Nothing approved is waiting."); return; }
    const code = await viralMain([...ids, "--brief", ...(args.flags.go ? ["--go"] : []), ...(typeof args.flags.table === "string" ? ["--table", args.flags.table] : []), ...(typeof args.flags.platform === "string" ? ["--platform", args.flags.platform] : [])]);
    if (code !== 0) throw new Error(`the poster stopped (exit ${code})`);
    return;
  }
  const made = known.filter((k) => fs.existsSync(path.join(OUT, k, "social.json")));
  const id = typeof args.flags.concept === "string" ? args.flags.concept : nextInQueue(q, known, made);
  if (!id) { console.log("Nothing to make: every concept in docs/gator/queue.json `order` has been made. Add ids to approve more concepts."); return; }
  if (q.state[id]) throw new Error(`${id} is already ${q.state[id].status}`);
  if (made.includes(id)) throw new Error(`${id} has already been made (${path.join(OUT, id)}) — it is not generated and paid for twice. Register it for review instead of making it again.`);
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
