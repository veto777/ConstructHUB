import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/mentions-page.tsx, mentions.tsx and server/seo/mentions.ts, mention-watch.ts as they run. */
const entry: HelpDraft = {
  key: "seo.mentions", parent: "seo", group: "Tools", route: "/seo/mentions", title: "SEO Suite → Mentions",
  whatItIs: "Pages on other websites that use your business’s name, and whether they link to you. The ones that do not are sites to ask for a link.",
  whatItDoes: "It searches the web for your exact business name and sorts what it finds. The groups are likely you with no link, likely you, name only (same name, so check it is you), links to you, and marked not you. Each mention is read against your places (towns) to tell you from a business with the same name elsewhere. Results export, a mention can go to the Action plan, and a monthly watch (off until you turn it on, using included data only) looks for pages published since its last check. It alerts you to new ones that are likely you and do not link to you yet.",
  howToUse: [
    "Pick the site and type the business name exactly as on Google; add your towns so same-name businesses elsewhere are set apart (saving places is free).",
    "Press Look for mentions; the most it can cost is on the button, and a check saved for this name opens free.",
    "Work the “Likely you, no link” tab: each is a site already talking about you that you can ask for a link, and Plan adds it to the Action plan.",
    "Press Not us on a mention that is another business (This is us confirms one), and Check again later for new ones.",
  ],
  howItWorks: "A check is one lookup for pages with the name, then whether each of those sites links to yours. If the links part does not load, it is not charged and can be asked for again on its own. A saved check reopens free for " + SAVED + ". Arriving by link opens saved data only.",
};
export default entry;
