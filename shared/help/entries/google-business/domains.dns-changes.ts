import type { HelpDraft } from "../../types";

/** Written from client/src/pages/domains.tsx, client/src/components/domains/dns-diff.tsx and server/domains/routes.ts (/preview, /confirm, /rollback-preview, /jobs) as they run. */
const entry: HelpDraft = {
  key: "domains.dns-changes", parent: "domains", group: "Google Business", route: "/domains", title: "Domains → Previews and change history",
  whatItIs: "Every DNS change for your domains, as a preview you confirm first and a history you can roll back.",
  whatItDoes: "A change (new nameservers, or a DNS record to create, update or delete) is first built as a preview for each selected domain, showing the records before and after. Tick a finished preview and choose “Review and confirm selected previews” to apply it; nothing reaches the registrar before that. Applied changes are checked against public DNS until it agrees, then marked verified. “Preview rollback of selected changes” builds the opposite change for an applied one, to confirm the same way. The list also shows registrar imports and DNS checks, newest first.",
  howToUse: [
    "Select one or more domains in the inventory. With exactly one selected you can pick one of its current records for an update or delete.",
    "Fill in the nameservers, or the record type, name, value and TTL, and choose Preview.",
    "Under “Previews and change history”, open the preview, check the before and after, tick it and choose “Review and confirm selected previews”.",
    "Read the summary, tick the acknowledgement if the change touches MX, TXT, CNAME or nameservers, confirm it’s you and apply.",
    "To undo an applied change, tick it and choose “Preview rollback of selected changes”, then confirm that preview.",
  ],
  howItWorks: "Previews and applies run in the background worker; with the worker off they wait in the queue and the page says so. A preview for an update or delete carries the registrar’s own record id, so the exact record changes even when others share its name and type. Manually added domains and Cloudflare-hosted zones cannot be changed here — those are changed at the registrar or in Cloudflare. A verified change had its new values seen in public DNS; one marked uncertain or failed verification can still be rolled back.",
};
export default entry;
