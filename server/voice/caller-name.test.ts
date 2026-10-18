/** Owner, 2026-10-17: the Call Assistant takes the caller's first and last name, filed as the client's first and last name. */
import { describe, it, expect } from "vitest";
import { leadFactsFrom, splitCallerName } from "./leads";

describe("caller names (owner, 2026-10-17: first and last name)", () => {
  it("splits the name the caller gave into first and last", () => {
    expect(splitCallerName("Pat O'Brien")).toEqual({ first: "Pat", last: "O'Brien" });
    expect(splitCallerName("Juan  de la Cruz")).toEqual({ first: "Juan", last: "de la Cruz" });
    expect(splitCallerName("Pat")).toEqual({ first: "Pat", last: null });
    expect(splitCallerName("  ")).toEqual({ first: null, last: null });
  });
  it("joins a separate last-name slot once", () => {
    const call = { fromNumber: "+13605550123", callerName: null, callerEmail: null, callerAddress: null, callerCity: null, serviceNeeded: null };
    expect(leadFactsFrom(call, { first_name: "Pat", last_name: "Lee" }).name).toBe("Pat Lee");
    expect(leadFactsFrom(call, { first_name: "Pat Lee", last_name: "Lee" }).name).toBe("Pat Lee");
    expect(leadFactsFrom(call, { first_name: "Pat Lee" }).name).toBe("Pat Lee");
  });
});
