/**
 * Where a video's description is built FROM: the step script, the help entry, the production's
 * youtube.json, the ledger and the learning order — gathered from a checkout and, for videos that
 * are produced in another worktree and not merged yet, from that worktree.
 *
 * The builder itself (./description.ts) is pure; everything that reads a file is here. Nothing here
 * writes anything or talks to anyone.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDescription, relatedFor, type BuiltDescription, type DescriptionEntry, type DescriptionInput, type DescriptionStep } from "./description";

export type DescribeContext = {
  /** The checkout the tool runs from. */
  root: string;
  /** Every checkout to look in for a step script or a help entry, `root` first. */
  worktrees: string[];
  /** Where productions are (<dir>/<helpKey>/youtube.json …). */
  outDirs: string[];
  tracks: { name: string; keys: string[] }[];
  /** The ledger's videos: titles, and the watch links of the ones that are public. */
  ledger: { helpKey: string; title: string; url: string | null; status: string }[];
  /** The help registry of `root` (shared/help/registry.ts `helpEntry`). */
  entryOf: (helpKey: string) => DescriptionEntry | undefined;
};

/** `root` and every sibling checkout of the same project (ConstructHUB, ConstructHUB-seo, ConstructHUB-vid-a …). */
export function siblingWorktrees(root: string): string[] {
  const parent = path.dirname(root);
  const others = fs.readdirSync(parent).filter((n) => n.startsWith("ConstructHUB")).map((n) => path.join(parent, n))
    .filter((d) => d !== root && fs.existsSync(path.join(d, "docs", "tutorials", "scripts"))).sort();
  return [root, ...others];
}

const readJson = (file: string): any => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const scriptFile = (wt: string, helpKey: string) => path.join(wt, "docs", "tutorials", "scripts", `${helpKey}.json`);
/** The checkout an out-dir belongs to (<checkout>/analysis/video-out). */
const worktreeOfOutDir = (dir: string) => path.resolve(dir, "..", "..");

