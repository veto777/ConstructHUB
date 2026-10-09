/**
 * What else Google shows on the results page for a tracked keyword (from the check already paid for), as small
 * chips: the map pack, an AI overview, a featured snippet, "people also ask", videos, images, ads… A chip is
 * green when the site itself is in that feature (green only ever means "good" here), plain otherwise. Given `href`,
 * each chip is a link to the table narrowed to the keywords whose results show that feature.
 */
import { Link } from "wouter";

export const SERP_FEATURES: Record<string, { short: string; long: string; /** The feature as a thing ("a map pack"), for "keywords whose results show …". */ words: string }> = {
  local_pack: { short: "Map", long: "Google shows a map with local businesses", words: "a map pack" },
  ai_overview: { short: "AI", long: "Google answers with an AI overview", words: "an AI overview" },
  featured_snippet: { short: "Snippet", long: "A featured snippet (an answer box) sits above the results", words: "a featured snippet" },
  people_also_ask: { short: "Questions", long: "\"People also ask\" questions are shown", words: "\"people also ask\" questions" },
  video: { short: "Videos", long: "Videos are shown", words: "videos" },
  images: { short: "Images", long: "Images are shown", words: "images" },
  paid: { short: "Ads", long: "Ads are shown", words: "ads" },
  shopping: { short: "Shopping", long: "Shopping results are shown", words: "shopping results" },
  top_stories: { short: "News", long: "Top stories are shown", words: "top stories" },
  knowledge_graph: { short: "Panel", long: "A knowledge panel is shown", words: "a knowledge panel" },
};
/** The order chips are shown in; anything not listed (plain results, related searches…) is left out. */
const ORDER = Object.keys(SERP_FEATURES);
/** "own:featured_snippet" marks a feature the site itself appears in. */
export const ownsFeature = (features: readonly string[] | undefined, type: string) => !!features?.includes(`own:${type}`);
export const hasFeature = (features: readonly string[] | undefined, type: string) => !!features?.includes(type);
/** A feature in words for the filter chip; an unknown key is shown as it is, never dressed up. */
export const featureWords = (type: string) => SERP_FEATURES[type]?.words ?? `"${type}"`;
/** A chip's hit area: the chip's own height in the desktop table, 44px at phone width (audit round 2). */
const CHIP = "rounded border px-1.5 text-[11px] font-medium leading-4 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center";

export function SerpFeatureChips({ features, mapOwned, href }: { features: readonly string[] | undefined; /** The site is in the map pack (known separately). */ mapOwned?: boolean; /** Where a chip leads: the table narrowed to that feature. */ href?: (type: string) => string }) {
  const shown = ORDER.filter((t) => hasFeature(features, t));
  if (!shown.length) return <span className="g-text-2" title="Plain results only">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="serp-features">
      {shown.map((t) => {
        const own = t === "local_pack" ? !!mapOwned : ownsFeature(features, t);
        const style = own ? { borderColor: "var(--g-green)", color: "var(--g-green)" } : { borderColor: "var(--g-divider)", color: "var(--g-text-2)" };
        const title = `${SERP_FEATURES[t].long}${own ? " — and you are in it" : ""}${href ? " · keywords whose results show this" : ""}`;
        const body = <>{SERP_FEATURES[t].short}{own && <span className="sr-only"> (you are in it)</span>}</>;
        return href
          ? <Link key={t} href={href(t)} className={`${CHIP} !underline decoration-dotted decoration-1 underline-offset-2 hover:decoration-solid focus-visible:decoration-solid`} title={title} style={style} data-testid={`link-feature-${t}`}>{body}</Link>
          : <span key={t} className={CHIP} title={title} style={style}>{body}</span>;
      })}
    </span>
  );
}
