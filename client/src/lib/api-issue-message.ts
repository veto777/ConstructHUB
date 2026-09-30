import { apiErrorMessage } from "@/lib/queryClient";

/**
 * apiErrorMessage, one step further for validation failures: our 400s carry
 * `{ message: "Invalid item", issues: [zod issues] }`, and "Invalid item"
 * alone doesn't say what to fix. This turns the first issue into a sentence
 * ("Name: must be 200 characters or fewer"), using `labels` to map field keys
 * to the words on the form. Anything else falls back to apiErrorMessage.
 */
export function apiIssueMessage(err: any, labels: Record<string, string> = {}, fallback?: string): string {
  const raw: string = typeof err?.message === "string" ? err.message.replace(/^\d{3}:\s*/, "") : "";
  try {
    const issue = JSON.parse(raw)?.issues?.[0];
    if (issue && typeof issue.message === "string") {
      const key = String(issue.path?.[issue.path.length - 1] ?? "");
      const field = labels[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
      return `${field ? `${field}: ` : ""}${issueText(issue)}`;
    }
  } catch { /* not our JSON — fall through */ }
  return apiErrorMessage(err, fallback);
}

function issueText(issue: any): string {
  const isString = issue.type === "string";
  if (issue.code === "too_big") {
    return isString ? `must be ${issue.maximum} characters or fewer` : `must be ${issue.maximum} or less`;
  }
  if (issue.code === "too_small") {
    if (isString) return issue.minimum <= 1 ? "is required" : `must be at least ${issue.minimum} characters`;
    return issue.minimum === 0 ? "can't be negative" : `must be at least ${issue.minimum}`;
  }
  if (issue.code === "invalid_enum_value" && Array.isArray(issue.options)) {
    return `must be one of ${issue.options.join(", ")}`;
  }
  if (issue.code === "invalid_type" && issue.received === "undefined") return "is required";
  return String(issue.message);
}
