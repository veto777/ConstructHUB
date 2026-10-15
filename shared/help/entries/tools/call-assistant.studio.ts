import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-call-assistant/studio.tsx, studio/*.tsx and server/voice/profile.ts, prompt-compiler.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.studio", parent: "call-assistant", group: "Tools", route: "/call-assistant/studio", title: "AI Call Assistant → Agent studio",
  whatItIs: "Where you teach the assistant about your business, choose its voice and questions, and publish it.",
  whatItDoes: "The first time, a setup wizard walks you through company, services and don’ts, service area, credibility, offers, policies, persona, questions and delivery, saving a draft at every Next, then shows a review and publishes. After that the editor lists every section on the left, plus the prompt preview (the exact instructions your saved draft gives the assistant) and the version history. Save draft keeps your edits without touching the live assistant; Publish makes them live; Pause stops it answering until you Resume.",
  howToUse: [
    "Fill in Company (the name as a caller should hear it, your trade in one line, office phone, hours and time zone) and Services & don’ts (what you sell, and what the assistant should politely decline and suggest instead).",
    "Tick the counties you work in under Service area (a region shortcut adds a whole stretch at once) and say in your own words what area the assistant may name; Credibility, Offers and Policies hold only what you type.",
    "Pick a voice under Persona, give it a name and a greeting, and turn on the recording notice; under Intake questions, set the questions it asks in order, each with a required switch and what the answer should look like.",
    "Set Escalations and Lead delivery: who is texted or emailed for emergencies, existing customers and callers who want a person, and whether every lead goes to the CRM, email or text.",
    "Choose Publish, read the list of what changes, and confirm; then open the Simulator and talk to it before you forward a real line.",
  ],
  howItWorks: "The assistant knows only what you type here: it never invents a rating, a license, a brand or a price, and quotes prices only when you choose to read typed ranges. Publishing turns the saved draft into a numbered version; every version is kept, and Restore copies an old one back into the draft without changing the live assistant until you publish again. The assistant introduces itself by the persona’s name, says it is a virtual assistant when asked, and plays the recording notice when your service area includes a state that requires it. Your chosen time zone decides when “someone will call you back” means today or tomorrow.",
};
export default entry;
