import type { HelpDraft } from "../../types";

/** Written from client/src/pages/master-class.tsx and client/src/components/master-class/enroll.tsx as they run. */
const entry: HelpDraft = {
  key: "master-class.enroll", parent: "master-class", group: "Tools", route: "/master-class", title: "Master Class → Enroll",
  whatItIs: "The Enroll tab: what each module costs, what the bundle saves, and the Add to cart buttons.",
  whatItDoes: "It lists the four modules and the complete bundle with their prices, and what the bundle saves over buying modules one by one. It also shows which ones you already own. Add to cart puts a module or the bundle in the cart to check out later; Buy now goes straight to checkout. When a price is quoted by a sales rep instead, the tab links to the sales form.",
  howToUse: [
    "Open the Enroll tab, or choose How to enroll on the Overview.",
    "Add a module or the bundle to the cart.",
    "Check out from the cart icon.",
    "Open the module tab; it unlocks once the purchase is recorded.",
  ],
  howItWorks: "Prices come from the course catalog, never typed on the page. Any Master Class purchase also opens the Vetting contractors lessons and the full Google Ads guide. The iPhone apps sell nothing, so they do not show this page.",
  needs: ["A signed-in account to buy; the Overview and each state's key facts are free to read."],
};
export default entry;
