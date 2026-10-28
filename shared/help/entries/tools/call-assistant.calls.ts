import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-call-assistant/calls.tsx, calls-detail.tsx and server/voice/calls.ts, spam.ts, escalations.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.calls", parent: "call-assistant", group: "Tools", route: "/call-assistant/calls", title: "Call Assistant → Calls",
  whatItIs: "Every call your assistant answered, with what happened on it: the outcome, a summary, the transcript and the recording.",
  whatItDoes: "There are three views. Calls lists each call with its number, time, caller, outcome, topic and length; open one for the summary, details collected, transcript, recording, and the client or project it became. Spam blocked shows this month’s spam count, the numbers being watched or blocked (with Block and Unblock), and the spam calls themselves. Escalations lists the texts and emails sent to your team when a caller needed a person, and whether anyone replied.",
  howToUse: [
    "Search by name, number or words, or filter by outcome; the list refreshes itself every 30 seconds while the page is open, and Refresh does it now.",
    "Click a call to open it: play the recording, read the transcript, and follow the link to the client it created in the CRM.",
    "Use Unblock under Spam blocked on a number the assistant got wrong, or type a number and Block it yourself; only members who manage settings can block or unblock.",
    "Switch on Show closed under Escalations to see the hand-offs that were already answered.",
    "Click a tile on the Results card to jump straight to one kind of call.",
  ],
  howItWorks: "Calls the assistant flags as spam, such as telemarketers and robocalls, never create a lead and never notify anyone. With “always” forwarding they never reach you; with no-answer or after-hours forwarding they still ring your phone first. A number caught twice as near-certain spam is blocked before its next call and costs no minutes, and spam and blocked calls stay out of the Calls list (so a gap in the call numbers is a screened call). Real callers become leads in your CRM, and urgent calls go to the person in your escalation rules, with reminders until they reply or click Got it in the email. A weekly email tells you how many spam calls were stopped.",
};
export default entry;
