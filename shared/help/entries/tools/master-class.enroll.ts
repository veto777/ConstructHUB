import type { HelpDraft } from "../../types";

/** Written from client/src/pages/master-class.tsx and client/src/components/master-class/enroll.tsx as they run. */
const entry: HelpDraft = {
  key: "master-class.enroll", parent: "master-class", group: "Tools", route: "/master-class", title: "Master Class → Enroll",
  whatItIs: "The Enroll tab: what each module costs, what the bundle saves, and the Add to cart buttons.",
  whatItDoes: "It lists the four modules with their prices and the complete bundle with its price and the saving against buying the modules separately, and shows which ones this account already owns. Add to cart puts a module or the bundle in the cart; checkout runs through the cart. When a price is quoted by a sales rep instead, the tab links to the sales form.",
  howToUse: [
    "Open the Enroll tab, or choose How to enroll on the Overview.",
    "Add a module or the bundle to the cart and check out from the cart icon.",
    "Come back to the module tab: it unlocks once the purchase is recorded.",
  ],
  howItWorks: "Prices come from the course catalog the server serves; the page types none of them. Any Master Class purchase also opens the Vetting contractors lessons and the full Google Ads guide. The iPhone apps sell nothing, so they do not show this page.",
  needs: ["A signed-in account to buy; the Overview and the state guides are free to read."],
};
export default entry;
