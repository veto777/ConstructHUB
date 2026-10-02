/**
 * Shared types and helpers for the Numbers tab (numbers+billing lane).
 * The shapes mirror server/voice/numbers.ts (`numberView`, GET /numbers,
 * GET /numbers/search); keep them in step.
 */
import { StatusPill, type PillTone } from "@/components/crm-ui";

export type VoiceNumber = {
  id: string;
  phoneNumber: string;
  label: string | null;
  location: string | null;
  state: string | null;
  areaCode: string | null;
  locality: string | null;
  provider: string;
  providerSid: string | null;
  friendlyName: string | null;
  voiceUrl: string | null;
  statusCallbackUrl: string | null;
  status: "pending" | "active" | "releasing" | "released" | "failed" | string;
  isTest: boolean;
  forwardingFrom: string | null;
  monthlyCents: number;
  purchasedAt: string | null;
  releaseEligibleAt: string | null;
  releasable: boolean;
  releasedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  /** Being released automatically (the subscription ended or no longer pays for it): why, and when it was decided. */
  releaseReason?: string | null;
  releaseReasonText?: string | null;
  releaseScheduledAt?: string | null;
};

export type NumberAllowance = { numbers: number; used: number; remaining: number; includedNumbers: number; extraNumberMonthlyCents: number };

export type ForwardingCarrier = { id: string; name: string; kind: string; steps: string[]; off?: string; note?: string };

export type NumbersResponse = {
  numbers: VoiceNumber[];
  allowance: NumberAllowance;
  nextNumberMonthlyCents: number;
  minDays: number;
  forwarding: { carriers: ForwardingCarrier[]; advice: string[] };
  webhooks: { voiceUrl: string; statusCallbackUrl: string; mediaUrl: string };
  configured: boolean;
  mock: boolean;
  canManage: boolean;
  /** The add-on is paused until a payment goes through: the list is read-only. */
  paused?: boolean;
};

export type AvailableNumber = {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  areaCode: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
};

export type SearchResponse = { numbers: AvailableNumber[]; monthlyCents: number; allowance: NumberAllowance; mock: boolean };

export const NUMBERS_KEY = "/api/crm/voice/numbers";

/** The 50 states + DC (the server accepts exactly these `InRegion` codes). */
export const US_STATES: readonly { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

/** "+13605550100" → "(360) 555-0100"; anything else is shown as given. */
export function formatPhone(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_LABEL: Record<string, [string, PillTone]> = {
  active: ["Active", "success"],
  pending: ["Setting up", "info"],
  releasing: ["Releasing", "warning"],
  released: ["Released", "neutral"],
  failed: ["Not confirmed", "danger"],
};

export function NumberStatusPill({ status, testId }: { status: string; testId?: string }) {
  const [label, tone] = STATUS_LABEL[status] ?? [status, "neutral" as PillTone];
  return <StatusPill tone={tone} data-testid={testId}>{label}</StatusPill>;
}
