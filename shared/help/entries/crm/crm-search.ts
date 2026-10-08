import type { HelpDraft } from "../../types";

/** Written from client/src/components/crm-sidebar.tsx, crm-ui.tsx and help-button.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-search", group: "CRM", route: "/crm", title: "Getting around the CRM",
  whatItIs: "The handful of controls that are on every CRM page: the menu, the “i” beside a title, the Watch button and dark mode.",
  whatItDoes: "The menu on the left reaches every part of the CRM and folds down to icons. The “i” beside a page title explains what the page is for. Where a page has a walkthrough video, Watch plays it. The moon at the bottom of the menu switches between light and dark.",
  howToUse: [
    "Use the button at the top left of the page to fold the menu to icons, and again to open it.",
    "Click the “i” beside a page title to read what the page is for.",
    "Click Watch, where a page has one, to play its walkthrough.",
    "Click the moon at the bottom of the menu for dark mode.",
  ],
  howItWorks: "Tutorials, near the bottom of the menu, opens the list of every walkthrough. Your name at the bottom of the menu opens your profile.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
