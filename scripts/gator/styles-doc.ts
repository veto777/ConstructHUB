/**
 * Write docs/gator/STYLES.md from styles.ts — the styles experiment: definitions, recipes, costs, the posting
 * plan.   npx tsx scripts/gator/styles-doc.ts [--check]
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../tutorials/lib";
import { STYLES, type Style } from "./styles";

export const DOC = path.join(ROOT, "docs", "gator", "STYLES.md");
/** Day d (1-based): noon = style d, evening = the style seven places on — so a style's two clips are on different days and dayparts. */
export function schedule(styles: readonly Style[]): { day: number; noon: number; evening: number }[] {
  const n = styles.length;
  return styles.map((s, i) => ({ day: i + 1, noon: s.id, evening: styles[(i + Math.floor(n / 2)) % n].id }));
}
const usd = (credits: number) => `$${(credits * 0.0625).toFixed(2)}`;

export function stylesMd(): string {
  const total = STYLES.reduce((n, s) => n + 2 * s.creditsPerClip, 0), plan = schedule(STYLES);
  return `# Gator shorts — the styles experiment

<!-- Written by scripts/gator/styles-doc.ts from scripts/gator/styles.ts. Edit the data, then run the script. -->

The owner, 2026-10-08: *"We can try 10-12 dozen styles and whatever does well will use it."* So: a set of
distinct styles, two clips each (a style is not judged on one joke), every post carrying its style number,
and a scoreboard that says which to double down on (\`scripts/gator/scoreboard.ts\` → \`SCOREBOARD.md\`).
There are ${STYLES.length}: the twelve first planned, and three the owner added from reference clips the same day (13–15).

**The same limits in every style:** harm is cartoon or absurd and he is fine afterwards; no realistic person
is hurt; nothing that reads as a real accident, an animal attack or cruelty; no real people, brands, leagues
or other creators' characters; nothing presented as safety advice; AI-generated label on every platform and
#AIContent in the caption. Nothing is posted before a person has looked at it (\`daily.ts --approve\`).

## The styles

| # | Style | What it is | Recipe | Model | About per clip | Example | LinkedIn | Made so far |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${STYLES.map((s) => `| ${s.id} | **${s.name}** | ${s.definition} | ${s.recipe} | ${s.model} | ${s.creditsPerClip} credits (${usd(s.creditsPerClip)}) | ${s.example} | ${s.linkedin ? "yes" : "no"} | ${s.clips.length ? s.clips.map((c) => `\`${c}\``).join(", ") : "—"} |`).join("\n")}

**Cost up front:** two clips of every style ≈ ${total} credits (${usd(total)}) at one take each; the talking styles
(1, 2, 12, 13) are budgeted at two takes. The cap for the whole experiment, pilot aside, is $100.00 and is
enforced in code (\`higgsfield.ts\`): at these prices all ${STYLES.length * 2} clips fit with room for retakes.

## The look of each family

- **Live-action (1, 3, 4, 5, 7, 8, 9, 10, 12–15):** a photoreal alligator in the brand's hard hat, shades and
  vest; one model sheet (\`analysis/gator-shorts/_live/\`) is the reference for every still, so it is the same
  animal. ONE continuous take; **the "pure" cut carries nothing burned in** — no meme text, no logo, no end tag
  (the formula of the owner's reference clips). A "captioned" cut is rendered beside it (small subtitles of
  what is heard, or one short caption) for comparison and for muted feeds.
- **Cartoon (2, 6, 11):** the brand mascot from his own artwork; meme captions; the end tag.
- **Edits that cost nothing:** the instant replay (\`replay.ts\`), the CCTV overlay, the goat cutaway (the goat
  is generated once and reused).

## Posting plan for the test

The accounts are days old and have already pushed back once (2026-10-08: Instagram "restricted", LinkedIn
"share limit"). The shared rate rule (\`scripts/tutorials/social-rate.ts\`) holds for both streams together:
LinkedIn ≤ 3 posts per rolling 24 h until the profile is verified, Instagram ≤ 4 per 24 h for two weeks;
TikTok is kept to 6 a day by hand; YouTube is limited by the channel's own daily upload cap (the tutorials
use three).

- **TikTok and Instagram: two gator clips a day**, about 12:00 and 19:00 Eastern (minutes varied).
- **LinkedIn: one a weekday**, only the styles marked "yes".
- **YouTube Shorts: one a day** (the noon clip) when the upload cap allows.
- Each style's two clips land on **different days and different dayparts**:

| Day | ~12:00 Eastern | ~19:00 Eastern |
| --- | --- | --- |
${plan.map((d) => `| ${d.day} | style ${d.noon} — ${STYLES.find((s) => s.id === d.noon)!.name} | style ${d.evening} — ${STYLES.find((s) => s.id === d.evening)!.name} |`).join("\n")}

Each clip goes through the review folder first: \`daily.ts --approve <id>\` queues it; nothing is queued by itself.

## Measuring

\`scoreboard.ts\` takes one reading per post at +2 h, +24 h and +72 h. YouTube comes from the API (views, likes,
comments, average view duration). **Blotato's API has no analytics endpoint**, so Instagram, TikTok and LinkedIn
counts are typed into \`docs/gator/metrics-manual.csv\` from each app's insights — the tool prints exactly which
rows it is waiting for. Clips are ranked within a platform by views and by engagement rate
((likes + comments + shares) / views); a style's score is the mean of its clips' ranks. The recommendation
("double down on X and Y, drop Z") appears only when every style has both clips at +72 h.
`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const md = stylesMd();
  if (process.argv.includes("--check")) { if (!fs.existsSync(DOC) || fs.readFileSync(DOC, "utf8") !== md) { console.error("docs/gator/STYLES.md is stale — run scripts/gator/styles-doc.ts"); process.exit(1); } console.log("docs/gator/STYLES.md is up to date"); }
  else { fs.writeFileSync(DOC, md); console.log(`docs/gator/STYLES.md  ${STYLES.length} styles`); }
}
