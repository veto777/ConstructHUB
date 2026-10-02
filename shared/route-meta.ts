/**
 * Per-page <title> and meta description for public marketing pages that need
 * their own (search results and link previews). The server writes them into
 * the HTML it sends for that path (server/static.ts), so crawlers that don't
 * run JavaScript see them; the page sets the same values in the browser.
 *
 * Pages without an entry keep client/index.html's defaults.
 */
export type RouteMeta = { title: string; description: string };

export const ROUTE_META: Readonly<Record<string, RouteMeta>> = {
  "/call-assistant": {
    title: "AI Call Assistant | ConstructHUB",
    description:
      "An AI receptionist for contractors: pick a woman's or man's voice, get a local number in your state, forward the lines you already have, and every call lands in your CRM with a transcript and recording.",
  },
};
