/**
 * Hub (the ConstructHUB corner assistant): the preset questions every visitor
 * can tap. The question text is owned here, on the server side of the wire: the
 * browser sends only `{ presetId }`, so a signed-out visitor can never put
 * their own words in front of the model.
 *
 * `sections` are the knowledge-pack sections (server/data/hub-knowledge.md,
 * "## N." headings) the answer is generated from, on top of the core sections.
 */

export const PRESET_IDS = [
  "pricing", "which-plan", "trial", "features", "get-started", "crm", "agency", "done-for-you",
  "permits", "google-profile", "reviews", "click-fraud", "site-scan", "master-class", "call-assistant", "call-number",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type HubPreset = { id: PresetId; label: string; question: string; sections: number[] };

export const HUB_PRESETS: Record<PresetId, HubPreset> = {
  "pricing": { id: "pricing", label: "How much does it cost?", question: "How much does ConstructHUB cost, and what does each plan include?", sections: [3] },
  "which-plan": { id: "which-plan", label: "Which plan is right for me?", question: "Which ConstructHUB plan is right for my contracting business?", sections: [3] },
  "trial": { id: "trial", label: "Is there a free trial?", question: "Is there a free trial or a free plan, and do I need a card to sign up?", sections: [2, 3] },
  "features": { id: "features", label: "What does ConstructHUB do?", question: "What can ConstructHUB do for my construction business?", sections: [1] },
  "get-started": { id: "get-started", label: "How do I get started?", question: "How do I get started with ConstructHUB, step by step?", sections: [2] },
  "crm": { id: "crm", label: "What's in the CRM?", question: "What does the ConstructHub CRM do, and is it included in my plan?", sections: [24] },
  "agency": { id: "agency", label: "I'm an agency", question: "I run a marketing agency for contractors. What does the Agency plan include and how is it priced?", sections: [22, 3] },
  "done-for-you": { id: "done-for-you", label: "Do it for me / talk to sales", question: "Can ConstructHUB set up my business, website or SEO for me, and how do I talk to a sales rep?", sections: [27] },
  "permits": { id: "permits", label: "Permit search", question: "What permit data does ConstructHUB have and how does permit search work?", sections: [4] },
  "google-profile": { id: "google-profile", label: "Google Business Profile tools", question: "What can ConstructHUB do for my Google Business Profile?", sections: [5, 6, 8] },
  "reviews": { id: "reviews", label: "Getting more Google reviews", question: "How does ConstructHUB help me get more Google reviews and reply to them?", sections: [8] },
  "click-fraud": { id: "click-fraud", label: "Click-fraud protection", question: "How does Click Guard protect my Google Ads from click fraud, and which plans include it?", sections: [15] },
  "site-scan": { id: "site-scan", label: "Free website scan", question: "What does the free website scan check, and what does the full Site Scan add?", sections: [12] },
  "master-class": { id: "master-class", label: "The Master Class", question: "What is the Master Class and what does it cover?", sections: [26] },
  "call-assistant": { id: "call-assistant", label: "What is the AI Call Assistant?", question: "What is the AI Call Assistant, what does it do on a call, and what does it cost?", sections: [30] },
  "call-number": { id: "call-number", label: "How do I get a phone number?", question: "How do I get a phone number for the AI Call Assistant, and can I keep my existing numbers?", sections: [30] },
};

/** The chips shown first; the rest sit behind "More questions". */
export const PRIMARY_PRESETS: readonly PresetId[] = [
  "pricing", "which-plan", "features", "trial", "agency", "crm", "get-started", "done-for-you",
];

/** Chips Gabe offers a brand-new account (the welcome after sign-up). */
export const WELCOME_PRESETS: readonly PresetId[] = ["get-started", "google-profile", "crm", "pricing"];
