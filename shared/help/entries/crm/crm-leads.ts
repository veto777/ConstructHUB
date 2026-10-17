import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-leads.tsx and server/crm/leads.ts as they run. */
const entry: HelpDraft = {
  key: "crm-leads", group: "CRM", route: "/crm/leads", title: "Leads",
  whatItIs: "One list of every request for work, wherever it came from.",
  whatItDoes: "Leads from the forms on your own website, the ConstructHUB form and the Call Assistant land on one page. Each one shows who sent it, how to reach them, what they asked for and where it came from. A lead from someone who is already your client shows that client.",
  howToUse: [
    "Open Leads in the CRM.",
    "Under Connect your lead sources, copy the script and paste it on your website, on the page with your form, right before </body>.",
    "Send a test from your form. It shows up under New.",
    "Mark a lead Contacted when you have called them, or choose Convert to client to add them to Clients (and the pipeline if you like).",
  ],
  howItWorks: "The script copies what people type into your form and sends it here; your form keeps working as before. Passwords, card numbers and captcha fields are never sent. The same person sending the same message twice within ten minutes counts once. A lead with no email and no phone goes to Spam.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "The “Manage clients” permission. Copying the script needs “Manage integrations”."],
};
export default entry;
