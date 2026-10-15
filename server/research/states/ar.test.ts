import { describe, expect, it } from "vitest";
import { electricalHit, hvacHit } from "./ar";

// Rows of labor.arkansas.gov/wp-json/metl/v1/all saved 2026-10-15.
describe("Arkansas rosters", () => {
  it("maps a person row and skips a business row with no name", () => {
    expect(hvacHit({ Last_Name: "Smith", First_Name: "David", physicalCity: "", physicalState: "", License_Number: "1509340", License_Status: "Inactive", Submitter_Type: "Individual", License_Expiration_Date: "03/31/2020 23:59:59" })?.hit)
      .toMatchObject({ principal: "David Smith", licenseNumber: "1509340", status: "Inactive", expires: "2020-03-31" });
    expect(electricalHit({ Last_Name: "", First_Name: "", License_Number: "EC-0653", License_Status: "Expired", License_Type_Display_Name: "Electrician - Electrical Contractor" })).toBeNull();
  });
  it("drops the 2999 no-expiration placeholder", () => {
    expect(hvacHit({ First_Name: "A", Last_Name: "B", License_Expiration_Date: "06/30/2999 23:59:59" })?.hit.expires).toBeNull();
  });
});
