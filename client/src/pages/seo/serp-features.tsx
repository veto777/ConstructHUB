/**
 * What else Google shows on the results page for a tracked keyword (from the check already paid for), as small
 * chips: the map pack, an AI overview, a featured snippet, "people also ask", videos, images, ads… A chip is
 * filled when the site itself is in that feature.
 */
export const SERP_FEATURES: Record<string, { short: string; long: string }> = {
  local_pack: { short: "Map", long: "Google shows a map with local businesses" },
  ai_overview: { short: "AI", long: "Google answers with an AI overview" },
  featured_snippet: { short: "Snippet", long: "A featured snippet (an answer box) sits above the results" },
  people_also_ask: { short: "Questions", long: "\"People also ask\" questions are shown" },
  video: { short: "Videos", long: "Videos are shown" },
  images: { short: "Images", long: "Images are shown" },
  paid: { short: "Ads", long: "Ads are shown" },
  shopping: { short: "Shopping", long: "Shopping results are shown" },
  top_stories: { short: "News", long: "Top stories are shown" },
  knowledge_graph: { short: "Panel", long: "A knowledge panel is shown" },
};
/** The order chips are shown in; anything not listed (plain results, related searches…) is left out. */
const ORDER = Object.keys(SERP_FEATURES);
/** "own:featured_snippet" marks a feature the site itself appears in. */
export const ownsFeature = (features: readonly string[] | undefined, type: string) => !!features?.includes(`own:${type}`);
export const hasFeature = (features: readonly string[] | undefined, type: string) => !!features?.includes(type);

export function SerpFeatureChips({ features, mapOwned }: { features: readonly string[] | undefined; /** The site is in the map pack (known separately). */ mapOwned?: boolean }) {
  const shown = ORDER.filter((t) => hasFeature(features, t));
  if (!shown.length) return <span className="g-text-2" title="Plain results only">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="serp-features">
      {shown.map((t) => {
        const own = t === "local_pack" ? !!mapOwned : ownsFeature(features, t);
        return (
          <span key={t} className="rounded px-1.5 py-0.5 text-[11px] font-medium" title={`${SERP_FEATURES[t].long}${own ? " — and you are in it" : ""}`}
            style={own ? { background: "#188038", color: "#fff" } : { background: "var(--g-hover, rgba(0,0,0,.06))", color: "var(--g-text-2)" }}>
            {SERP_FEATURES[t].short}{own && <span className="sr-only"> (you are in it)</span>}
          </span>
        );
      })}
    </span>
  );
}
