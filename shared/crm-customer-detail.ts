/**
 * The shape of GET /api/crm/customers/:id (server/crm/entities.ts), shared so
 * a consumer cannot read it at the wrong nesting level: the client record is
 * under `customer`, NOT at the top level. The JobCam share dialog once read
 * `response.displayName` / `response.email` (both undefined) and rendered
 * "Prefilled from ." over an empty recipient field.
 */
export type CrmCustomerContact = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
};

export type CrmCustomerDetailResponse = {
  customer: CrmCustomerContact & Record<string, unknown>;
  /** Only for seats that may share the whole-client portal. */
  portalPath?: string;
  projects: unknown[];
  estimates: unknown[];
};

export type ShareChannel = "email" | "text";

/** Why the recipient field is (or is not) prefilled — one honest sentence. */
export type ShareRecipient = {
  /** The value to put in the recipient field ("" when there is none). */
  to: string;
  /** Helper text under the field; null while there is nothing to say yet. */
  hint: string | null;
  prefilled: boolean;
};

/**
 * Who a JobCam share link is sent to, from the job's client record.
 *   state "none"    — the job has no client attached
 *   state "loading" — the client record is still loading
 *   state "error"   — it could not be loaded (e.g. the seat may not see it)
 *   state "ready"   — `detail` is the route's response
 * Never claims a prefill that did not happen, and never prints an empty name.
 */
export function shareRecipient(
  input:
    | { state: "none" | "loading" | "error" }
    | { state: "ready"; detail: CrmCustomerDetailResponse | null | undefined },
  channel: ShareChannel,
): ShareRecipient {
  const what = channel === "email" ? "email address" : "mobile number";
  if (input.state === "loading") return { to: "", hint: null, prefilled: false };
  if (input.state === "none") {
    return { to: "", hint: `This job has no client on file — type the ${what} to send it to.`, prefilled: false };
  }
  const c = input.state === "ready" ? input.detail?.customer : undefined;
  if (input.state === "error" || !c) {
    return { to: "", hint: `Couldn't load the client's contact details — type the ${what} to send it to.`, prefilled: false };
  }
  const name = String(c.displayName ?? "").trim();
  const value = String((channel === "email" ? c.email : c.phone) ?? "").trim();
  if (!value) {
    return {
      to: "",
      hint: `${name || "This client"} has no ${what} on file — type one here, or add it on the client's page.`,
      prefilled: false,
    };
  }
  return { to: value, hint: name ? `Prefilled from ${name}.` : "Prefilled from the client on this job.", prefilled: true };
}
