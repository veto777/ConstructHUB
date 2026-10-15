import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/usage.tsx, shell.tsx and server/seo/usage.ts, credits.ts as they run. */
const entry: HelpDraft = {
  key: "seo.usage", parent: "seo", group: "Tools", route: "/seo/usage", title: "SEO Suite → Usage & credit",
  whatItIs: "Where your SEO data went: every lookup, what it was and what it cost, with the month's totals and the credit you bought.",
  whatItDoes: "Tiles for this month's use, the included data left and your purchased credit; a list of the latest lookups — a Site explorer report, a rank check, a keyword lookup, a backlink refresh, a grid scan — each a link to the page that spent it, marked charged, no charge or still running; monthly totals; and a CSV export. Add credit opens the purchase panel.",
  howToUse: [
    "Open a row to see what was bought and where.",
    "Narrow to one month with a month link; the totals below count every lookup, including older ones the list no longer shows.",
    "Choose Add credit to buy prepaid credit: it is used only after the month's included data, and it does not expire.",
    "Export the list for your records.",
  ],
  howItWorks: "Free to open. A running lookup shows the amount set aside until it settles, and what is not used comes back. Included data resets on the 1st; purchased credit is paid by card through Stripe with an emailed receipt. The iPhone app shows the balance but sells nothing.",
};
export default entry;
