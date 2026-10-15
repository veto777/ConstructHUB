/**
 * Round-6 audit, decision 3: the single-person check runs on the name field as published. Collapsing whitespace or
 * flipping "LAST, FIRST" first would turn a list of people into what reads as one person.
 */
import { describe, expect, it } from "vitest";
import { flipPerson, onePersonField, personText } from "./person-name";
import { dnrRows } from "./states/wi";
import { mnLicense } from "./states/mn";
import { ocilbRow } from "./states/oh";
import { rldLicenseHit, type RldLicense } from "./states/nm";
import { htmlPerson as g3Person, htmlText as g3Text } from "./states/lib/g3-common";
import { htmlPerson as g6Person } from "./states/lib/g6-common";
import { htmlPerson as g2Person } from "./states/lib/g2-aspnet";
import { htmlPerson as g4Person } from "./states/lib/g4-html";
import { parseArlsQualifiers } from "./states/lib/g3-arls";
import { parseKyGrid } from "./states/ky";
import { parseIaElectricalDetail } from "./states/ia";

describe("personText and flipPerson", () => {
  it("one person: whitespace collapsed, LAST, FIRST flipped", () => {
    expect(personText("  SMITH,   JOHN A ")).toBe("SMITH, JOHN A");
    expect(flipPerson("SMITH, JOHN A")).toBe("JOHN A SMITH");
  });
  it("a comma list is never flipped into one name", () => {
    expect(personText("J Smith, John Doe")).toBe("J Smith, John Doe");
    expect(flipPerson("J Smith, John Doe")).toBe("J Smith, John Doe");
    expect(onePersonField(flipPerson("J Smith, John Doe")!)).toBe(false);
  });
  it("a line break between two names stays a list", () => {
    expect(personText("Jane Smith\nJohn Doe")).toBe("Jane Smith / John Doe");
    expect(flipPerson("Jane Smith\r\nJohn Doe")).toBe("Jane Smith / John Doe");
    expect(onePersonField(personText("Jane Smith\nJohn Doe")!)).toBe(false);
  });
  it("empty is null", () => {
    expect(personText(" \n ")).toBeNull();
    expect(flipPerson(null)).toBeNull();
  });
});

describe("packs read the person from the raw field", () => {
  it("WI DNR: a cell with two people is not flipped into one", () => {
    const rows = [["x", "License No", "Full Name"], ["", "123", "SMITH, JOHN\nDOE, JANE", "", "", "", "", "MADISON", "WI"]];
    const [h] = dnrRows(rows, "Well drilling (DNR directory)");
    expect(h.kind).toBe("license");
    const hit = h.hit as { principal: string | null; people?: { name: string }[] };
    expect(hit.principal).toBe("SMITH, JOHN / DOE, JANE");
    expect(onePersonField(hit.principal!)).toBe(false);
    expect(h.person).toBe("SMITH, JOHN / DOE, JANE");
    const [one] = dnrRows([rows[0], ["", "124", "SMITH,  JOHN A", "", "", "", "", "MADISON", "WI"]], "Well drilling (DNR directory)");
    expect((one.hit as { principal: string | null }).principal).toBe("JOHN A SMITH");
  });
  it("MN DLI: a Name with a line break stays a list", () => {
    const h = mnLicense({ Name: "Jane Smith\nJohn Doe", Bus_Pers: "Person", Lic_Number: "PC1", Status: "ACTIVE" })!;
    expect(h.person).toBe("Jane Smith / John Doe");
    expect((h.hit as { principal: string | null }).principal).toBe("Jane Smith / John Doe");
  });
  it("OH OCILB: the qualifying individual as published", () => {
    const h = ocilbRow({ Name: "Jane Smith\nJohn Doe", Company: "ACME LLC", FormattedCredential: "1" })!;
    expect(h.person).toBe("Jane Smith / John Doe");
    expect(mnLicense({ Name: "Jane   Smith", Bus_Pers: "Person" })!.person).toBe("Jane Smith");
  });
  it("NM RLD: License_Holder_Name__c as published", () => {
    const h = rldLicenseHit({ Name: "HI-1", License_Holder_Name__c: "Jane Smith\nJohn Doe" } as RldLicense);
    expect(h.principal).toBe("Jane Smith / John Doe");
    expect(h.people).toEqual([{ name: "Jane Smith / John Doe", role: null }]);
  });
});

describe("HTML person cells: a <br> between two names stays a list", () => {
  it("every shared htmlPerson keeps the <br>; the old helpers are unchanged", () => {
    for (const f of [g3Person, g6Person, g2Person, g4Person]) {
      expect(f("Jane Smith<br>John Doe")).toBe("Jane Smith / John Doe");
      expect(f("<b>Jane\n  Smith</b>")).toBe("Jane Smith"); // a line break in the page source is not a separator
      expect(f(null)).toBeNull();
    }
    expect(g3Text("Jane Smith<br>John Doe")).toBe("Jane Smith John Doe");
  });
  it("ARLS qualifiers, KY grid and the IA electrical contact", () => {
    expect(parseArlsQualifiers("<tr><td>Jane Smith<br/>John Doe</td><td>Q.1</td><td>Active</td></tr>")[0].name).toBe("Jane Smith / John Doe");
    const ky = "<table id=\"MainContent_grdData\"><tr><td><a href=\"HBC_Lic_Details.aspx?id=1\">Smith, Jane<br>Doe, John</a></td><td>Master Plumber</td><td></td><td>M1</td><td>Active</td><td></td><td></td></tr></table>";
    expect(parseKyGrid(ky)[0].person).toBe("Smith, Jane / Doe, John");
    const ia = "<label>Contact Full Name</label><p>JANE SMITH<br>JOHN DOE</p><label>Business Phone Number</label><p>(515) 576-5429</p>";
    expect(parseIaElectricalDetail(ia).contact).toBe("JANE SMITH / JOHN DOE");
  });
});
