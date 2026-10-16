import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/competitors.tsx and server/seo/gap.ts, routes.ts as they run. */
const entry: HelpDraft = {
  key: "seo.competitors", parent: "seo", group: "Tools", route: "/seo/competitors", title: "SEO Suite → Competitor gap",
  whatItIs: "The keywords a competitor ranks for on Google that your site does not: the gap to close.",
  whatItDoes: "One comparison returns up to 100 keywords the competitor ranks for in Google’s organic (unpaid) results and your site does not, with the competitor’s position and the keyword’s volume. Each row opens the keyword in Keywords explorer or the competitor in Site explorer, and keywords can be tracked on your site.",
  howToUse: [
    "Pick your site in the bar; the gap is measured against it.",
    "Type the competitor’s website and press Find the gap; the price is on the page, and nothing is bought until you press.",
    "Open a keyword to research it, or track the ones worth going after.",
  ],
  howItWorks: "The comparison is one paid lookup against the keyword database, in the country your site is tracked in; its price is shown before it runs. The rank tracker’s own “Competitors on your keywords” panel is a different thing (share of voice on the keywords you already track) and it spends nothing.",
};
export default entry;