/** "| A4 | `crm-client-new` | Add a client | …" rows of docs/tutorials/CRM-VIDEO-PLAN.md: the planned title of every key. */
export function planTitles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const file = path.join(root, "docs", "tutorials", "CRM-VIDEO-PLAN.md");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\|[^|]*\|\s*`([a-z0-9.-]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m && !out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/** A help entry that is written in another worktree and not merged here yet (shared/help/entries/<group>/<key>.ts). */
async function siblingEntry(helpKey: string, worktrees: readonly string[]): Promise<DescriptionEntry | undefined> {
  for (const wt of worktrees) {
    const base = path.join(wt, "shared", "help", "entries");
    if (!fs.existsSync(base)) continue;
    for (const group of fs.readdirSync(base)) {
      const file = path.join(base, group, `${helpKey}.ts`);
      if (!fs.existsSync(file)) continue;
      try {
        const e = (await import(/* @vite-ignore */ pathToFileURL(file).href))?.default;
        if (e?.key === helpKey && typeof e.whatItIs === "string" && Array.isArray(e.howToUse)) return e as DescriptionEntry;
      } catch { /* an entry that cannot be loaded from here is the same as none: the description says so */ }
    }
  }
  return undefined;
}

export type Described = BuiltDescription & { input: DescriptionInput; scriptFile: string | null; outDir: string | null };

/**
 * Build the description of one video. `dir` is its production folder when the caller already knows
 * it (the scheduler's candidate); otherwise the out-dirs are searched. Returns null when there is
 * neither a step script nor a narration to build from.
 */
export async function describeVideo(helpKey: string, ctx: DescribeContext, known: { dir?: string | null; meta?: Record<string, any> | null; title?: string | null } = {}): Promise<Described | null> {
  const dir = known.dir ?? ctx.outDirs.map((d) => path.join(d, helpKey)).filter((d) => fs.existsSync(path.join(d, "youtube.json")) || fs.existsSync(path.join(d, "narration.json")))
    .sort((a, b) => Number(fs.existsSync(path.join(b, "youtube.json"))) - Number(fs.existsSync(path.join(a, "youtube.json"))))[0] ?? null;
  const meta = known.meta ?? (dir ? readJson(path.join(dir, "youtube.json")) : null);
  // The script: this checkout's, else the one beside the production, else any sibling's.
  const places = [ctx.root, ...(dir ? [worktreeOfOutDir(path.dirname(dir))] : []), ...ctx.worktrees].filter((w, i, all) => all.indexOf(w) === i);
  const found = places.map((w) => scriptFile(w, helpKey)).find((f) => fs.existsSync(f)) ?? null;
  const script = found ? readJson(found) : null;

  let steps: DescriptionStep[] = Array.isArray(script?.steps) ? script.steps.map((s: any) => ({ caption: String(s.caption ?? ""), narration: String(s.narration ?? ""), chapter: typeof s.chapter === "string" ? s.chapter : undefined })) : [];
  if (!steps.length && dir) {
    // No script anywhere: what was really spoken, and the step names the recorder logged.
    const clips = readJson(path.join(dir, "narration.json"))?.clips, timed = readJson(path.join(dir, "timings.json"))?.steps;
    if (Array.isArray(clips)) steps = clips.map((c: any) => ({ caption: String(timed?.find((t: any) => t.index === c.index)?.caption ?? ""), narration: String(c.text ?? "") }));
  }
  if (!steps.length) return null;

  const entry = ctx.entryOf(helpKey) ?? await siblingEntry(helpKey, places);
  const inLedger = ctx.ledger.find((e) => e.helpKey === helpKey);
  const y = script?.youtube ?? null;
  const plan = planTitles(ctx.root);
  const titleOf = (k: string): string | null => {
    const l = ctx.ledger.find((e) => e.helpKey === k)?.title;
    if (l) return l;
    for (const w of ctx.worktrees) { const t = readJson(scriptFile(w, k))?.youtube?.title; if (typeof t === "string") return t; }
    return plan.get(k) ?? null;
  };
  const urlOf = (k: string) => { const e = ctx.ledger.find((x) => x.helpKey === k); return e?.status === "published" ? e.url : null; };
  const title = known.title ?? (typeof meta?.title === "string" && meta.title.trim() ? meta.title : null) ?? y?.title ?? inLedger?.title ?? entry?.title ?? script?.title ?? helpKey;
  const input: DescriptionInput = {
    helpKey, title, summary: typeof y?.description === "string" ? y.description : null, entry: entry ?? null, steps,
    chapters: Array.isArray(meta?.chapters) ? meta.chapters.filter((c: any) => typeof c?.at === "string" && typeof c?.title === "string") : null,
    durationSec: typeof meta?.video?.durationSec === "number" ? meta.video.durationSec : null,
    tags: Array.isArray(meta?.tags) ? meta.tags.map(String) : Array.isArray(y?.tags) ? y.tags.map(String) : null,
    playlist: typeof meta?.playlist === "string" ? meta.playlist : typeof y?.playlist === "string" ? y.playlist : null,
    track: ctx.tracks.find((t) => t.keys.includes(helpKey))?.name ?? null,
    related: relatedFor(helpKey, ctx.tracks, titleOf, urlOf),
    sources: Array.isArray(y?.sources) ? y.sources.filter((x: any) => typeof x?.label === "string" && typeof x?.url === "string" && typeof x?.read === "string") : null,
    names: Array.isArray(y?.names) ? y.names.map(String) : null,
  };
  return { ...buildDescription(input), input, scriptFile: found, outDir: dir };
}

/** Every help key that has a step script in one of the worktrees (the first worktree that has it wins). */
export function scriptKeys(worktrees: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const w of worktrees) {
    const d = path.join(w, "docs", "tutorials", "scripts");
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".json")) keys.add(f.slice(0, -5));
  }
  return [...keys].sort();
}
