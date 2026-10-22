/**
 * Who a client sees as "their company" and "their person" — pure, unit-tested
 * in client-contact.test.ts. The DB lookups live in divisions.ts
 * (resolveClientDivision, divisionContactMember).
 *
 * Owner, 2026-10-21 (Alpine): a WA client must see the WA office and the WA
 * contact (Andrey) — never the FL office, and never the owner's personal
 * phone/inbox that sit on the org row and the owner/admin login. The
 * owner/admin login is a shared office account: work created from it shows
 * the division's named contact (custom_fields.contactMemberId) instead, else
 * the division's office line and inbox.
 */

type MemberLike = {
  id: string;
  role: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
};

type DivisionLike = {
  id?: string;
  name: string;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  state?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
  customFields?: unknown;
};

type OrgLike = {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
};

export type ClientOffice = {
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
};

export type ClientTeamEntry = {
  /** null = the division office itself ("Message now" goes to the office). */
  memberId: string | null;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
};

/** The owner/admin login — a shared office account, not a person a client should call. */
export function isSharedOfficeLogin(m: { role: string } | null | undefined): boolean {
  return !!m && (m.role === "owner" || m.role === "admin");
}

/** The division's named client contact (crm_divisions.custom_fields.contactMemberId), if set. */
export function divisionContactId(div: { customFields?: unknown } | null | undefined): string | null {
  const cf = (div?.customFields ?? null) as Record<string, unknown> | null;
  const id = cf && typeof cf === "object" ? cf.contactMemberId : null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

const STATES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT",
  DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI",
  MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

/** "wa", "Washington", " WA " → "WA"; null when blank. */
export function stateCode(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  return STATES[t] ?? t;
}

/** The one division whose state (address, license or code) is the client's address state — null when none or ambiguous. */
export function divisionForState<D extends DivisionLike>(divisions: D[], state: string | null | undefined): D | null {
  const want = stateCode(state);
  if (!want) return null;
  const hits = divisions.filter((d) =>
    [d.state, d.licenseState, d.code].some((v) => stateCode(v) === want));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The company card + footer for a client. With a division: the division's own
 * name/phone/email/website/license — never the org's, because the org row
 * holds the owner's personal admin phone and inbox. Without one: the org.
 */
export function clientOfficeContact(org: OrgLike | null | undefined, div: DivisionLike | null | undefined): ClientOffice {
  if (div) {
    return {
      name: div.name || org?.name || null,
      email: div.email || null,
      phone: div.phone || null,
      website: div.website || null,
      licenseNumber: div.licenseNumber || null,
      licenseState: div.licenseState || null,
    };
  }
  return {
    name: org?.name ?? null,
    email: org?.email ?? null,
    phone: org?.phone ?? null,
    website: org?.website ?? null,
    licenseNumber: org?.licenseNumber ?? null,
    licenseState: org?.licenseState ?? null,
  };
}

const roleLabel = (r: string) =>
  r === "owner" ? "Owner" : r === "admin" || r === "pm" ? "Project Manager"
  : r === "sales" ? "Sales" : "Team";

/**
 * "Your team on this job": the person who made the bid (the latest estimate's
 * creator) first, then everyone else assigned. The owner/admin login as the
 * bid maker — and the owner anywhere, when the client has a division — is
 * replaced by the division's contact person, else by the division office
 * (its line and inbox, under the division's name). Never "Owner" with the
 * owner's personal number when a division exists.
 */
export function buildClientTeam(args: {
  members: MemberLike[];
  bidCreatorId: string | null;
  otherIds: Iterable<string>;
  division: DivisionLike | null;
  divisionContact: MemberLike | null;
}): ClientTeamEntry[] {
  const { members, bidCreatorId, division, divisionContact } = args;
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: ClientTeamEntry[] = [];
  const seen = new Set<string>();
  const push = (e: ClientTeamEntry) => {
    const k = e.memberId ?? "office";
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  const asEntry = (m: MemberLike, role = roleLabel(m.role)): ClientTeamEntry => ({
    memberId: m.id,
    name: m.displayName || m.email || "Team member",
    role,
    email: m.email ?? null,
    phone: m.phone ?? null,
  });
  const substitute = () => {
    if (divisionContact) return push(asEntry(divisionContact, "Sales"));
    if (division && (division.phone || division.email)) {
      push({ memberId: null, name: division.name, role: "Office", phone: division.phone ?? null, email: division.email ?? null });
    }
  };
  const ids = [bidCreatorId, ...args.otherIds].filter((x): x is string => !!x);
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) continue;
    const isCreator = id === bidCreatorId;
    if (division && ((isCreator && isSharedOfficeLogin(m)) || m.role === "owner")) substitute();
    else push(asEntry(m));
  }
  return out;
}
