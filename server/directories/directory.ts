import { z } from "zod";
import { siteUrl } from "../sitescan/http";

const publicUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      siteUrl(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a public HTTP(S) URL");

// A catalogue domain is a hostname, never a URL, path, wildcard or private address.
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((value) => {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))
      return false;
    if (value.split(".").some((label) => label.length > 63)) return false;
    try {
      return new URL(siteUrl(`https://${value}`)).hostname === value;
    } catch {
      return false;
    }
  }, "Use a public domain such as yelp.com");

export const directoryInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    domain: domain.nullable(),
    kind: z.enum(["api", "aggregator", "partner", "submission"]),
    tier: z.number().int().min(1).max(4),
    category: z.enum([
      "general",
      "maps_nav",
      "social",
      "contractor",
      "trade_assoc",
      "manufacturer",
      "state_local",
      "ai",
    ]),
    trades: z.array(z.string().trim().min(1).max(100)).max(100).nullable(),
    states: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(60)
      .nullable(),
    requires_street_address: z.boolean().nullable(),
    requires_phone_verification: z.boolean().nullable(),
    requires_postcard: z.boolean().nullable(),
    paid: z.boolean().nullable(),
    active: z.boolean(),
    source: publicUrl,
    notes: z.string().trim().max(10000).nullable(),
  })
  .strict();

export const directoryCreateInput = directoryInput.partial().required({
  name: true,
  domain: true,
  kind: true,
  tier: true,
  category: true,
  source: true,
});
export const directoryPatchInput = directoryInput
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing changed");
export type DirectoryEdits = z.infer<typeof directoryPatchInput>;
