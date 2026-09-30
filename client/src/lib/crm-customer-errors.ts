import { apiErrorMessage } from "@/lib/queryClient";

/**
 * Client create/edit errors → one readable sentence. apiRequest errors read
 * "STATUS: <body>"; the customer routes answer 400 with zod `issues[]` and
 * 409 with duplicate `matches[]`. A toast must never show that raw JSON (or
 * the API's developer hint about ?force=1).
 */

const FIELD_LABEL: Record<string, string> = {
  displayName: "Name",
  firstName: "First name",
  lastName: "Last name",
  companyName: "Company",
  email: "Email",
  phone: "Phone",
  altPhone: "Other phone",
  addressLine1: "Address",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  postalCode: "ZIP",
  notes: "Notes",
  tags: "Tags",
};

/** Loose client-side check — the server's zod email() stays the authority. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DuplicateMatch {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

function parseApiError(err: any): { status: number | null; body: any } {
  const raw: string = typeof err?.message === "string" ? err.message : String(err ?? "");
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!m) return { status: null, body: null };
  try {
    return { status: Number(m[1]), body: JSON.parse(m[2]) };
  } catch {
    return { status: Number(m[1]), body: null };
  }
}

/** The existing clients a 409 duplicate refusal named, or null for any other error. */
export function duplicateMatches(err: any): DuplicateMatch[] | null {
  const { status, body } = parseApiError(err);
  if (status !== 409 || !Array.isArray(body?.matches) || !body.matches.length) return null;
  return body.matches as DuplicateMatch[];
}

/** First validation issue as a field-specific sentence; otherwise the API's own message. */
export function customerErrorMessage(err: any): string {
  const { body } = parseApiError(err);
  const issue = Array.isArray(body?.issues) ? body.issues[0] : null;
  if (issue) {
    const field = String(issue.path?.[0] ?? "");
    const label = FIELD_LABEL[field] ?? "One of the fields";
    if (field === "email" && (issue.validation === "email" || issue.code === "invalid_string")) {
      return "Enter a valid email address.";
    }
    if (issue.code === "too_big" && issue.type === "string" && typeof issue.maximum === "number") {
      return `${label} must be ${issue.maximum} characters or fewer.`;
    }
    if (issue.code === "too_small" && issue.type === "string") return `${label} is required.`;
    return `${label}: ${String(issue.message ?? "is not valid").toLowerCase()}.`;
  }
  return apiErrorMessage(err);
}
