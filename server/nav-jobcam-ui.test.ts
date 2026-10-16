import { afterEach, describe, expect, it, vi } from "vitest";
// JobCam in the navigation (owner, 2026-10-15: "add jobcam here on the side since we want jobcam to be here and in
// CRM section"). The page lives on the CRM portal host, so the sidebar's Tools list and the SEO shell's All-tools
// sheet reach it through a plain <a href={portalUrl(...)}> — never a wouter <Link>, which would stay on the
// marketing SPA and fall into its catch-all. Source guards in tool-access.test.ts's style (the component files
// import image assets, so they are read as text, not imported) plus unit tests of portalUrl itself.
import fs from "fs";
import path from "path";
import { portalUrl, marketingUrl, isPortal } from "../client/src/lib/site";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const sidebar = read("client/src/components/app-sidebar.tsx");
const layout = read("client/src/components/seo-tool/layout.tsx");

/** The source text of one top-level `const <name> = [ ... ];` / `{ ... };` literal (up to its column-0 closer). */
function arrayLiteral(src: string, name: string): string {
  const start = src.indexOf(`const ${name}`);
  expect(start, `const ${name} in source`).toBeGreaterThan(-1);
  const end = src.slice(start).search(/\n[\]}];/);
  expect(end, `end of const ${name}`).toBeGreaterThan(0);
  return src.slice(start, start + end + 3);
}
/** The `{ ... }` object literal lines inside an array literal whose text matches. */
const entries = (literal: string) => literal.split("\n").filter((l) => /^\s*\{ title:/.test(l));

describe("JobCam in the sidebar Tools list", () => {
  const tools = arrayLiteral(sidebar, "standaloneItems");
  const jobcam = entries(tools).filter((l) => /title:\s*"JobCam"/.test(l));

  it("is one Tools item, pointing at the CRM page /crm/jobcam through crmPath", () => {
    expect(jobcam).toHaveLength(1);
    expect(jobcam[0]).toMatch(/url:\s*"\/crm\/jobcam"/);
    expect(jobcam[0]).toMatch(/crmPath:\s*"\/crm\/jobcam"/);
    // Its feature page stays reachable from the row's landing arrow.
    expect(jobcam[0]).toMatch(/landingUrl:\s*"\/features\/jobcam"/);
  });

  it("is the only Tools item with a crmPath, and the item type declares it", () => {
    expect(entries(tools).filter((l) => /crmPath:/.test(l))).toHaveLength(1);
    expect(tools).toMatch(/crmPath\?:\s*string/);
  });

  it("renders a crmPath item as a plain <a href={portalUrl(item.crmPath)}>, every other item as a wouter <Link>", () => {
    expect(sidebar).toMatch(/^import \{ portalUrl \} from "@\/lib\/site";/m);
    expect(sidebar).toMatch(/import \{ Link, useLocation \} from "wouter"/);
    const branch = sidebar.match(/item\.crmPath\s*\?\s*<a href=\{portalUrl\(item\.crmPath\)\}[^\n]*\n\s*:\s*<Link href=\{item\.url\}/);
    expect(branch, "crmPath ? <a portalUrl> : <Link>").not.toBeNull();
    // The portal link is never a client-side route: no <Link> is ever handed a crmPath or portalUrl().
    expect(sidebar).not.toMatch(/<Link[^>]*href=\{portalUrl\(/);
    expect(sidebar).not.toMatch(/<Link[^>]*href=\{item\.crmPath\}/);
    // The <a> keeps the row's test id and menu styling, so the sidebar e2e selectors and layout do not change.
    expect(sidebar).toMatch(/<a href=\{portalUrl\(item\.crmPath\)\} data-testid=\{testId\} className="flex items-center gap-2 w-full">/);
  });

  it("the Pricing & Plans group's JobCam entry still links to the /features/jobcam page (a wouter route)", () => {
    const pricing = arrayLiteral(sidebar, "pricingGroup");
    const rows = entries(pricing).filter((l) => /title:\s*"JobCam"/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/url:\s*"\/features\/jobcam"/);
    expect(rows[0]).toMatch(/testId:\s*"link-nav-pricing-jobcam"/);
    expect(rows[0]).not.toMatch(/crmPath/);
  });
});

describe("JobCam in the All-tools sheet (SEO shell)", () => {
  it("renders crmPath items as <a href={portalUrl(...)}> and everything else as a wouter <Link>", () => {
    expect(layout).toMatch(/^import \{ portalUrl \} from "@\/lib\/site";/m);
    expect(layout).toMatch(/import \{ Link, useLocation, useSearch \} from "wouter"/);
    expect(layout).toMatch(/crmPath\?:\s*string/);
    const branch = layout.match(/i\.crmPath\s*\?\s*<a key=\{i\.url\} href=\{portalUrl\(i\.crmPath\)\}[^\n]*\n\s*:\s*<Link key=\{i\.url\} href=\{i\.url\}/);
    expect(branch, "i.crmPath ? <a portalUrl> : <Link>").not.toBeNull();
    expect(layout).not.toMatch(/<Link[^>]*href=\{portalUrl\(/);
    // The sheet lists the sidebar's own Tools items, so the JobCam row there is the same crmPath entry.
    expect(layout).toMatch(/APP_NAV\.standaloneItems\.filter\(APP_NAV\.shownHere\)\.map\(\(i\) => item\(i\)\)/);
    expect(sidebar).toMatch(/standaloneItems/);
  });

  it("the <a> carries the same all-tools test id and class as a <Link> row", () => {
    expect(layout).toMatch(/<a key=\{i\.url\} href=\{portalUrl\(i\.crmPath\)\} className=\{className\} data-testid=\{testId\}>/);
    // Derived from the item's url, so the JobCam row is all-tools-crm-jobcam either way.
    expect(layout).toMatch(/const testId = `all-tools-\$\{i\.url\.replace\(/);
    expect("/crm/jobcam".replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")).toBe("crm-jobcam");
  });
});

describe("portalUrl (client/src/lib/site.ts)", () => {
  const at = (href: string) => {
    const u = new URL(href);
    vi.stubGlobal("window", { location: { host: u.host, hostname: u.hostname, protocol: u.protocol, search: u.search } });
  };
  afterEach(() => vi.unstubAllGlobals());

  it("on the marketing host: the CRM origin for the same domain, path appended", () => {
    at("https://constructhub.us/pricing");
    expect(portalUrl("/crm/jobcam")).toBe("https://portal.constructhub.us/crm/jobcam");
    expect(portalUrl()).toBe("https://portal.constructhub.us/");
    at("https://constructhub.app/");
    expect(portalUrl("/crm/jobcam")).toBe("https://portal.constructhub.app/crm/jobcam");
  });

  it("keeps the port and protocol of a local dev host", () => {
    at("http://localhost:8215/seo");
    expect(portalUrl("/crm/jobcam")).toBe("http://portal.localhost:8215/crm/jobcam");
  });

  it("already on a CRM host (portal. or demo.): the path alone, so the link stays on that host", () => {
    at("https://portal.constructhub.us/crm-app");
    expect(portalUrl("/crm/jobcam")).toBe("/crm/jobcam");
    at("https://demo.constructhub.us/");
    expect(portalUrl("/crm/jobcam")).toBe("/crm/jobcam");
    at("https://PORTAL.constructhub.us/");
    expect(portalUrl("/crm/jobcam")).toBe("/crm/jobcam");
  });

  it("other faces (client. portal, www.) are not CRM hosts and get the portal origin", () => {
    at("https://client.constructhub.us/");
    expect(portalUrl("/crm/jobcam")).toBe("https://portal.client.constructhub.us/crm/jobcam");
    at("https://www.constructhub.us/");
    expect(isPortal()).toBe(false);
    expect(portalUrl("/crm/jobcam")).toBe("https://portal.www.constructhub.us/crm/jobcam");
  });

  it("without a window (SSR / prerender): the bare path", () => {
    vi.stubGlobal("window", undefined);
    expect(portalUrl("/crm/jobcam")).toBe("/crm/jobcam");
  });

  it("marketingUrl is its inverse on a portal host", () => {
    at("https://portal.constructhub.us/crm/jobcam");
    expect(marketingUrl("/features/jobcam")).toBe("https://constructhub.us/features/jobcam");
    at("http://portal.localhost:8215/crm/jobcam");
    expect(marketingUrl("/features/jobcam")).toBe("http://localhost:8215/features/jobcam");
  });
});
