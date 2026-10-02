/**
 * Gabe's fixed replies (guardrails §3.4). Every refusal, limit and error the
 * Gabe sends is one of these constants: never model output, never assembled
 * from user input. The only interpolation is R_OWN_DATA's link, which comes
 * from the fixed table in prefilter.ts (always a shared/hub-links.ts entry).
 */
import { SALES_HREF, SALES_REP_LABEL } from "@shared/plan-copy";

export const REPLIES = {
  R_DATA: "I can't look up anyone's account, customers or contact details. I don't have access to any of that, and I wouldn't share it if I did. I can explain how any ConstructHUB feature works or how to set it up. What are you working on?",
  R_INTERNAL: "That's behind the site fence. I can't get into how ConstructHUB is built or run. Ask me about features, plans or setting something up!",
  R_WHOAMI: "I'm Gabe, ConstructHUB's AI helper. I can't share how I'm built, but I know the platform inside out. What can I help you set up?",
  R_INJECTION: "I'm Gabe, and I stick to the blueprint: ConstructHUB features, plans and setup. What can I help you with?",
  R_OFFTOPIC: "That's outside my job site. I only know ConstructHUB. Ask me about features, plans or how to set something up.",
  R_PLAIN: "I can only read plain-English questions. Could you type it out in words?",
  R_LANG: "Right now I can only help in English. (Por ahora solo puedo ayudar en inglés.)",
  R_SALES: `That one's quoted by a sales rep, so I can't give a price. [${SALES_REP_LABEL}](${SALES_HREF}) and they'll put a quote together for you.`,
  R_CRISIS: "I'm just the ConstructHUB helper, but please don't go through this alone. In the US you can call or text 988 any time to reach the Suicide & Crisis Lifeline.",
  R_FALLBACK: "Let me not get that one wrong. I can help with ConstructHUB features, plans and setup. Try one of the questions below, or see [Pricing](/pricing).",
  R_SLOWDOWN: "Whoa, too fast for me! Give me a minute and ask again.",
  R_LIMIT: "You've hit today's chat limit. I'll be back on site tomorrow. The quick questions below still work.",
  R_BUSY: "My radio's crackling, so that took too long. Please try again in a minute. The quick questions below still work.",
  R_TIMEOUT: "My radio's crackling, so that took too long. Please try again in a minute. The quick questions below still work.",
  R_OFFLINE: "Gabe is off site right now. The quick questions below still work, or see [Pricing](/pricing).",
  R_CONVO_CAP: "This chat's getting long. Start a fresh one and I'll pick right back up.",
  R_SIGNIN: "Sign up or log in to ask your own questions. Until then, tap a quick question.",
} as const;

export type ReplyCode = keyof typeof REPLIES | "R_OWN_DATA";

/** R_OWN_DATA with its deterministic link (label and path from the prefilter's fixed table). */
export function ownDataReply(label: string, path: string): string {
  return `I can't see your account. I only know how the platform works. You can check that yourself in [${label}](${path}). Want me to walk you through that page?`;
}

/** The fixed text for a reply code (R_OWN_DATA needs its link). */
export function replyText(code: ReplyCode, link?: { label: string; path: string }): string {
  if (code === "R_OWN_DATA") return ownDataReply(link?.label ?? "Settings", link?.path ?? "/settings");
  return REPLIES[code];
}
