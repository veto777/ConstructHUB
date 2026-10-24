import type { HelpDraft } from "../../types";

/** Written from client/src/pages/my-reputation.tsx and server/reputation/account.ts as they run. */
const entry: HelpDraft = {
  key: "my-reputation", group: "Tools", route: "/my-reputation", title: "Reputation",
  whatItIs: "Your online reputation: what Google shows when someone searches your business or your name, and what you can do about it.",
  whatItDoes: "Checks Google's first two pages and the search suggestions for up to three names, marks each result negative, neutral, positive or yours, and scores the name out of 100. For a negative result on a site with an official removal process it shows the steps and the request form. It lists the main people-search sites with their opt-out pages, re-checks every week and emails you if your results get worse. Talk to the reputation team sends your results to our team for a free plan call.",
  howToUse: [
    "Choose My business or Me, type the name the way people search it (add the city if it is common) and click Check my reputation.",
    "Open How to request removal under any negative result and follow the official steps.",
    "Opt out of the people-search sites in the list, or click Talk to the reputation team to have it done for you.",
  ],
  howItWorks: "Results come from Google (United States) through our search data provider and are labelled automatically, so a label can be wrong. Each account gets a set number of extra checks a month on top of the weekly re-check. Nothing is sent to any website for you unless you ask our team to do it.",
  needs: ["A ConstructHUB account."],
};
export default entry;
