import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-reputation.tsx and server/reputation/routes.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-reputation", group: "Tools", route: "/admin/reputation", title: "Reputation Desk (admin)",
  whatItIs: "A page for the people who run ConstructHUB: reputation restoration for people and businesses — the leads from the free scan on /reputation and the client cases we work.",
  whatItDoes: "Tiles count new leads, active cases, open negative results with requests out and resolved, and people-search listings. Leads lists every free scan with its score; from a lead you open a case or make a proposal offer. A case reads Google's first two pages and autocomplete for each of its search terms, labels each result, and tracks positions over time. Its tabs hold removals (the request drafted from the official route, then recorded as sent and re-checked), the owned assets that push results down, autocomplete, people-search opt-outs, Wikipedia and links to the review, listing and marketing tools.",
  howToUse: [
    "Open a lead from Leads, or click New case and type the name as people search it.",
    "Click Check Google now, then open each negative result and choose Push down or Remove.",
    "For a removal, pick the route, draft the request, send it through the official form and mark it sent; run the people-search check on the People-search tab.",
  ],
  howItWorks: "Search results and predictions come from Google through our search data provider; each active case is re-checked automatically every few days (set per case). Results are labelled automatically and can be corrected by hand. Requests are drafted for review and are never sent by the page itself. The server refuses anyone who is not a platform admin.",
  needs: ["Platform admin access.", "The search data (DataForSEO) login on the server."],
};
export default entry;
