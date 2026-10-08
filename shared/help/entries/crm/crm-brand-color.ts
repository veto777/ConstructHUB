import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Company theme) and public-estimate.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-brand-color", group: "CRM", route: "/crm/settings", title: "Pick your brand colour",
  whatItIs: "Company theme in Settings: the accent colour on your estimates, invoices, contracts and client portal, on a black or a white base.",
  whatItDoes: "You click one of twenty colour swatches and choose black or white as the main colour. Each click saves at once, and the preview strip under the swatches shows your company name and the approve button in the new colours.",
  howToUse: [
    "CRM → Settings, and scroll to Company theme under the company profile.",
    "Click a colour swatch. “Theme saved” confirms it.",
    "Beside “Main color”, choose Black or White for the band behind your name.",
    "Open an estimate and choose Preview to see it on a real document.",
  ],
  howItWorks: "There is no Save button: the swatch and the main colour are each saved when you click them, and documents your clients open afterwards use the new colours.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
