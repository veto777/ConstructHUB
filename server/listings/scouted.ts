/**
 * Scouted long-tail directories (tier 4): contractor locators, trade associations, state licence lookups, chambers and
 * local directories found by the directory scouts and re-checked by scripts/build-listing-directories.ts.
 *
 * Every row is a page a scout opened; the build script re-fetches it. "verified" = the page loaded; "unconfirmed" = the
 * site blocked our check (bot wall, timeout) but the scout saw it. Dead pages never reach the data file.
 * Unknown requirements stay null — null means unresearched, not free or unrestricted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { directoryInput } from "./directory";

export const SCOUTED_FILE = "listing-directories.json";

const SCOUT_CATEGORIES = ["manufacturer", "trade_assoc", "state_local", "contractor", "general"] as const;

const nullableBool = z.boolean().nullable().optional().transform((value) => value ?? null);

// One line of a scout's directories.jsonl (see the scout BRIEF). Extra keys are ignored.
export const scoutRow = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().toLowerCase().transform((value) => value.replace(/^www\d?\./, "").replace(/\.$/, "")),
  directory_url: z.string().trim().max(2048),
  join_url: z.string().trim().max(2048).nullable().optional().transform((value) => value || null),
  category: z.enum(SCOUT_CATEGORIES),
  trades: z.array(z.string().trim().toLowerCase().min(1).max(100)).max(100).nullable().optional().transform((value) => (value?.length ? value : null)),
  states: z.array(z.string().trim().toUpperCase()).max(60).nullable().optional().transform((value) => (value?.length ? value : null)),
  requires_street_address: nullableBool,
  requires_phone_verification: nullableBool,
  requires_postcard: nullableBool,
  paid: nullableBool,
  membership_or_certification_required: nullableBool,
  evidence: z.string().trim().min(3).max(1000),
  notes: z.string().trim().max(2000).nullable().optional().transform((value) => value || null),
});
export type ScoutRow = z.infer<typeof scoutRow>;

export type ScoutedDirectory = {
  name: string;
  domain: string;
  category: (typeof SCOUT_CATEGORIES)[number];
  trades: string[] | null;
  states: string[] | null;
  requiresStreetAddress: boolean | null;
  requiresPhoneVerification: boolean | null;
  requiresPostcard: boolean | null;
  paid: boolean | null;
  membershipRequired: boolean | null;
  directoryUrl: string;
  joinUrl: string | null;
  evidence: string;
  notes: string | null;
  foundBy: string;
  linkStatus: "verified" | "unconfirmed";
  checkedAt: string;
};

/** The catalogue row a scouted directory becomes, validated by the same rules as an admin-added directory. */
export function toDirectoryRow(directory: ScoutedDirectory) {
  const notes = [
    directory.joinUrl ? `How to get listed: ${directory.joinUrl}` : null,
    directory.membershipRequired === true ? "Membership or certification required." : null,
    `Evidence: "${directory.evidence}"`,
    directory.notes,
    `Link ${directory.linkStatus} ${directory.checkedAt.slice(0, 10)}; found by ${directory.foundBy}.`,
  ]
    .filter(Boolean)
    .join("\n");
  return directoryInput.parse({
    name: directory.name,
    domain: directory.domain,
    kind: "submission",
    tier: 4,
    category: directory.category,
    trades: directory.trades,
    states: directory.states,
    requires_street_address: directory.requiresStreetAddress,
    requires_phone_verification: directory.requiresPhoneVerification,
    requires_postcard: directory.requiresPostcard,
    paid: directory.paid,
    active: true,
    source: directory.directoryUrl,
    notes,
  });
}

/** Reads the shipped data file (dist/data in production, server/data in dev). Missing file = no scouted rows. */
export function loadScoutedDirectories(dataDir = path.join(import.meta.dirname || __dirname, "..", "data")): ScoutedDirectory[] {
  const candidates = [path.join(dataDir, SCOUTED_FILE), path.join(import.meta.dirname || __dirname, "data", SCOUTED_FILE)];
  for (const file of candidates) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ScoutedDirectory[];
    } catch {
      // try the next location
    }
  }
  console.warn(`${SCOUTED_FILE} not found; no scouted directories seeded.`);
  return [];
}
