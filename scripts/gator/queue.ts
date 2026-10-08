/**
 * The review queue of the gator clips (docs/gator/queue.json, committed) and what each platform gets of a clip.
 * `order` is the posting order; `state` is what became of each clip:
 *   ready-for-review  made, waiting for someone to look
 *   approved          may be scheduled (`by` says who looked: the owner, or the agent when every check passed)
 *   held              not posted as it is — the owner asked for a remake or wants to look himself
 *   rejected          not posted; `why` is kept
 * `post` names, per platform, the file of the clip's folder that platform gets (no entry: the clip does not
 * go there). `caption` is the hook and one more line; the hashtags and the AI note are added per platform.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../tutorials/lib";

export const QUEUE = path.join(ROOT, "docs", "gator", "queue.json");
export type PostPlatform = "instagram" | "tiktok" | "linkedin";
export type QueueState = { status: "ready-for-review" | "approved" | "rejected" | "held"; at: string; by?: string; credits?: number; checks?: string[]; why?: string; caption?: [string, string?]; post?: Partial<Record<PostPlatform, string>>; /** Its file name(s) in the owner's review folder (fileloaded): while none of them is there any more, the clip is not scheduled. */ review?: string[] };
export type Queue = { version: 1; order: string[]; state: Record<string, QueueState> };
export const readQueue = (file = QUEUE): Queue => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1, order: [], state: {} });
export const saveQueue = (q: Queue, file = QUEUE) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(q, null, 2) + "\n"); };

const TAGS: Record<PostPlatform, string[]> = { tiktok: ["contractorlife", "construction", "jobsite", "bluecollar"], instagram: ["contractorlife", "construction", "jobsite", "bluecollar"], linkedin: ["construction", "contractorlife"] };
/**
 * A post's text: the hook, one more line, and the hashtags — "#AIContent" first, on every platform. No
 * claims: nothing about the product beyond its name and address.
 */
export function captionFor(platform: PostPlatform, caption: readonly [string, string?]): string {
  const head = caption.filter(Boolean).join("\n"), tags = ["#AIContent", ...TAGS[platform].map((t) => `#${t}`)].join(" ");
  if (platform === "tiktok") return `${head}\n${tags}`;
  if (platform === "instagram") return `${head}\n\nConstructHUB — run the whole job. Link in bio · constructhub.us\n\nAI-generated. ${tags}`;
  return `${head}\n\nConstructHUB — run the whole job. https://constructhub.us\n\n(This clip is AI-generated.) ${tags}`;
}

/**
 * The owner's review folder is the review surface (2026-10-08: "I delete what I didn't like"): a clip whose
 * file(s) he has removed is not scheduled, whatever the queue says. `listing`: the names in the folder now.
 * Pure (tested).
 */
export function removedFromReview(q: Queue, id: string, listing: readonly string[]): string | null {
  const names = q.state[id]?.review;
  if (!names?.length) return null;
  return names.some((n) => listing.includes(n)) ? null : `${id}: ${names.join(" / ")} is no longer in the owner's review folder — he removed it; not scheduled`;
}
