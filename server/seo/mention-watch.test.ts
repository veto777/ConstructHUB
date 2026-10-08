import { describe, expect, it } from "vitest";
import { alertPages, newMentionsRequest } from "./mention-watch";
import { alertMessage } from "./alerts";

const row = (domain: string, title: string, linksToYou: boolean | null = false) => ({ url: `https://${domain}/p`, domain, title, snippet: null, published: "2026-10-01", authority: 30, linksToYou });
describe("mentions watch", () => {
  it("asks for every page published in the window (not one per website), oldest first, up to its end", () => {
    const r = newMentionsRequest("Alpine Exteriors", "alpine.example", new Date("2026-09-08T10:00:00Z"), new Date("2026-10-08T10:00:00Z"));
    expect(r).toMatchObject({ keyword: '"Alpine Exteriors"', search_mode: "as_is", order_by: ["content_info.date_published,asc"],
      filters: [["main_domain", "<>", "alpine.example"], "and", ["content_info.date_published", ">", "2026-09-08 10:00:00 +00:00"], "and", ["content_info.date_published", "<=", "2026-10-08 10:00:00 +00:00"]] });
  });
  it("alerts only on pages likely to be the business, not marked otherwise, on websites not known to link", () => {
    const rows = [row("a.com", "Alpine Exteriors in Bellingham"), row("b.com", "Alpine Exteriors Tampa"), row("c.com", "Alpine Exteriors Bellingham", true), row("d.com", "Alpine Exteriors in Bellingham"), row("e.com", "Alpine Exteriors news")];
    // Verdicts are by page (d.com/p rejected, e.com/p confirmed); another page of d.com would be judged on its own.
    const marks = new Map<string, "mine" | "not_mine">([["d.com/p", "not_mine"], ["e.com/p", "mine"]]);
    expect(alertPages(rows, ["Bellingham"], marks).map((r) => [r.domain, r.place, r.confirmed])).toEqual([["a.com", "Bellingham", false], ["e.com", null, true]]);
    // A link check that did not load is "not known": still a prospect worth a look, never counted as linking.
    expect(alertPages([row("f.com", "Alpine Exteriors Bellingham", null)], ["Bellingham"], new Map()).length).toBe(1);
  });
  it("the bell and email text says what was found and that each one is to be checked", () => {
    const m = alertMessage({ kind: "mention_new", title: "2 new pages mention \"Alpine Exteriors\"", domain: "alpine.example", items: [{ name: "Alpine Exteriors", since: "2026-09-08", pages: [{ domain: "a.com", title: "News" }, { domain: "e.com", title: "Blog" }] }] });
    expect(m).toMatchObject({ kind: "seo.mention_new", severity: "info" });
    expect(m.body).toContain("likely you — check each one");
    expect(m.body).toContain("a.com — News");
  });
});
