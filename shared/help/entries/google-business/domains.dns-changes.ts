import type { HelpDraft } from "../../types";

/** Written from client/src/pages/domains.tsx, client/src/components/domains/dns-diff.tsx and server/domains/routes.ts (/preview, /confirm, /rollback-preview, /jobs) as they run. */
const entry: HelpDraft = {
  key: "domains.dns-changes", parent: "domains", group: "Google Business", route: "/domains", title: "Domains → Previews and change history",
  whatItIs: "Every DNS change for your domains, shown as a preview you confirm first and a history you can roll back. DNS is the set of records that point a domain at its website and email.",
  whatItDoes: "A change (new nameservers, or a record to create, update or delete) is first built as a preview per domain, showing the records before and after. Nothing reaches the registrar until you tick a finished preview and choose “Review and confirm selected previews”. An applied change is checked against public DNS until it agrees, then marked verified. “Preview rollback of selected changes” builds the opposite change, to confirm the same way.",
  howToUse: [
    "Select one or more domains in the list; with exactly one selected you can pick a current record to update or delete.",
    "Fill in the nameservers, or the record type, name, value and TTL, and choose Preview nameservers or Preview DNS change.",
    "Open the preview under “Previews and change history” and check the before and after.",
    "Tick it, choose “Review and confirm selected previews”, read the summary, confirm it's you and apply.",
    "Tick an applied change and choose “Preview rollback of selected changes” to undo it the same way.",
  ],
  howItWorks: "Previews and changes run in the background; while that is switched off they wait and the page says so. A preview for an update or delete carries the registrar's own record id, so the exact record changes even when others share its name and type. Domains you typed in cannot be changed here. When a domain's DNS is on Cloudflare, only its nameservers can be changed here; change its records in Cloudflare. A change that failed its check or is uncertain can still be rolled back.",
};
export default entry;
