import { describe, expect, it } from "vitest";
import { pageLinks } from "./g2-mylicense";

describe("MyLicense results paging", () => {
  // The grid's pager as the site writes it: numbered links, and "..." for the next block of pages.
  const PAGER = `<td colspan="5"><span>1</span>&nbsp;<a href="javascript:__doPostBack(&#39;datagrid_results$_ctl44$_ctl1&#39;,&#39;&#39;)">2</a>&nbsp;`
    + `<a href="javascript:__doPostBack(&#39;datagrid_results$_ctl44$_ctl2&#39;,&#39;&#39;)">3</a>&nbsp;<a href="javascript:__doPostBack(&#39;datagrid_results$_ctl44$_ctl10&#39;,&#39;&#39;)">...</a></td>`;
  it("reads numbered page links and the \"...\" link to more pages", () => {
    expect(pageLinks(PAGER)).toEqual([
      { target: "datagrid_results$_ctl44$_ctl1", page: 2 },
      { target: "datagrid_results$_ctl44$_ctl2", page: 3 },
      { target: "datagrid_results$_ctl44$_ctl10", page: null },
    ]);
  });
});
