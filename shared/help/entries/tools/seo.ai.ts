import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/ai.tsx, ai-summary.tsx and server/seo/ai-visibility.ts, ai-summary.ts as they run. */
const entry: HelpDraft = {
  key: "seo.ai", parent: "seo", group: "Tools", route: "/seo/ai", title: "SEO Suite → AI visibility",
  whatItIs: "When a customer asks ChatGPT, Google Gemini or Perplexity for what you do, are you named, and is your website one of their sources?",
  whatItDoes: "Ask a question the way a customer would, to any of the three AI assistants with their web search on. Each answer shows whether it named your business, named it first, and which websites it used; answers are kept and summed up month by month. A second box, “Where AI answers already use a website”, checks which searches Google’s AI answers or ChatGPT already use any website for.",
  howToUse: [
    "Pick the site and, the first time, type your business name exactly as on Google; an answer names a business, not a web address.",
    "Type the question a customer would ask (“best siding contractors in Bellingham, WA”), tick the assistants and press Ask. The button shows the usual price, the most it can cost is set aside while it runs, and an answer can take a minute.",
    "Read each assistant’s answer and the sources it used; earlier answers to the same question are kept under it.",
    "Use the narrowing links (newest answers, named the business, used the website, named it first) to list the saved answers that match.",
    "Type a site in “Where AI answers already use a website”, choose the AI and press Check; Look it up buys a fresh list at the price on the button.",
  ],
  howItWorks: "Each assistant asked is a separate lookup with its own price; the amount set aside is the most the run can cost, and what is not used comes back. Whether you were named is matched on the business name you saved, or on your web address written in the answer. A saved answer reopens free, and arriving by link never asks an assistant or buys a lookup.",
};
export default entry;
