/**
 * Wire shapes of the account API-key endpoints (the shared account contract).
 *
 *   GET    /api/account/api-keys                 -> ApiKeysResponse
 *   POST   /api/account/api-keys  CreateApiKeyBody -> { key, item }   (step-up re-auth: 403 {reauth:true})
 *   PATCH  /api/account/api-keys/:id { name?, monthlyUnitLimit? }
 *   DELETE /api/account/api-keys/:id
 *   GET    /api/account/api-usage?days=30        -> ApiUsageResponse
 *
 * Keys are `chub_<prefix>_<secret>`; only the prefix and suffix are stored in
 * the clear, so a key is shown in full exactly once, when it is created.
 */

export type ApiScope = "read" | "write";
export const API_SCOPES: readonly { id: ApiScope; label: string; blurb: string }[] = [
  { id: "read", label: "Read", blurb: "List and export your data." },
  { id: "write", label: "Write", blurb: "Create and update records (posts, replies, social posts) exactly as you send them." },
];

export type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scopes: ApiScope[];
  /** Per-key cap for the month; null = the plan's allowance. */
  monthlyUnitLimit: number | null;
  unitsThisMonth: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type ApiPlanInfo = {
  /** false when the plan has no API units (0 — Solo and Team today): keys can't be created and the API refuses the plan. */
  apiEnabled: boolean;
  unitsPerMonth: number;
  usedThisMonth: number;
  ratePerMinute: number;
};

export type ApiKeysResponse = { keys: ApiKeyItem[]; plan: ApiPlanInfo };

export type CreateApiKeyBody = {
  name: string;
  scopes: ApiScope[];
  monthlyUnitLimit?: number;
  expiresInDays?: number;
};

export type CreateApiKeyResponse = { key: string; item: ApiKeyItem };

export type ApiUsageDay = { date: string; units: number; requests: number; byKey: Record<string, number> };
export type ApiUsageResponse = { days: ApiUsageDay[]; totals: { units: number; requests: number } };

/** How a key reads in a table or a toast: "chub_ab12…z9". */
export const maskedKey = (k: Pick<ApiKeyItem, "prefix" | "suffix">) => `chub_${k.prefix}…${k.suffix}`;

/** The expiry choices on the Generate form; null = never. */
export const EXPIRY_CHOICES: readonly { value: string; days: number | null; label: string }[] = [
  { value: "30", days: 30, label: "30 days" },
  { value: "90", days: 90, label: "90 days" },
  { value: "365", days: 365, label: "1 year" },
  { value: "never", days: null, label: "Never" },
];
