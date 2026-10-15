import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/mentions-page.tsx, mentions.tsx and server/seo/mentions.ts, mention-watch.ts as they run. */
const entry: HelpDraft = {
  key: "seo.mentions", parent: "seo", group: "Tools", route: "/seo/mentions", title: "SEO Suite → Mentions",
  whatItIs: "Pages on other websites that use your business's name, and whether they link to you — the ones that do not are sites to ask for a link.",
  whatItDoes: "Looks the web up for your exact business name and sorts what it finds: likely you with no link, likely you, name only (same name — check it is you), links to you, and marked not you. Each mention is read against your places (towns) to tell you from a business with the same name elsewhere. Results export, a mention can go to the Action plan, and a watch repeats the check and alerts you to new mentions.",
  howToUse: [
    "Pick the site and enter the business name exactly as on Google; add your towns so same-name businesses elsewhere are set apart (saving places is free).",
    "Press Look for mentions — the most it can cost is on the button; a check saved for this name opens free.",
    "Work the “Likely you, no link” tab: each is a site already talking about you that you can ask for a link. Add to plan keeps it.",
    "Mark a mention “not you” when it is another business; Check again later for new ones.",
  ],
  howItWorks: "A check is one lookup for pages containing the name, then whether each of those sites links to yours; when the links part does not load it is not charged, and can be asked for again on its own. A saved check reopens free for " + SAVED + ". Arriving by link opens saved data only.",
};
export default entry;
