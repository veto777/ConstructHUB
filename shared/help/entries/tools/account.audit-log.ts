import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/audit-log.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.audit-log", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Audit log",
  whatItIs: "A record of what happened on the account: sign-ins and failed attempts, password and two-factor changes, Google accounts connected or removed, and activity in the tools.",
  whatItDoes: "Lists the most recent 200 events, each with the area, the email involved, the time, the IP address and the device. Filters by area, event and date, a search over event, IP, device and email, and Export CSV for the rows shown.",
  howToUse: [
    "Settings → Audit log.",
    "Narrow the list with Area, Event, Since or the search box.",
    "Choose Export CSV to keep a copy of what is shown.",
  ],
  howItWorks: "Events are written by the server as they happen and read back here; the page never changes them. IP and device describe the request and can reflect a proxy.",
};
export default entry;
