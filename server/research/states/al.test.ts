import { describe, expect, it } from "vitest";
import { parseAlDetail, parseAlList } from "./al";

// Snippets of licensesearch.alabama.gov pages saved 2026-10-15.
const LIST = `<table id="myDataTable"><thead><tr><th>NAME</th></tr></thead><tbody><tr><td>DUNN CONSTRUCTION CO INC</td><td>8</td><td>BIRMINGHAM</td><td>AL</td>
<td>BC: BUILDING CONSTRUCTION, MU: MUNICIPAL AND UTILITY</td><td>(205) 592-3866</td><td><a href="/genconbd/Details/1">Details</a></td></tr></tbody></table>`;
const DETAIL = `<input type="text" readonly class="form-control-plaintext" id="Address" value="P O  BOX 11967"><input type="text" readonly id="zip" value="35202">
<input type="text" readonly class="form-control-plaintext" id="bid" value="U UNLIMITED"><input type="text" readonly id="expire" value="9/30/2027">`;

describe("Alabama license lists", () => {
  it("reads list rows and detail links", () => {
    expect(parseAlList(LIST)).toEqual([{ cells: ["DUNN CONSTRUCTION CO INC", "8", "BIRMINGHAM", "AL", "BC: BUILDING CONSTRUCTION, MU: MUNICIPAL AND UTILITY", "(205) 592-3866", "Details"], detail: "/genconbd/Details/1" }]);
  });
  it("reads detail fields", () => {
    expect(parseAlDetail(DETAIL)).toEqual({ Address: "P O BOX 11967", zip: "35202", bid: "U UNLIMITED", expire: "9/30/2027" });
  });
});
