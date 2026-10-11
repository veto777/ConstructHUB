/**
 * The shape of a Master Class lesson body as the server hands it out (GET /api/master-class/lessons/:module,
 * server/master-class/routes.ts). Lesson TEXT lives here, under server/, and nowhere in client/ or shared/: the
 * client bundle carries only the public outline (titles, icons) and a renderer for these blocks
 * (client/src/components/master-class/lesson-body.tsx). server/master-class/master-class.test.ts greps the client
 * and shared sources for every paragraph below to keep it that way.
 *
 * Inline markup inside any `text`: **bold** and [label](href). An href that starts with "/" is a page of the
 * platform (rendered as an in-app link); any other href opens in a new tab.
 */

export type Tone = "check" | "warn" | "x" | "tip" | "plain";

/** A bullet: plain text, or text with its own mark (a warning among checks). */
export type ListItem = string | { text: string; tone?: Tone };

export type LessonBlock =
  /** A body paragraph. */
  | { type: "p"; text: string }
  /** A sub-heading inside a lesson. */
  | { type: "h"; text: string }
  /** Bordered boxes side by side, each a titled bullet list ("Setting it up" / "Verification"). */
  | { type: "panels"; cols?: 2 | 3; items: { title: string; tone?: Tone; items: ListItem[] }[] }
  /** Title + one sentence cards (the seven pages of a site, the directories); with `href` the card is a link. */
  | { type: "cards"; cols?: 2 | 3; items: { title: string; text: string; href?: string }[] }
  /** Stacked callouts, each with an optional bold lead ("Insurance & Workers Comp: …"). */
  | { type: "notes"; items: { lead?: string; text: string; tone?: Tone }[] }
  /** The lightbulb box: one or more short paragraphs, an optional title. */
  | { type: "tip"; title?: string; text: string | string[] }
  /** The big warning card ("Critical Warning: Protect Your GSC Access"). */
  | { type: "callout"; tone: "warn" | "ban"; title: string; text: string | string[] }
  /** A bullet list with marks, optionally titled and in two columns. */
  | { type: "list"; title?: string; tone?: Tone; cols?: 1 | 2; items: ListItem[] }
  /** Benchmark figures ("33%+ Great sales"), with an optional note under them. */
  | { type: "stats"; title?: string; items: { value: string; label: string }[]; note?: string }
  /** A numbered ranking (what clients look for in reviews). */
  | { type: "ranked"; items: { title: string; text: string }[] }
  /** A row of small badges. */
  | { type: "tags"; label: string; items: string[] }
  /** An interactive checklist whose ticks the browser keeps (components/guides/progress.ts) under `storageKey`. */
  | { type: "checklist"; storageKey: string; items: { id: string; text: string }[]; unit?: string; resetLabel?: string }
  /** "In ConstructHUB: …" — where the lesson's work is done inside the platform. */
  | { type: "in-app"; text: string };

export type LessonBody = {
  /** The lesson id of the public outline (client LessonMeta.id) and of the #lesson-<id> anchor. */
  id: string;
  title: string;
  blocks: LessonBlock[];
};

export type ModuleLessons = {
  lessons: LessonBody[];
  /** Blocks shown after the last lesson (a module's bottom line). */
  footer?: LessonBlock[];
};

/** Every string a block carries, for the source guard and the outline checks. */
export function blockTexts(block: LessonBlock): string[] {
  const item = (i: ListItem) => (typeof i === "string" ? i : i.text);
  switch (block.type) {
    case "p": case "h": case "in-app": return [block.text];
    case "panels": return block.items.flatMap((p) => [p.title, ...p.items.map(item)]);
    case "cards": return block.items.flatMap((c) => [c.title, c.text]);
    case "notes": return block.items.flatMap((n) => [n.lead ?? "", n.text]);
    case "tip": return [block.title ?? "", ...(Array.isArray(block.text) ? block.text : [block.text])];
    case "callout": return [block.title, ...(Array.isArray(block.text) ? block.text : [block.text])];
    case "list": return [block.title ?? "", ...block.items.map(item)];
    case "stats": return [block.title ?? "", block.note ?? "", ...block.items.flatMap((s) => [s.value, s.label])];
    case "ranked": return block.items.flatMap((r) => [r.title, r.text]);
    case "tags": return [block.label, ...block.items];
    case "checklist": return block.items.map((c) => c.text);
  }
}
