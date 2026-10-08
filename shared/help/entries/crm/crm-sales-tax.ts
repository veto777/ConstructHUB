import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Estimate & invoice defaults), crm-estimate-new.tsx and server/crm/tax.ts as they run. */
const entry: HelpDraft = {
  key: "crm-sales-tax", group: "CRM", route: "/crm/settings", title: "Set your default sales tax",
  whatItIs: "The sales tax rate the CRM puts on a new estimate when you have not set a more specific one.",
  whatItDoes: "Default sales tax (%) in Settings → Estimate & invoice defaults is your company-wide rate. A new estimate made after you save it gets that rate, and shows the tax on its own line above the total.",
  howToUse: [
    "CRM → Settings, and scroll to Estimate & invoice defaults.",
    "Type your rate in Default sales tax (%) and choose Save defaults.",
    "Create an estimate: the review step says sales tax is added automatically.",
    "Open the estimate to see the Tax line and the total.",
  ],
  howItWorks: "The CRM does not know any state’s tax rate — it uses the rates you enter. For each new estimate it looks for a city rate on the job’s division, then that division’s default, then this company default; with none set, tax is zero. A tax percent typed on an estimate itself always wins. Check your rates with your accountant.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage company settings."],
};
export default entry;
