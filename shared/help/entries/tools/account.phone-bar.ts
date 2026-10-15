import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-tab-bar.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.phone-bar", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Phone tab bar",
  whatItIs: "The bar at the bottom of the screen on your phone and in the ConstructHUB apps. Pick the four tabs you use most.",
  whatItDoes: "Two pickers, one for the ConstructHUB tools and one for the CRM. Each lets you choose four tabs; the last tab (Menu for the tools, More for the CRM) always stays, so every page is still one tap away. A reset puts the default tabs back.",
  howToUse: [
    "Open Settings → Phone tab bar.",
    "Choose the four tabs you want in each picker and save.",
    "Open the site on your phone or in the app: the bar shows your choice.",
  ],
  howItWorks: "The choice is saved on your account, not on the device, so the phone browser and the iPhone apps show the same bar.",
};
export default entry;
