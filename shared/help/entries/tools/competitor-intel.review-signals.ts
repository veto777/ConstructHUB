import type { HelpDraft } from "../../types";

/** Written from client/src/pages/competitors.tsx and server/competitor-analysis.ts as they run. */
const entry: HelpDraft = {
  key: "competitor-intel.review-signals", parent: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel → Review signals",
  whatItIs: "The one-line signal under each listing, its Few / Some / More band, and the Review analysis panel behind it.",
  whatItDoes: "Each business gets a score from 0 to 100 for things worth a closer look, from its name, rating, review count and address and from a sample of its reviews. It is shown as a band: Few signals below 30, Some signals from 30 to 59, More signals from 60 up. The line under the listing gives the band, the score and the first reason found, such as a perfect 5.0 rating across more than 20 reviews. Review analysis opens the sample: how many reviews gave 4 or 5 stars (good) or 1 or 2 stars (bad), repeat common phrases or say nothing specific (those are quoted). It also shows how many reviewers have photos, ordinary-looking names and profile links, and the oldest review in the sample.",
  howToUse: [
    "Read the signal line under a listing first: the band and the score, then the reason.",
    "Choose Review analysis to open the sampled reviews, or Hide review analysis to close it.",
    "Treat a high score as a prompt to read the reviews yourself on Google, never as a verdict.",
  ],
  howItWorks: "The scanner reads the handful of reviews Google returns for a listing, so every figure in Review analysis is about that sample, not the business’s whole review history. Signals are counted, never judged: the page says “common phrases” and “generic”, not who wrote a review or why. Review pace is not guessed from lifetime counts, and older scans that stored stronger wording are reworded when they are read. A business that stays in the Few or Some band can be named a leader; one in the More band cannot.",
  needs: ["A scan whose listings came with review samples; a listing without any shows “No review data available for deep analysis”."],
};
export default entry;
