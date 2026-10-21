/**
 * The client portal's Contact us card, footer and "Your team on this job"
 * (server/crm/client-contact.ts) — pure tests, modelled on Alpine Exteriors
 * (owner, 2026-10-21): a WA client must see the WA office and Andrey, never
 * the FL office and never the owner's personal phone/inbox from the org row.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildClientTeam,
  clientOfficeContact,
  divisionContactId,
  divisionForState,
  isSharedOfficeLogin,
  stateCode,
} from "./client-contact";

const ORG = {
  name: "Alpine Exteriors",
  phone: "8138152031",
  email: "alpinesidingcompany@gmail.com",
  website: "alpineexteriorsfl.com",
  licenseNumber: null,
  licenseState: null,
};
const WA = {
  id: "wa", name: "Alpine Exteriors", code: "WA", state: "WA",
  phone: "(855) 743-4649", email: "AlpineExteriorsWA@gmail.com", website: "alpineexteriorswa.com",
  licenseNumber: "ALPIN**751OW", licenseState: "WA",
  customFields: { contactMemberId: "andrey" },
};
const FL = {
  id: "fl", name: "Alpine Exteriors", code: "FL", state: "fl",
  phone: "(833) 743-4649", email: "AlpineExteriorsFL@gmail.com", website: null,
  licenseNumber: "RB29003900", licenseState: "FL", customFields: null,
};
const OWNER = { id: "owner", role: "owner", displayName: "Alpine Exteriors", email: "alpinesidingcompany@gmail.com", phone: "8138152031" };
const ANDREY = { id: "andrey", role: "admin", displayName: "Andrey Shkurat", email: "andrey@alpineexteriorswa.com", phone: "+13607397583" };
const CREW = { id: "crew", role: "crew", displayName: "Crew Lead", email: "crew@example.com", phone: "555-0101" };
const MEMBERS = [OWNER, ANDREY, CREW];

const FORBIDDEN = ["813", "8138152031", "alpinesidingcompany@", "alpineexteriorsfl.com", "AlpineExteriorsFL", "(833)"];
const noLeak = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const f of FORBIDDEN) expect(s, f).not.toContain(f);
};

describe("clientOfficeContact — the company card and footer", () => {
  it("a WA client gets the WA office: name, phone, email, website, license — no FL, no owner details", () => {
    const o = clientOfficeContact(ORG, WA);
    expect(o).toEqual({
      name: "Alpine Exteriors", phone: "(855) 743-4649", email: "AlpineExteriorsWA@gmail.com",
      website: "alpineexteriorswa.com", licenseNumber: "ALPIN**751OW", licenseState: "WA",
    });
    noLeak(o);
  });

  it("never falls back to the org's (owner's personal) phone/email/website when a division exists", () => {
    const o = clientOfficeContact(ORG, { ...FL, phone: null, email: null, website: null });
    expect(o.phone).toBeNull();
    expect(o.email).toBeNull();
    expect(o.website).toBeNull();
  });

  it("an org without divisions keeps its own details", () => {
    expect(clientOfficeContact(ORG, null).phone).toBe("8138152031");
  });
});

describe("divisionForState — the last resort when nothing else names a division", () => {
  it("matches the client's address state, case- and name-insensitively", () => {
    expect(divisionForState([WA, FL], "WA")?.id).toBe("wa");
    expect(divisionForState([WA, FL], "Washington")?.id).toBe("wa");
    expect(divisionForState([WA, FL], "FL")?.id).toBe("fl"); // division state stored as "fl"
    expect(divisionForState([WA, FL], "OR")).toBeNull();
    expect(divisionForState([WA, FL], null)).toBeNull();
    expect(stateCode(" florida ")).toBe("FL");
  });
});

describe("buildClientTeam — Your team on this job", () => {
  it("an owner/admin-made bid shows the division's contact person (Andrey) first — never 'Owner' with 813", () => {
    const team = buildClientTeam({
      members: MEMBERS, bidCreatorId: "owner", otherIds: ["owner", "crew"],
      division: WA, divisionContact: ANDREY,
    });
    expect(team[0]).toMatchObject({ memberId: "andrey", name: "Andrey Shkurat", phone: "+13607397583", email: "andrey@alpineexteriorswa.com" });
    expect(team.map((m) => m.memberId)).toEqual(["andrey", "crew"]);
    expect(team.some((m) => m.role === "Owner")).toBe(false);
    noLeak(team);
  });

  it("the person who made the bid leads, then the others", () => {
    const team = buildClientTeam({
      members: MEMBERS, bidCreatorId: "crew", otherIds: ["andrey", "crew"],
      division: WA, divisionContact: ANDREY,
    });
    expect(team.map((m) => m.memberId)).toEqual(["crew", "andrey"]);
  });

  it("no contact person → the division office line and inbox, under the division's name", () => {
    const team = buildClientTeam({
      members: MEMBERS, bidCreatorId: "owner", otherIds: ["owner"],
      division: FL, divisionContact: null,
    });
    expect(team).toEqual([{ memberId: null, name: "Alpine Exteriors", role: "Office", phone: "(833) 743-4649", email: "AlpineExteriorsFL@gmail.com" }]);
  });

  it("a WA client's team never carries FL or owner details", () => {
    const team = buildClientTeam({
      members: MEMBERS, bidCreatorId: "owner", otherIds: ["owner", "andrey"],
      division: WA, divisionContact: ANDREY,
    });
    noLeak(team);
    expect(team).toHaveLength(1);
  });

  it("helpers: the shared login and the division's contact id", () => {
    expect(isSharedOfficeLogin(OWNER)).toBe(true);
    expect(isSharedOfficeLogin(ANDREY)).toBe(true);
    expect(isSharedOfficeLogin(CREW)).toBe(false);
    expect(divisionContactId(WA)).toBe("andrey");
    expect(divisionContactId(FL)).toBeNull();
  });
});

describe("wiring (source guards)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("/api/client/team serves the client's division office and the built team — not the org row", () => {
    const inbox = src("server/crm/inbox.ts");
    expect(inbox).toContain("resolveClientDivision(cust.orgId, cust)");
    expect(inbox).toContain("res.json({ office: clientOfficeContact(org, division), team });");
    expect(inbox).not.toMatch(/phone: org\?\.phone/);
  });

  it("the estimate page's contact card uses the same shared helpers", () => {
    const portal = src("server/crm/portal.ts");
    expect(portal).toContain("isSharedOfficeLogin(m) && m.id === est.createdByMemberId");
    expect(portal).toContain("divisionContactMember(est.orgId, div)");
  });

  it("the portal footer reads the same office as Contact us, not the org", () => {
    expect(src("client/src/pages/client-portal.tsx")).toContain("<PortalContactFooter accounts={accounts} />");
  });
});
