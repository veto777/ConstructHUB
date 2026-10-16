/**
 * The SAMPLE blocks the SEO pages show while they have nothing real to show (components/sample-preview.tsx — owner,
 * 2026-10-15: "a placeholder that says demo, and once you add real data the demo is replaced"). Every figure here is
 * invented for a made-up site, "sample-roofing.example", and is never stored, sent, counted or mixed with real rows:
 * each page renders one of these ONLY while its real list is empty, inside <SamplePreview>, which dims it, badges it
 * "Sample data" and makes it inert.
 */
import type { ReactNode } from "react";
import { SAMPLE_BUSINESS, SamplePreview } from "@/components/sample-preview";
import { PositionBadge } from "./viz-rank";
import { Move } from "./shell";
import type { SiteCard } from "@/components/seo-tool/project-row";

const SAMPLE_DOMAIN = SAMPLE_BUSINESS.domain;

/** A dashboard card's figures for the made-up site (components/seo-tool/project-row.tsx SiteCard). */
export const SAMPLE_SITE_CARD: SiteCard = {
  site: { id: 0, domain: SAMPLE_DOMAIN, businessName: SAMPLE_BUSINESS.name, locationCode: 2840, languageCode: "en", devices: "both", serpDepth: 10, keywordCount: 24, nextRankCheckAt: "2026-01-12T12:00:00Z", lastRankCheckAt: "2026-01-05T12:00:00Z", nextBacklinksAt: null, lastBacklinksAt: null, group: "Sample" },
  audit: { jobId: "sample", at: "2026-01-04T12:00:00Z", readable: true, health: 82, pages: 61, errorPages: 3, pageCap: 150, trend: [{ jobId: "sample-0", at: "2025-12-04T12:00:00Z", readable: true, health: 74, pages: 58, errorPages: 7, pageCap: 150 }, { jobId: "sample", at: "2026-01-04T12:00:00Z", readable: true, health: 82, pages: 61, errorPages: 3, pageCap: 150 }] },
  openTasks: 5,
  rank: { top3: 4, top10: 11, ranked: 19, checked: 24, checkedOn: "2026-01-05", firstOn: "2025-11-03", device: "desktop" },
  report: {
    fetchedAt: "2026-01-03T12:00:00Z", authority: 21, backlinks: 318, referringDomains: 64, organicKeywords: 412, organicTraffic: 930, trafficValue: 1450, top3: 9, top10: 37,
    history: [["2025-08", 610, 352], ["2025-09", 660, 371], ["2025-10", 720, 388], ["2025-11", 790, 395], ["2025-12", 860, 404], ["2026-01", 930, 412]].map(([month, traffic, keywords]) => ({ month: month as string, traffic: traffic as number, keywords: keywords as number })),
    linkHistory: [["2025-08", 49, 18], ["2025-09", 52, 19], ["2025-10", 55, 19], ["2025-11", 58, 20], ["2025-12", 61, 20], ["2026-01", 64, 21]].map(([month, referringDomains, authority]) => ({ month: month as string, referringDomains: referringDomains as number, authority: authority as number })),
  },
};

/** A tracked site's keyword table, as the rank tracker lays it out, with made-up positions. */
const SAMPLE_KEYWORDS: { keyword: string; desktop: number | null; mobile: number | null; before: number | null; volume: number; page: string }[] = [
  { keyword: "roof repair springfield", desktop: 3, mobile: 4, before: 5, volume: 480, page: "/roof-repair" },
  { keyword: "roofing contractor near me", desktop: 7, mobile: 9, before: 7, volume: 1900, page: "/" },
  { keyword: "metal roof installation cost", desktop: 12, mobile: 14, before: 18, volume: 720, page: "/metal-roofing" },
  { keyword: "emergency roof leak repair", desktop: 18, mobile: 15, before: 11, volume: 260, page: "/roof-repair" },
  { keyword: "gutter replacement springfield", desktop: null, mobile: null, before: null, volume: 140, page: "" },
];

export function SampleRankTable({ what, cta }: { what: string; cta?: ReactNode }) {
  return (
    <SamplePreview what={what} cta={cta} testId="sample-rank-table">
      <div className="overflow-x-auto">
        <table className="g-table" data-testid="sample-table-positions">
          <thead><tr><th>Keyword</th><th className="num">Desktop</th><th className="num">Mobile</th><th className="num">Volume</th><th>Ranking page</th><th className="num">Checked</th></tr></thead>
          <tbody>
            {SAMPLE_KEYWORDS.map((r) => (
              <tr key={r.keyword}>
                <td>{r.keyword}</td>
                <td className="num" data-label="Desktop"><PositionBadge position={r.desktop} depth={100} /> <Move now={r.desktop} before={r.before} hadBefore /></td>
                <td className="num" data-label="Mobile"><PositionBadge position={r.mobile} depth={100} /></td>
                <td className="num" data-label="Volume">{r.volume.toLocaleString("en-US")}</td>
                <td data-label="Page">{r.page ? `${SAMPLE_DOMAIN}${r.page}` : "—"}</td>
                <td className="num" data-label="Checked">Jan 5</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SamplePreview>
  );
}

/** Site explorer's headline figures for the made-up site. */
export function SampleExplorerFigures({ what, cta }: { what: string; cta?: ReactNode }) {
  const figures: [string, string, string][] = [
    ["Authority", "21", "link strength, 0–100"], ["Backlinks", "318", "12 broken"], ["Referring domains", "64", "71% followed"],
    ["Organic keywords", "412", "9 in the top 3 · 37 in the top 10"], ["Organic traffic (estimate)", "930", "visits a month · worth $1,450 / mo as ads"], ["Paid keywords", "0", "no Google Ads seen"],
  ];
  return (
    <SamplePreview what={what} cta={cta} testId="sample-explorer">
      <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
        <h2 className="g-text mb-3 text-[18px] font-semibold">Overview: {SAMPLE_DOMAIN} <span className="g-text-2 text-[12px] font-normal">· United States · as of Jan 3</span></h2>
        <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3">
          {figures.map(([label, value, foot]) => (
            <div key={label} className="min-w-0 px-1 sm:px-3">
              <div className="g-text-2 text-[12px]">{label}</div>
              <div className="text-[24px] font-medium leading-tight" style={{ color: "var(--g-blue)" }}>{value}</div>
              <div className="g-text-2 text-[12px]">{foot}</div>
            </div>
          ))}
        </div>
      </div>
    </SamplePreview>
  );
}
