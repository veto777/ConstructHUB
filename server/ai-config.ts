/**
 * One place that names the AI model. Every AI feature talks to an OpenAI-compatible
 * chat-completions endpoint (AI_INTEGRATIONS_OPENAI_BASE_URL + _API_KEY), so the
 * provider is swapped by env alone: OpenAI, or any compatible server.
 *
 *   AI_MODEL         text model for every feature (default gpt-4o-mini)
 *   AI_VISION_MODEL  model for features that read photos (default AI_MODEL)
 *   <FEATURE>_AI_MODEL still overrides one feature (SOCIAL_, SITESCAN_, GBP_CONTENT_).
 */
export function aiModel(override?: string | null): string {
  return override || process.env.AI_MODEL || "gpt-4o-mini";
}

export function aiVisionModel(override?: string | null): string {
  return override || process.env.AI_VISION_MODEL || aiModel();
}
