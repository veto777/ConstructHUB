import { describe, expect, it } from "vitest";
import { boliAddresses } from "./or";

describe("OR BOLI", () => {
  it("splits the List of Ineligibles' rich-text address field into addresses", () => {
    // From the Debarments list item "A1 Dumptruck Services LLC" (2026-10-15).
    const html = '<div class="ExternalClass818EB121740C4F8CB969E30CCDE7627E">703 N Hayden Meadows Dr., #206<div>Portland, OR 97213</div><div><br></div><div>731 N Hayden Meadows Dr., #206</div><div>Portland, OR 97217</div><div><br></div><div>2408 NE ​​164th Avenue</div><div>Vancouver, WA 98684<br></div></div>';
    expect(boliAddresses(html)).toEqual(["703 N Hayden Meadows Dr., #206 Portland, OR 97213", "731 N Hayden Meadows Dr., #206 Portland, OR 97217", "2408 NE 164th Avenue Vancouver, WA 98684"]);
  });
});
