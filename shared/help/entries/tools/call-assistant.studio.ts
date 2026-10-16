import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-call-assistant/studio.tsx, studio/*.tsx and server/voice/profile.ts, prompt-compiler.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.studio", parent: "call-assistant", group: "Tools", route: "/call-assistant/studio", title: "AI Call Assistant → Agent studio",
  whatItIs: "Where you teach the assistant about your business, choose its voice and questions, and publish it.",
  whatItDoes: "The first time, a step-by-step setup covers company, services, service area, credibility, offers, policies, voice, questions and delivery. It saves a draft at every Next, then shows a review and publishes. After that the editor lists every section on the left, plus the prompt preview (the exact instructions your saved draft gives the assistant) and the version history. Save draft keeps your edits without touching the live assistant; Publish makes them live; Pause stops it answering until you Resume.",
  howToUse: [
    "Fill in Company (name as callers should hear it, trade, office phone, hours, time zone) and Services & don’ts.",
    "Tick the counties you work in under Service area and describe the area in your own words.",
    "Pick a voice, name and greeting under Persona, then set the questions it asks under Intake questions.",
    "Set Escalations (who hears about emergencies and callers who want a person) and Lead delivery (CRM, email or text).",
    "Choose Publish, read the list of what changes, and confirm; then open the Simulator and talk to it before you forward a real line.",
  ],
  howItWorks: "The assistant knows only what you type here; it never makes up a rating, license, brand or price, and quotes prices only from ranges you chose to share. Each publish is kept as a numbered version, and Restore copies an old one into the draft without touching the live assistant. It uses the persona’s name, says it is a virtual assistant when asked, and plays the recording notice when your area includes a state that requires it. Your chosen time zone decides when “someone will call you back” means today or tomorrow.",
};
export default entry;
